"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chevron } from "@/components/ui/Chevron";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DateField, dayKey } from "@/components/ui/DateField";
import { useI18n } from "@/i18n/LanguageProvider";
import { repeatWhy } from "@/lib/repeat-why";
import { cn } from "@/lib/utils";

/**
 * Who is booked, on any day.
 *
 * The desk spends as much of its time answering "who is in on Saturday" as it
 * does checking people in this morning, so the day is a control rather than a
 * given: arrows for the day either side, a calendar for anywhere else, and Today
 * to come back. The day is always shown in words — nobody should have to work
 * out whether 08/09 is August or September. Attendance can be marked from here
 * for classes that have already run.
 */

type Attendee = {
  bookingId: string;
  userId: string;
  status: string;
  name: string;
  email: string;
  phone: string | null;
  /** The second person on a duet. Not a member, so this is the only record. */
  guestName: string | null;
  /**
   * What the instructor needs before the class.
   *
   * `level` is a word and sits on the row. `condition` and `notes` are
   * collapsed behind a press, because this list is read on a monitor in a room
   * with other people in it — see the note in lib/admin.ts on why they are
   * sent at all, and why being *shown* only on request is what makes that safe.
   */
  level: string | null;
  condition: string | null;
  notes: string | null;
  /** Whether anybody has ever asked them. Not the same as "nothing to declare". */
  asked: boolean;
};

type SessionRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: string;
  className: { en: string; el: string };
  /** GROUP or PERSONAL. */
  kind: string;
  /** ALL | BEGINNER | INTERMEDIATE | ADVANCED. */
  level: string;
  instructor: string | null;
  instructorId: string | null;
  attendees: Attendee[];
};

const CLASS_LEVELS = ["ALL", "BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

/** One name the desk may put on a class. */
type Teacher = { id: string; name: string };

/** One personal or duet hour somebody still has to be found to teach. */
type Appointment = {
  bookingId: string;
  startsAt: string;
  endsAt: string;
  guestName: string | null;
  name: string;
  email: string;
  phone: string | null;
  instructor: string | null;
  instructorId: string | null;
  sessionId: string;
  seats: number;
};

/**
 * How long a repeat run covers, in the terms the studio sells.
 *
 * The same table as the member's timetable — see ScheduleClient — kept here
 * rather than imported because that file is a thousand lines of booking panel
 * and this needs six pairs of numbers. If a third screen ever needs them they
 * belong in lib.
 *
 * `months: 0` is the single booking: one class, no run.
 */
const REPEAT_RUNS = [
  { months: 0, weeks: 1 },
  { months: 1, weeks: 4 },
  { months: 2, weeks: 9 },
  { months: 3, weeks: 13 },
  { months: 6, weeks: 26 },
  { months: 9, weeks: 39 },
] as const;

export function BookingsPanel({ onNotice }: { onNotice: (s: string) => void }) {
  const { t, locale, fmtTime, fmtLongDate, fmtDayMonth, fmtSessions } =
    useI18n();
  const d = t.desk;
  const el = locale === "el";

  /* "5, 12 and 19 Oct", joined the way the reader's own language joins a list.
     Reception reads this aloud, so a bare comma-separated run of dates is the
     one thing it must not be. */
  const joinDates = (() => {
    try {
      const lf = new Intl.ListFormat(el ? "el" : "en-GB", {
        style: "long",
        type: "conjunction",
      });
      return (parts: string[]) => lf.format(parts);
    } catch {
      return (parts: string[]) => parts.join(", ");
    }
  })();

  /* "Tuesday 2 September, 12:00" in one string. The appointment list spans
     three weeks, so a bare time would be ambiguous on every row of it. */
  const fmtDayTime = (iso: string) =>
    `${fmtLongDate(new Date(iso))}, ${fmtTime(iso)}`;

  const today = dayKey(new Date());
  const [day, setDay] = useState(today);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Which attendee's detail is open, as `bookingId:condition` or
   * `bookingId:notes`.
   *
   * One at a time, and closed by default. This screen lives on a monitor at a
   * counter, so a member's condition and the studio's note about them are one
   * press away rather than on display — and the previous press closes when the
   * next opens, so the desk cannot walk away having left three of them showing.
   */
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  /**
   * Who the desk is about to take off a class, if anybody.
   *
   * A confirmation step, and not because removing is dangerous — it is
   * reversible, the desk can book them straight back in. It is because the two
   * ways of doing it are not the same thing and the difference is somebody's
   * money. One Remove button with a refund policy behind it would decide that
   * for the person at the counter who is the only one who knows which it is.
   */
  const [removing, setRemoving] = useState<Attendee | null>(null);
  /**
   * The class the desk is about to call off, if any.
   *
   * A confirmation step because it is the one action here that touches everyone
   * on the class at once: every booking refunded, every member told, the hour
   * taken off the timetable. The dialog says how many that is before it happens,
   * so cancelling a full class and cancelling an empty one do not look the same.
   */
  const [cancelling, setCancelling] = useState<SessionRow | null>(null);
  /**
   * The class whose level the desk is changing, and the level they picked.
   *
   * Held until they answer the one-class-or-the-whole-slot question, because the
   * difference is a decision only they can make: a single Thursday that needs
   * fixing, or "from now on this hour is Beginners".
   */
  const [levelling, setLevelling] = useState<{
    session: SessionRow;
    level: string;
  } | null>(null);

  const load = useCallback(async (date: string) => {
    setSessions(null);
    const res = await fetch(`/api/admin/day?date=${date}`);
    if (!res.ok) {
      setSessions([]);
      return;
    }
    const data = (await res.json()) as {
      sessions: SessionRow[];
      appointments?: Appointment[];
      instructors?: Teacher[];
    };
    setSessions(data.sessions ?? []);
    setAppointments(data.appointments ?? []);
    setTeachers(data.instructors ?? []);
  }, []);

  useEffect(() => {
    void load(day);
  }, [day, load]);

  function shift(days: number) {
    const next = new Date(`${day}T12:00:00`);
    next.setDate(next.getDate() + days);
    setDay(dayKey(next));
  }

  /**
   * Put somebody on a class, or take them off it.
   *
   * One class, never the weekly rota: the reason this control exists is that an
   * instructor is ill *today*, and a tool that edited the template would fix one
   * Tuesday by rewriting every Tuesday.
   *
   * The whole day is reloaded afterwards rather than the one row patched, because
   * the answer includes how many members were told, and that number depends on
   * what the server decided rather than on what was clicked.
   */
  async function assign(sessionId: string, instructorId: string | null) {
    setBusy(sessionId);
    try {
      const res = await fetch("/api/admin/instructor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, instructorId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        instructor?: string | null;
        previous?: string | null;
        told?: number;
      };
      if (!res.ok) {
        onNotice(t.common.somethingWrong);
        return;
      }
      /* Said out loud, because a swap on a booked class writes to members and
         whoever pressed it should know that it did. */
      const told = data.told ?? 0;
      onNotice(
        told > 0
          ? d.instructorToldMembers
              .replace("{name}", data.instructor ?? "")
              .replace("{n}", String(told))
          : data.instructor
            ? d.instructorSet.replace("{name}", data.instructor)
            : d.instructorCleared,
      );
      await load(day);
    } finally {
      setBusy(null);
    }
  }

  async function mark(
    bookingId: string,
    status: "ATTENDED" | "NO_SHOW" | "CONFIRMED",
  ) {
    setBusy(bookingId);
    try {
      const res = await fetch("/api/admin/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, status }),
      });
      if (!res.ok) {
        onNotice(t.common.somethingWrong);
        return;
      }
      await load(day);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Take somebody off a class, and decide whose session it was.
   *
   * Two outcomes, both of them legitimate and neither of them a default worth
   * guessing at: the member who rang in with a good reason gets the session
   * back, and the member who simply did not come does not. Which is why this
   * asks rather than having one Remove button and a policy.
   *
   * It goes to the same route the member's own card uses, so both spellings of
   * "cancel this booking" apply the same rules, write the same ledger line
   * naming whoever pressed it, cancel the queued reminder, and tell the member.
   * See `cancelForMember`.
   */
  async function remove(a: Attendee, refund: boolean) {
    setBusy(a.bookingId);
    try {
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: a.bookingId,
          refund,
          /* Lands in the ledger beside the staff name, so a balance that
             changed can be traced back to this screen and not only to "the
             desk". */
          note: "Removed from the class list",
        }),
      });
      if (!res.ok) {
        onNotice(t.common.somethingWrong);
        return;
      }
      setRemoving(null);
      onNotice(
        (refund ? d.rosterRemoved : d.rosterRemovedKept).replace(
          "{name}",
          a.name,
        ),
      );
      await load(day);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Call off a whole class, and put everyone's session back.
   *
   * For the day the studio opens late, closes early, or loses a reformer for the
   * morning: the hour comes off the timetable so nobody can book it, every
   * member booked in is refunded and told, and it is one press rather than
   * removing each person by hand. The server does the refunding and the telling;
   * this reloads the day afterwards, because the number it reports back is the
   * number of members the server actually refunded.
   */
  async function cancelClass(s: SessionRow) {
    setBusy(s.id);
    try {
      const res = await fetch("/api/admin/session/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: s.id }),
      });
      const data = (await res.json()) as { ok?: boolean; refunded?: number };
      if (!res.ok) {
        onNotice(t.common.somethingWrong);
        return;
      }
      setCancelling(null);
      const n = data.refunded ?? 0;
      onNotice(
        n > 0 ? d.classCancelled.replace("{n}", String(n)) : d.classCancelledEmpty,
      );
      await load(day);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Undo a cancellation: put the class back on the timetable.
   *
   * The counterpart to cancelClass, and deliberately not a mirror image of it.
   * Cancelling refunds and tells everybody; reopening does neither, because the
   * members were already refunded and told, and quietly re-booking somebody into
   * a class they were told was off would be worse than asking them to book it
   * again. So the hour comes back empty and bookable. No confirmation step: it
   * takes nobody's money and is itself undone by cancelling again.
   */
  async function reopenClass(s: SessionRow) {
    setBusy(s.id);
    try {
      const res = await fetch(
        `/api/admin/session/cancel?sessionId=${encodeURIComponent(s.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        onNotice(t.common.somethingWrong);
        return;
      }
      onNotice(d.classReopened);
      await load(day);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Set a class's level, one class or the whole slot.
   *
   * The server does the work and reports how many classes it touched; this
   * reloads the day so the picker reflects it. A label change, so nobody is
   * told and nothing is refunded.
   */
  async function applyLevel(
    s: SessionRow,
    level: string,
    applyToUpcoming: boolean,
  ) {
    setBusy(s.id);
    try {
      const res = await fetch("/api/admin/session/level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: s.id, level, applyToUpcoming }),
      });
      const data = (await res.json()) as { ok?: boolean; upcoming?: number };
      if (!res.ok) {
        onNotice(t.common.somethingWrong);
        return;
      }
      setLevelling(null);
      const name = d.classLevels[level as keyof typeof d.classLevels] ?? level;
      onNotice(
        applyToUpcoming
          ? d.levelChangedUpcoming
              .replace("{level}", name)
              .replace("{n}", String(data.upcoming ?? 0))
          : d.levelChanged.replace("{level}", name),
      );
      await load(day);
    } finally {
      setBusy(null);
    }
  }

  /** "Thursday 10:00", for the level dialog. */
  function slotLabel(iso: string) {
    const dt = new Date(iso);
    const weekday = new Intl.DateTimeFormat(el ? "el-GR" : "en-GB", {
      weekday: "long",
    }).format(dt);
    return `${weekday} ${fmtTime(iso)}`;
  }

  const booked = (sessions ?? []).reduce(
    (n, s) => n + s.attendees.filter((a) => a.status !== "CANCELLED").length,
    0,
  );

  /**
   * The picker.
   *
   * A plain select and not a modal or a search box. There are four instructors,
   * the desk is often being used one-handed at a counter with somebody waiting,
   * and the fastest possible version of "who is taking this" is a list of four
   * names that opens where the finger already is.
   */
  /**
   * Book a member into this class, from the desk.
   *
   * Why it is on the class row rather than on the member's page: the question
   * that starts this is always about the *class*. Reception is looking at a
   * Tuesday with three people in one class and one in another, and is ringing
   * round to fill the quiet one. Starting from the member would mean finding the
   * class again afterwards.
   *
   * The search is by name, email or phone, which is how somebody rings up: they
   * give a name, or the desk has their number on the screen from the call.
   */
  function BookMember({
    sessionId,
    full,
    personal,
  }: {
    sessionId: string;
    /** No places left. The control is not offered rather than offered and refused. */
    full: boolean;
    /** A duet may carry a second name, exactly as on the member's own screen. */
    personal: boolean;
  }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<
      {
        id: string;
        name: string;
        email: string;
        phone: string | null;
        credits: number;
      }[]
    >([]);
    const [looking, setLooking] = useState(false);
    const [guest, setGuest] = useState("");
    const [sending, setSending] = useState<string | null>(null);
    /**
     * How many weeks of the same slot to take, defaulting to one.
     *
     * Reception's usual job is one class over the telephone, so one is the
     * default and the week chips are a second row rather than a question in the
     * way. Not offered for an appointment: every Personal hour commits somebody
     * to come in and teach it, and twelve booked in one press is twelve
     * instructor hours promised without anybody seeing it happen.
     */
    const [weeks, setWeeks] = useState(1);

    /* Searched on demand rather than as they type. The membership is small and
       the desk is on the telephone: a button they press when they have finished
       typing a name beats a request per keystroke, and cannot half-load. */
    async function search() {
      if (q.trim().length < 2) return;
      setLooking(true);
      try {
        const res = await fetch(
          `/api/admin/members?q=${encodeURIComponent(q.trim())}&filter=real`,
        );
        const data = (await res.json()) as {
          members?: {
            id: string;
            name: string;
            email: string;
            phone: string | null;
            credits: number;
          }[];
        };
        setHits((data.members ?? []).slice(0, 6));
      } catch {
        setHits([]);
      }
      setLooking(false);
    }

    async function book(userId: string, name: string) {
      setSending(userId);
      try {
        const res = await fetch("/api/admin/bookings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            userId,
            guestName: personal && guest.trim() ? guest.trim() : null,
            /* Only sent when it means something, so a single booking takes the
               exact path it always took. */
            ...(weeks > 1 ? { weeks } : {}),
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          booked?: number;
          alreadyHad?: number;
          asked?: number;
          failed?: { startsAt: string; code?: string; until?: string }[];
        };

        if (!data.ok) {
          /* The code, said as a sentence. "No sessions left" and "that class is
             full" send the person at the desk in completely different
             directions, so a single "could not book" would be useless. */
          onNotice(
            `${name}: ${d.deskBookErrors[data.error ?? ""] ?? data.error}`,
          );
          setSending(null);
          return;
        }

        /**
         * What to read back down the telephone.
         *
         * A term booking is very often partial — one week full, two already
         * theirs — and the useful sentence names the dates rather than saying
         * "done". Reception is talking to the member while this appears, so it
         * has to be a sentence and not a tick.
         */
        if (weeks > 1) {
          const booked = data.booked ?? 0;
          const already = data.alreadyHad ?? 0;
          const failed = data.failed ?? [];
          const parts = [
            failed.length === 0 && already === 0
              ? d.deskRepeatDone.replace("{n}", String(booked))
              : d.deskRepeatSome
                  .replace("{n}", String(booked))
                  .replace("{total}", String(data.asked ?? weeks)),
            already > 0
              ? d.deskRepeatAlready.replace("{n}", String(already))
              : "",
            /**
             * And why, grouped by reason, in reception's own voice.
             *
             * This is the sentence read down the telephone, so it has to carry
             * the reason and what to do about it: "their sessions expire before
             * the 5th and the 12th (they reach the 3rd) — sell them a pack and
             * book those weeks" is a sale. "Could not book the 5th and the
             * 12th" is a shrug.
             */
            ...repeatWhy(
              failed,
              {
                expire: d.deskRepeatWhyExpire,
                noCredits: d.deskRepeatWhyNoCredits,
                full: d.deskRepeatWhyFull,
                closed: d.deskRepeatWhyClosed,
                other: d.deskRepeatWhyOther,
              },
              { date: (x) => fmtDayMonth(x), list: joinDates },
            ),
          ].filter(Boolean);
          onNotice(`${name}: ${parts.join(" · ")}`);
        } else {
          onNotice(`${name}: ${d.deskBooked}`);
        }

        setOpen(false);
        setQ("");
        setHits([]);
        setGuest("");
        setWeeks(1);
        await load(day);
      } catch {
        onNotice(d.deskBookErrors.FAILED);
      }
      setSending(null);
    }

    if (full) return null;

    if (!open) {
      return (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {d.deskBookCta}
        </Button>
      );
    }

    return (
      <div className="mt-5 rounded-2xl border border-mocha-200 bg-white/70 p-4">
        <p className="text-[12px] text-mocha-700">{d.deskBookTitle}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-clay">
          {d.deskBookWhy}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            autoFocus
            className="input flex-1 min-w-[12rem]"
            placeholder={d.deskBookSearch}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
          <Button size="sm" variant="outline" onClick={() => void search()}>
            {looking ? t.common.loading : d.deskBookFind}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
        </div>

        {personal && (
          <input
            className="input mt-2"
            placeholder={d.deskBookGuest}
            value={guest}
            onChange={(e) => setGuest(e.currentTarget.value)}
          />
        )}

        {/**
         * A term of the same slot, for the member who rings up asking for it.
         *
         * The member's own screen has had this since the three-month packs
         * went on sale, and the people who telephone rather than use the site
         * are the ones most likely to want a fixed slot for a term — so
         * reception was doing it twelve clicks at a time.
         *
         * Group classes only, and not a limitation to be lifted: every
         * Personal or Duet hour commits somebody to come in and teach it,
         * arranged by hand the day before, so twelve in one press is twelve
         * instructor hours promised without anybody at the desk seeing it.
         */}
        {!personal && (
          <div className="mt-3 rounded-xl border border-mocha-200/70 bg-cream-200/40 p-3">
            <p className="text-[10px] uppercase tracking-widest text-clay">
              {d.deskRepeatLabel}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/**
               * Same ladder as the member's own timetable, in the same terms.
               *
               * Labelled in months and sent in weeks. Reception says "book her
               * Monday for six months" down a telephone; nobody at a desk
               * converts that to twenty-six. The single booking keeps its own
               * chip because it is the one reception takes most often.
               */}
              {REPEAT_RUNS.map(({ months, weeks: w }) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeeks(w)}
                  aria-pressed={weeks === w}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                    weeks === w
                      ? "border-mocha-600 bg-mocha-600 text-cream"
                      : "border-mocha-200 text-mocha-600 hover:border-mocha-400",
                  )}
                >
                  {months === 0
                    ? d.deskRepeatOne
                    : months === 1
                      ? t.booking.repeatOneMonth
                      : t.booking.repeatMonths.replace("{n}", String(months))}
                </button>
              ))}
            </div>
            {weeks > 1 && (
              <p className="mt-2 text-[10px] leading-snug text-clay">
                {d.deskRepeatHint}
              </p>
            )}
          </div>
        )}

        {hits.length > 0 && (
          <ul className="mt-3 divide-y divide-mocha-200/70">
            {hits.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <span>
                  <span className="text-[13px] text-mocha-600">{m.name}</span>
                  <span className="ml-3 text-[11px] text-clay">
                    {m.phone ?? m.email}
                  </span>
                  {/* The balance, on the row, before the button is pressed. A
                      member with none will be refused, and knowing that while
                      they are still on the telephone is the difference between
                      selling them a pack and ringing them back. */}
                  <span
                    className={cn(
                      "ml-3 rounded-full px-2 py-0.5 text-[10px] lining-nums tabular-nums",
                      m.credits > 0
                        ? "bg-mocha-100 text-mocha-600"
                        : "bg-red-50 text-red-700",
                    )}
                  >
                    {fmtSessions(m.credits)}
                  </span>
                </span>
                <Button
                  size="sm"
                  disabled={sending === m.id}
                  onClick={() => void book(m.id, m.name)}
                >
                  {sending === m.id
                    ? t.common.loading
                    : weeks > 1
                      ? d.deskRepeatAdd.replace("{n}", String(weeks))
                      : d.deskBookAdd}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!looking && hits.length === 0 && q.trim().length >= 2 && (
          <p className="mt-3 text-[12px] text-clay">{d.deskBookNobody}</p>
        )}
      </div>
    );
  }

  function TeacherPicker({
    sessionId,
    current,
  }: {
    sessionId: string;
    current: string | null;
  }) {
    return (
      <select
        aria-label={d.instructorLabel}
        value={current ?? ""}
        disabled={busy === sessionId || teachers.length === 0}
        onChange={(e) => void assign(sessionId, e.target.value || null)}
        className={cn(
          "rounded-full border bg-white/80 px-3 py-1.5 text-[11px] text-mocha-600 transition-colors",
          current
            ? "border-mocha-300"
            : /* Nobody on it yet, which on an appointment is the thing somebody
                 has to act on. Gold, like the block it sits in. */
              "border-gold/60 bg-[#FBF6E7] text-[#8a6f1a]",
          "disabled:opacity-50",
        )}
      >
        <option value="">{d.instructorNeeded}</option>
        {teachers.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="mt-10">
      {/**
       * Appointments first, and above the day control on purpose.
       *
       * This panel answers "who is in today". An appointment asks the opposite
       * question: an hour in the middle of a weekday that nobody is rostered
       * for, which somebody has to ring an instructor about before it arrives.
       * Answering that by opening tomorrow, then the day after, then Thursday,
       * is exactly how an hour gets missed.
       *
       * Not a tab of its own. Reception opens this screen first, so the thing
       * that needs a phone call is the first thing on it, and nothing new has
       * to be learned or remembered to find it. It disappears entirely when
       * there is nothing booked, which is most of the time.
       */}
      {appointments.length > 0 && (
        <section className="mb-6 rounded-3xl border border-gold/50 bg-[#FBF6E7]/70 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-[13px] uppercase tracking-widest text-mocha-600">
              {d.appointmentsTitle}
            </h3>
            <p className="text-[11px] text-clay">{d.appointmentsNote}</p>
          </div>

          <ul className="mt-5 divide-y divide-gold/30">
            {appointments.map((a) => (
              <li
                key={a.bookingId}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
              >
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-lg text-mocha-600 lining-nums tabular-nums">
                    {fmtDayTime(a.startsAt)}
                  </span>
                  <span className="rounded-full bg-mocha-600/90 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cream">
                    {a.seats > 1 ? d.duet : d.personal}
                  </span>
                </span>

                <span className="flex flex-1 flex-wrap items-baseline gap-x-3">
                  <span className="text-[14px] text-mocha-600">
                    {a.guestName ? `${a.name} + ${a.guestName}` : a.name}
                  </span>
                  <span className="text-[12px] text-clay">
                    {a.phone ?? a.email}
                  </span>
                </span>

                <TeacherPicker
                  sessionId={a.sessionId}
                  current={a.instructorId}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* the day */}
      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-mocha-200/70 bg-white/60 p-4">
        <button
          onClick={() => shift(-1)}
          aria-label={d.dayBefore}
          className="grid h-10 w-10 place-items-center rounded-full border border-mocha-200 text-mocha-500 transition-colors hover:border-mocha-500"
        >
          <Chevron className="rotate-90" />
        </button>
        <button
          onClick={() => shift(1)}
          aria-label={d.dayAfter}
          className="grid h-10 w-10 place-items-center rounded-full border border-mocha-200 text-mocha-500 transition-colors hover:border-mocha-500"
        >
          <Chevron className="-rotate-90" />
        </button>

        {/* The day in words, and the way to change it. A calendar rather than
            a typed date: the browser's own field reads dd/mm/yyyy on this
            machine and mm/dd/yyyy on another, and "which day am I looking at"
            is the one question this screen must never leave open. */}
        <DateField
          className="w-[16.5rem]"
          value={day}
          onChange={setDay}
          placeholder={d.pickDay}
        />

        {day !== today && (
          <Button size="sm" variant="ghost" onClick={() => setDay(today)}>
            {t.common.today}
          </Button>
        )}

        <p className="ml-auto text-[11px] uppercase tracking-widest text-clay">
          {booked} {d.bookedThatDay}
        </p>
      </div>

      {/* the classes */}
      {sessions === null ? (
        <p className="mt-8 text-center text-sm text-clay">{t.common.loading}</p>
      ) : sessions.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-mocha-200 px-6 py-14 text-center text-sm text-clay">
          {d.noClassesThatDay}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {sessions.map((s) => {
            const live = s.attendees.filter((a) => a.status !== "CANCELLED");
            return (
              <li
                key={s.id}
                className={cn(
                  "rounded-3xl border bg-white/60 p-6",
                  s.status === "CANCELLED"
                    ? "border-dashed border-mocha-200 opacity-70"
                    : "border-mocha-200/70",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <div>
                    <p className="font-display text-2xl text-mocha-600 lining-nums tabular-nums">
                      {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-clay">
                      {s.kind === "PERSONAL" && (
                        <span className="rounded-full bg-gold/25 px-2 py-0.5 text-[9px] uppercase tracking-widest text-[#8a6f1a]">
                          {d.personal}
                        </span>
                      )}
                      <span>
                        {el ? s.className.el : s.className.en}
                        {s.status === "CANCELLED" ? ` · ${d.cancelled}` : ""}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {/* Reassignable on a class as well as an appointment: an
                        instructor calling in ill is the ordinary case, and it
                        needs fixing on one day rather than on the rota. */}
                    {s.status !== "CANCELLED" && (
                      <TeacherPicker
                        sessionId={s.id}
                        current={s.instructorId}
                      />
                    )}
                    {/* The class's level. Group classes only — an appointment
                        has no level. Changing it opens the one-class-or-whole-
                        slot question rather than saving straight away. */}
                    {s.status !== "CANCELLED" && s.kind !== "PERSONAL" && (
                      <select
                        aria-label={d.levelLabel}
                        value={s.level}
                        disabled={busy === s.id}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== s.level) setLevelling({ session: s, level: v });
                        }}
                        className="rounded-full border border-mocha-200 bg-white px-3 py-1.5 text-[11px] uppercase tracking-widest text-mocha-600"
                      >
                        {CLASS_LEVELS.map((lv) => (
                          <option key={lv} value={lv}>
                            {d.classLevels[lv]}
                          </option>
                        ))}
                      </select>
                    )}
                    <p className="text-[11px] uppercase tracking-widest text-clay lining-nums tabular-nums">
                      {live.length}/{s.capacity}
                    </p>
                    {/* Off the timetable and everyone refunded. Ghost and set
                        apart, because it is the one control on this row that
                        acts on the whole class at once. Not offered on a class
                        that has already run, which the server refuses anyway. */}
                    {s.status !== "CANCELLED" &&
                      new Date(s.startsAt).getTime() > Date.now() && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === s.id}
                          onClick={() => setCancelling(s)}
                        >
                          {d.cancelClass}
                        </Button>
                      )}
                    {/* Undo a cancellation: the hour goes back on the timetable,
                        empty. The people who were refunded are not put back in
                        (they were told it was off), so it comes back bookable
                        rather than pretending nothing happened. Offered only
                        while the class is still ahead, since reopening one that
                        has already passed puts nothing bookable anywhere. */}
                    {s.status === "CANCELLED" &&
                      new Date(s.startsAt).getTime() > Date.now() && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === s.id}
                          onClick={() => void reopenClass(s)}
                        >
                          {d.reopenClass}
                        </Button>
                      )}
                  </div>
                </div>

                {live.length === 0 ? (
                  <p className="mt-5 text-sm text-clay">{d.nobodyBooked}</p>
                ) : (
                  <ul className="mt-5 divide-y divide-mocha-200/70">
                    {live.map((a) => (
                      <li key={a.bookingId} className="py-3">
                       <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>
                          <span className="text-[14px] text-mocha-600">
                            {a.name}
                          </span>
                          {/* The second person, who has no account and no other
                              record anywhere. Whoever opens the door needs to be
                              expecting two. */}
                          {a.guestName && (
                            <span className="ml-2 rounded-full bg-gold/25 px-2 py-0.5 text-[10px] text-[#8a6f1a]">
                              + {a.guestName}
                            </span>
                          )}
                          <span className="ml-3 text-[12px] text-clay">
                            {a.phone ?? a.email}
                          </span>
                          {a.status !== "CONFIRMED" && (
                            <span className="ml-3 rounded-full bg-mocha-100 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mocha-500">
                              {a.status === "ATTENDED"
                                ? d.attended
                                : a.status === "NO_SHOW"
                                  ? d.noShow
                                  : a.status}
                            </span>
                          )}
                        </span>

                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            variant={
                              a.status === "ATTENDED" ? "solid" : "outline"
                            }
                            disabled={busy === a.bookingId}
                            onClick={() => void mark(a.bookingId, "ATTENDED")}
                          >
                            {d.attended}
                          </Button>
                          <Button
                            size="sm"
                            variant={a.status === "NO_SHOW" ? "solid" : "ghost"}
                            disabled={busy === a.bookingId}
                            onClick={() => void mark(a.bookingId, "NO_SHOW")}
                          >
                            {d.noShow}
                          </Button>
                          {/* Ghost, and last. It is the one action here that
                              takes something away, and it should not sit at the
                              same weight as the two that record what happened. */}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === a.bookingId}
                            onClick={() => setRemoving(a)}
                          >
                            {d.rosterRemove}
                          </Button>
                        </span>
                       </div>

                        {/**
                          * The level on the row, the rest behind a press.
                          *
                          * The level is the one an instructor wants at a glance
                          * for all five people at once — who is new — and it is
                          * a single word about how somebody trains, not about
                          * their body. The other two are the opposite: long,
                          * personal, and needed for one member at a time.
                          *
                          * "Not asked yet" is deliberately different from
                          * "nothing to declare". Showing an empty condition as
                          * "nothing to watch" for somebody nobody has ever
                          * asked would be the screen inventing an answer.
                          */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {a.level ? (
                            <span className="rounded-full bg-mocha-100 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mocha-500">
                              {t.intake.levels[
                                a.level as keyof typeof t.intake.levels
                              ] ?? a.level}
                            </span>
                          ) : null}

                          {a.condition ? (
                            <Marker
                              on={openDetail === `${a.bookingId}:condition`}
                              tone="warn"
                              onClick={() =>
                                setOpenDetail((k) =>
                                  k === `${a.bookingId}:condition`
                                    ? null
                                    : `${a.bookingId}:condition`,
                                )
                              }
                            >
                              {d.rosterCondition}
                            </Marker>
                          ) : (
                            <span className="text-[10px] uppercase tracking-widest text-clay/60">
                              {a.asked ? d.rosterNothing : d.rosterNotAsked}
                            </span>
                          )}

                          {a.notes ? (
                            <Marker
                              on={openDetail === `${a.bookingId}:notes`}
                              tone="plain"
                              onClick={() =>
                                setOpenDetail((k) =>
                                  k === `${a.bookingId}:notes`
                                    ? null
                                    : `${a.bookingId}:notes`,
                                )
                              }
                            >
                              {d.rosterNotes}
                            </Marker>
                          ) : null}
                        </div>

                        {openDetail === `${a.bookingId}:condition` && (
                          <Detail label={d.rosterConditionFull}>
                            {a.condition}
                          </Detail>
                        )}
                        {openDetail === `${a.bookingId}:notes` && (
                          <Detail label={d.rosterNotesFull}>{a.notes}</Detail>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Only where a booking could actually be taken. A cancelled
                    class and a full one both mean the control has nothing to
                    offer, and offering it anyway would end in a refusal the
                    desk had no way to see coming. */}
                {s.status !== "CANCELLED" && live.length < s.capacity && (
                  <div className="mt-4">
                    <BookMember
                      sessionId={s.id}
                      full={live.length >= s.capacity}
                      personal={s.kind === "PERSONAL"}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Two ways to remove somebody, asked rather than assumed. See
          `remove` above for why neither is a default. */}
      {removing && (
        <ConfirmDialog
          title={d.rosterRemoveTitle.replace("{name}", removing.name)}
          body={d.rosterRemoveBody}
          cancelLabel={d.rosterRemoveCancel}
          onClose={() => setRemoving(null)}
          actions={[
            {
              label: d.rosterRemoveRefund,
              busy: busy === removing.bookingId,
              onClick: () => void remove(removing, true),
            },
            {
              label: d.rosterRemoveKeep,
              variant: "outline",
              busy: busy === removing.bookingId,
              onClick: () => void remove(removing, false),
            },
          ]}
        />
      )}

      {/* Call off a whole class. The body counts the people it affects, so the
          desk sees the size of what it is about to do before it does it. */}
      {cancelling && (
        <ConfirmDialog
          title={d.cancelClassTitle}
          body={(() => {
            const n = cancelling.attendees.filter(
              (a) => a.status !== "CANCELLED",
            ).length;
            return n > 0
              ? d.cancelClassBody.replace("{n}", String(n))
              : d.cancelClassBodyEmpty;
          })()}
          cancelLabel={d.cancelClassKeep}
          onClose={() => setCancelling(null)}
          actions={[
            {
              label: d.cancelClassConfirm,
              busy: busy === cancelling.id,
              onClick: () => void cancelClass(cancelling),
            },
          ]}
        />
      )}

      {/* One class, or the whole recurring slot from today on. Neither is a
          default worth guessing — the desk is either fixing one date or changing
          the timetable. */}
      {levelling && (
        <ConfirmDialog
          title={d.setLevelTitle.replace(
            "{level}",
            d.classLevels[levelling.level as keyof typeof d.classLevels] ??
              levelling.level,
          )}
          body={d.setLevelBody.replace(
            "{slot}",
            slotLabel(levelling.session.startsAt),
          )}
          cancelLabel={t.common.back}
          onClose={() => setLevelling(null)}
          actions={[
            {
              label: d.setLevelUpcoming,
              busy: busy === levelling.session.id,
              onClick: () => void applyLevel(levelling.session, levelling.level, true),
            },
            {
              label: d.setLevelOne,
              variant: "outline",
              busy: busy === levelling.session.id,
              onClick: () =>
                void applyLevel(levelling.session, levelling.level, false),
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * A small press-to-open marker on a roster row.
 *
 * Deliberately not a `Button`: the desk buttons on the same row are actions
 * that change something, and a marker only reveals what is already there.
 * Giving them the same weight would put "Came", "No show" and "read her health
 * note" side by side looking like three equal decisions.
 *
 * `tone="warn"` is the health one, in the same gold the site uses everywhere
 * else for "look at this". The studio's own note is plain: it is useful, not
 * urgent.
 */
function Marker({
  on,
  tone,
  onClick,
  children,
}: {
  on: boolean;
  tone: "warn" | "plain";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={on}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors duration-300",
        tone === "warn"
          ? on
            ? "border-[#8a6f1a] bg-gold/25 text-[#8a6f1a]"
            : "border-gold/50 text-[#8a6f1a] hover:bg-gold/15"
          : on
            ? "border-mocha-500 bg-mocha-100 text-mocha-600"
            : "border-mocha-200 text-mocha-500 hover:bg-mocha-100",
      )}
    >
      {children}
    </button>
  );
}

/** The box a marker opens. Pre-wrapped, because people write paragraphs. */
function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-mocha-200 bg-cream-200/50 p-3">
      <p className="text-[10px] uppercase tracking-widest text-clay">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-mocha-600">
        {children}
      </p>
    </div>
  );
}

