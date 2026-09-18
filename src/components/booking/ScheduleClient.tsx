"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PushInvite } from "@/components/booking/PushInvite";
import { useI18n } from "@/i18n/LanguageProvider";
import { isPersonalCancellable } from "@/lib/personal";
import { classHoursOn } from "@/lib/rota";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { repeatWhy } from "@/lib/repeat-why";
import { studioAddDays, studioDateKey, studioStartOfDay } from "@/lib/time";
import { cn, FREE_CANCELLATION_HOURS } from "@/lib/utils";
import { DateField } from "@/components/ui/DateField";
import { TIMETABLE_DAYS } from "@/lib/horizon";

/**
 * One class type, sent once per page rather than once per class. Ninety days of
 * timetable is around 750 classes; repeating the names and level on each of them
 * added hundreds of kilobytes to the HTML for no new information. That saving
 * mattered at four weeks and matters three times as much now.
 */
export type ScheduleClassType = {
  slug: string;
  nameEn: string;
  nameEl: string;
  level: string;
  intensity: number;
  durationMin: number;
  /** GROUP or PERSONAL. Changes the chip, the panel and both cutoffs. */
  kind: string;
};

export type ScheduleSession = {
  id: string;
  /** Local YYYY-MM-DD the class belongs to */
  day: string;
  startsAt: string;
  capacity: number;
  booked: number;
  spotsLeft: number;
  status: string;
  bookable: boolean;
  /** key into the `types` map */
  type: string;
  /** This class's level: ALL | BEGINNER | INTERMEDIATE | ADVANCED. */
  level: string;
  instructor: string | null;
  myBookingId: string | null;
};

/** endsAt is startsAt plus the class type's length, so it is not sent per class. */
function endOf(
  s: ScheduleSession,
  types: Record<string, ScheduleClassType>,
): string {
  const start = new Date(s.startsAt);
  const mins = types[s.type]?.durationMin ?? 60;
  return new Date(start.getTime() + mins * 60_000).toISOString();
}

/**
 * How long a repeat run covers, offered in the terms the studio sells.
 *
 * Labelled in months and sent in weeks, because those are two different
 * audiences. `repeatWeekly` matches on weekday and minute-of-day and counts in
 * weeks; a member choosing "book my Monday for six months" is not thinking in
 * twenty-sixes.
 *
 * The weeks are the honest conversion of a month to Mondays — a month has about
 * 4.3 of them — and the run stops itself early anyway if the sessions or the
 * pack expiry run out first, reporting which. So a slight difference between
 * "9 months" and 39 Mondays costs nobody a session.
 *
 * Previously offered as bare week counts, 4 / 8 / 13 / 26 / 52, which asked the
 * member to work out that 13 was three months and left out 39 entirely — so
 * there was no way to book nine months at all, on the same page that sells a
 * nine-month pack.
 */
const REPEAT_RUNS = [
  { months: 1, weeks: 4 },
  { months: 2, weeks: 9 },
  { months: 3, weeks: 13 },
  { months: 6, weeks: 26 },
  { months: 9, weeks: 39 },
] as const;

const LEVEL: Record<string, { en: string; el: string }> = {
  ALL: { en: "All levels", el: "Όλα τα επίπεδα" },
  BEGINNER: { en: "Beginner", el: "Αρχάριοι" },
  INTERMEDIATE: { en: "Intermediate", el: "Μεσαίο" },
  ADVANCED: { en: "Advanced", el: "Προχωρημένοι" },
};

export function ScheduleClient({
  sessions: initial,
  types,
  signedIn,
  credits,
  duetCredits = 0,
  soloCredits = 0,
  personalCredits = 0,
  days,
  closedDays,
  firstBookableDay,
  lastBookableDay,
  pushPublicKey = "",
}: {
  sessions: ScheduleSession[];
  types: Record<string, ScheduleClassType>;
  signedIn: boolean;
  credits: number;
  /** Sessions in hand that admit a second person. */
  duetCredits?: number;
  /** Sessions in hand for the hour alone. */
  soloCredits?: number;
  /** Both kinds together, for the balance line. */
  personalCredits?: number;
  days: string[]; // ISO date strings, one per day shown
  /** Desk closures keyed by day, each carrying the reason the desk typed. */
  closedDays: Map<string, { reasonEn: string; reasonEl: string }>;
  /**
   * The whole bookable range, which is a year wide while `days` above is
   * ninety.
   *
   * The strip is a window onto this, not the extent of it. These two bound the
   * calendar picker, and a date chosen outside the current window reloads the
   * page with the window moved — see `jumpTo`. Passed as day keys rather than a
   * day count so the client is never doing the same arithmetic as the server
   * and getting a different answer at a clock change.
   */
  firstBookableDay: string;
  lastBookableDay: string;
  /**
   * For the offer made after a first booking. Empty when the server has no
   * usable VAPID pair, which is the same as "push is off" — see
   * lib/messaging/push.ts — and the panel then never appears.
   */
  pushPublicKey?: string;
}) {
  const {
    t,
    locale,
    fmtTime,
    fmtLongDate,
    fmtDayMonth,
    fmtWeekdayShort,
    fmtSpots,
  } = useI18n();
  const router = useRouter();
  const el = locale === "el";

  const [sessions, setSessions] = useState(initial);
  const [balance, setBalance] = useState(credits);
  /* Open on today. The timetable is a place you check "what's on today", so
     landing anywhere else — the old code opened on the first day with a class
     still bookable, which on an afternoon skipped a morning-only today and
     jumped to tomorrow — reads as the site having moved the date on you. Today
     is always the first day of the window on load, so this is it; only if today
     somehow is not in the window (an odd deep-link) does it fall back to the
     first day that has a class. A closed today shows "Studio closed", which is
     the honest thing to show for today. */
  const [activeDay, setActiveDay] = useState(() => {
    const todayKey = studioDateKey(studioStartOfDay(new Date()));
    if (days.includes(todayKey)) return todayKey;
    return (
      days.find((d) => initial.some((s) => s.day === d && s.bookable)) ??
      days.find((d) => initial.some((s) => s.day === d)) ??
      days[0]!
    );
  });
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  /* The class the member is looking at. Picking a time is a click, not a
     scroll: the times are chips on one or two lines and the detail below
     swaps in place. */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * The class the member is being asked to give up a session for, if any.
   *
   * Only ever set for a booking past the free window. Inside the window there
   * is nothing to warn about and the cancel is one press — see `cancel`.
   */
  const [forfeiting, setForfeiting] = useState<ScheduleSession | null>(null);
  /**
   * Whether a booking has just gone through, which is the only moment the
   * studio asks about notifications. See PushInvite for why here and not on
   * arrival. Never unset: the panel decides for itself whether it has anything
   * to say, and taking the offer away again while somebody is reading it would
   * be worse than leaving it.
   */
  const [justBooked, setJustBooked] = useState(false);
  /**
   * Whether the member has just made their first ever booking, which the server
   * tells us on the booking response. The one moment a "top up your sessions"
   * nudge is welcome rather than pushy: they have committed to one class, and
   * the natural next thought is keeping the habit. Shown once, only here.
   */
  const [firstBooking, setFirstBooking] = useState(false);
  /**
   * How many weeks a term booking should cover, and whether one is running.
   *
   * Null means the member has not opened the repeat control. Kept out here
   * rather than inside the panel for the same reason the guest name is: the
   * panel is re-keyed whenever they glance at another hour, which would reset a
   * choice they had already made.
   */
  const [repeatWeeks, setRepeatWeeks] = useState<number | null>(null);
  const [repeating, setRepeating] = useState(false);
  /**
   * The appointment panel's two questions: how many of you, and who is the
   * second one.
   *
   * Kept here rather than inside the panel because the panel is re-keyed on
   * every change of class, which would wipe a half-typed name the moment the
   * member glanced at another hour. Reset when the day changes, which is the one
   * moment the answer is certainly stale.
   */
  const [twoOfUs, setTwoOfUs] = useState(false);
  const [guestName, setGuestName] = useState("");
  /**
   * A Duet is for two, so holding only a Duet decides the question.
   *
   * The two kinds do not substitute for each other in either direction, which
   * means the honest version of this control is not always a choice. Somebody
   * holding a Duet and nothing else is booking for two people whatever they
   * click, so the choice disappears and the name field is simply the next thing
   * to fill in. Somebody holding both gets the toggle. Somebody holding only a
   * Personal session is never asked.
   */
  const mustBringSomebody = duetCredits > 0 && soloCredits === 0;
  const canChoose = duetCredits > 0 && soloCredits > 0;
  const bringing = mustBringSomebody || (canChoose && twoOfUs);
  const strip = useRef<HTMLDivElement | null>(null);
  const [toast, setToast] = useState<{
    kind: "ok" | "warn" | "error";
    text: string;
    cta?: { href: string; label: string };
  } | null>(null);

  /**
   * "5, 12 and 19 Oct", the way the reader's own language joins a list.
   *
   * Greek does not use "and" where English does, and neither language joins
   * three things the way a comma-separated list does. `Intl.ListFormat` knows
   * both, and this is the one place in the app that has a list of dates to read
   * aloud.
   */
  const joinDates = useMemo(() => {
    try {
      const lf = new Intl.ListFormat(el ? "el" : "en-GB", {
        style: "long",
        type: "conjunction",
      });
      return (parts: string[]) => lf.format(parts);
    } catch {
      /* An engine without ListFormat still gets a readable list. */
      return (parts: string[]) => parts.join(", ");
    }
  }, [el]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleSession[]>();
    for (const d of days) map.set(d, []);
    for (const s of sessions) {
      if (map.has(s.day)) map.get(s.day)!.push(s);
    }
    return map;
  }, [sessions, days]);

  const list = (byDay.get(activeDay) ?? []).filter((s) =>
    onlyAvailable ? s.spotsLeft > 0 && s.bookable : true,
  );

  /* Default to the first class of the day that can still be booked, so the
     detail panel is never empty and the common case is one click. */
  const picked =
    list.find((s) => s.id === pickedId) ??
    list.find((s) => s.bookable && s.spotsLeft > 0) ??
    list[0] ??
    null;

  useEffect(() => setPickedId(null), [activeDay, onlyAvailable]);
  useEffect(() => {
    setTwoOfUs(false);
    setGuestName("");
    setRepeatWeeks(null);
  }, [activeDay]);

  /* The date strip holds three months, so it scrolls horizontally. The arrows
     move it a week at a time and keep the active chip in view — which is why
     they are worth having at ninety chips in a way they barely were at
     twenty-eight. */
  function nudge(dir: -1 | 1) {
    const box = strip.current;
    if (!box) return;
    box.scrollBy({
      left: dir * Math.max(240, box.clientWidth * 0.8),
      behavior: "smooth",
    });
  }

  /**
   * Going to a date the strip does not hold.
   *
   * Inside the window this is just selecting a chip. Outside it — the calendar
   * is a year wide and the strip is ninety days — there is nothing to select,
   * so the window itself has to move, and that is a page load with `?date=`.
   *
   * Deliberately a navigation rather than a fetch. The server already knows how
   * to render any ninety days; adding a second path that assembles days on the
   * client would be a second copy of the closure rules, the bookable rules and
   * the personal-hours rules. The cost is a page load a member takes perhaps
   * twice a year, when they are booking into next spring.
   */
  function jumpTo(key: string) {
    if (!key) return;
    if (days.includes(key)) {
      setActiveDay(key);
      strip.current
        ?.querySelector<HTMLElement>(`[data-day="${key}"]`)
        ?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      return;
    }
    router.push(`/timetable?date=${key}`);
  }

  /**
   * The next window along, as a day key.
   *
   * Forward: the day after the last chip, so the windows abut rather than
   * overlap or skip. Backward: a full window before the first chip, clamped to
   * today — going back from day 20 should land on today, not on day minus ten.
   */
  function windowShift(dir: -1 | 1) {
    if (dir === 1) {
      const last = days[days.length - 1]!;
      return studioDateKey(studioAddDays(new Date(`${last}T12:00:00`), 1));
    }
    const first = days[0]!;
    const back = studioDateKey(
      studioAddDays(new Date(`${first}T12:00:00`), -TIMETABLE_DAYS),
    );
    return back < firstBookableDay ? firstBookableDay : back;
  }

  function stepDay(dir: -1 | 1) {
    const i = days.indexOf(activeDay);
    const next = days[i + dir];
    if (!next) return;
    setActiveDay(next);
    strip.current
      ?.querySelector<HTMLElement>(`[data-day="${next}"]`)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
  }

  const dayIndex = days.indexOf(activeDay);

  /**
   * Whether the arrows are stepping a day or fetching the next thirty.
   *
   * The strip is a thirty-day window on a year, so its two ends mean different
   * things depending on where the window is. On the last chip of the window with
   * more year left, the next arrow is a door: it loads the following thirty
   * days. On the last chip of the *year* it is a wall and disables. Same in
   * reverse at the near end, except the near wall is today — there is no
   * booking backwards.
   */
  const atWindowStart = dayIndex <= 0;
  const atWindowEnd = dayIndex >= days.length - 1;
  const windowIsFirst = days[0] === firstBookableDay;
  const windowIsLast = (days[days.length - 1] ?? "") >= lastBookableDay;
  const isPersonal = (s: ScheduleSession) => types[s.type]?.kind === "PERSONAL";
  const pickedPersonal = picked ? isPersonal(picked) : false;

  /* The same split as the server: an appointment closes to cancellation at the
     end of the previous day, a class twelve hours before it starts. Getting
     this wrong would offer a Cancel button the API then refuses. */
  const canCancelPicked = picked
    ? pickedPersonal
      ? isPersonalCancellable(new Date(picked.startsAt))
      : new Date(picked.startsAt).getTime() - Date.now() >
        FREE_CANCELLATION_HOURS * 3600_000
    : false;

  function flash(next: NonNullable<typeof toast>) {
    setToast(next);
    window.setTimeout(() => setToast(null), 6000);
  }

  async function book(s: ScheduleSession) {
    if (!signedIn) {
      router.push("/login?next=/timetable");
      return;
    }
    setBusy(s.id);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: s.id,
          /* Only when it is an appointment and they said two. Sending it for a
             group class would be meaningless, and sending an empty string would
             fail validation. */
          ...(isPersonal(s) && bringing && guestName.trim().length >= 2
            ? { guestName: guestName.trim() }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        bookingId?: string;
        credits?: number;
        error?: string;
        /** True when this was the member's first ever booking. */
        firstBooking?: boolean;
        /** The last class date their sessions reach, on SESSIONS_EXPIRE_FIRST. */
        until?: string;
      };

      if (data.ok && data.bookingId) {
        setSessions((prev) =>
          prev.map((x) =>
            x.id === s.id
              ? {
                  ...x,
                  booked: x.booked + 1,
                  spotsLeft: Math.max(0, x.spotsLeft - 1),
                  myBookingId: data.bookingId!,
                }
              : x,
          ),
        );
        if (typeof data.credits === "number") setBalance(data.credits);
        flash({
          kind: "ok",
          text: isPersonal(s)
            ? `${t.booking.personalBooked} ${t.booking.personalBookedBody}`
            : `${t.booking.successTitle} ${t.booking.successBody}`,
        });
        setTwoOfUs(false);
        setGuestName("");
        setJustBooked(true);
        if (data.firstBooking) setFirstBooking(true);
        router.refresh();
        return;
      }

      if (data.error === "NO_CREDITS") {
        flash({
          kind: "warn",
          text: t.booking.noCredits,
          cta: { href: "/pricing", label: t.booking.noCreditsCta },
        });
        return;
      }

      /* Their sessions die before this class runs. Names the last date that
         would have worked, because a refusal that does not is a puzzle: the
         member can see a balance and cannot see why it will not reach. */
      if (data.error === "SESSIONS_EXPIRE_FIRST") {
        flash({
          kind: "warn",
          text: t.booking.sessionsExpireFirst.replace(
            "{date}",
            data.until ? fmtLongDate(new Date(data.until)) : "",
          ),
          cta: { href: "/pricing", label: t.booking.noCreditsCta },
        });
        return;
      }

      /* They have sessions — just not any that can pay for a class on this date.
         Telling them "no sessions" while their balance plainly reads 1 is how a
         site loses somebody's trust in a single sentence. */
      if (data.error === "CREDITS_NOT_VALID_HERE") {
        flash({
          kind: "warn",
          text: t.booking.creditsNotValidHere,
          cta: { href: "/pricing", label: t.booking.noCreditsCta },
        });
        return;
      }
      /* Holding class sessions and asking for a midday hour, or asking for two
         people on a session that admits one. Both send them to the price list,
         because in both cases the fix is a purchase and not an explanation. */
      if (
        data.error === "NEEDS_PERSONAL_CREDIT" ||
        data.error === "NEEDS_DUET_CREDIT" ||
        data.error === "DUET_IS_FOR_TWO"
      ) {
        flash({
          kind: "warn",
          text:
            data.error === "NEEDS_DUET_CREDIT"
              ? t.booking.needsDuet
              : data.error === "DUET_IS_FOR_TWO"
                ? t.booking.duetIsForTwo
                : t.booking.needsPersonal,
          cta: { href: "/pricing", label: t.booking.noCreditsCta },
        });
        return;
      }

      /* An account that never confirmed its email. Given a way forward rather
         than a refusal: the code box is one press away, and the alternative is
         somebody staring at "you cannot book" with no idea why. */
      if (data.error === "EMAIL_UNVERIFIED") {
        flash({
          kind: "warn",
          text: t.booking.unverified,
          cta: {
            href: "/verify?next=/timetable",
            label: t.booking.unverifiedCta,
          },
        });
        return;
      }

      const messages: Record<string, string> = {
        CLASS_FULL: t.booking.classFull,
        ALREADY_BOOKED: t.booking.alreadyBooked,
        TOO_LATE: t.booking.tooLate,
        PERSONAL_TOO_LATE: t.booking.personalTooLate,
        ONE_PER_DAY: t.booking.onePerDay,
        UNAUTHENTICATED: t.timetablePage.signedOut,
      };
      flash({
        kind: "error",
        text: messages[data.error ?? ""] ?? t.common.somethingWrong,
      });
    } catch {
      flash({ kind: "error", text: t.common.somethingWrong });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Book the same slot for several weeks in one press.
   *
   * The server books each week on its own terms and reports what it could not
   * take, so the interesting work here is saying so honestly: "booked 6 of 7,
   * the 24th was full" rather than a bare tick or a bare cross. A member who is
   * told six went through and one did not can go and look at that one; a member
   * told only "done" discovers the hole in November.
   *
   * The whole timetable is reloaded afterwards rather than patched in place.
   * Up to thirteen classes changed on days that are not the one being looked at,
   * and reconciling that by hand is a lot of code to arrive at what the server
   * already knows.
   */
  async function repeat(s: ScheduleSession, weeks: number) {
    setRepeating(true);
    try {
      const res = await fetch("/api/bookings/repeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: s.id, weeks }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        booked?: number;
        alreadyHad?: number;
        failed?: { startsAt: string; code?: string; until?: string }[];
        credits?: number;
        error?: string;
      };

      if (!data.ok) {
        flash({ kind: "error", text: t.booking.repeatFailed });
        return;
      }

      const booked = data.booked ?? 0;
      const already = data.alreadyHad ?? 0;
      const failed = data.failed ?? [];

      if (booked === 0 && already > 0 && failed.length === 0) {
        flash({ kind: "ok", text: t.booking.repeatNothing });
      } else {
        const parts = [
          failed.length === 0 && already === 0
            ? t.booking.repeatDone.replace("{n}", String(booked))
            : t.booking.repeatDoneSome
                .replace("{n}", String(booked))
                .replace("{total}", String(weeks)),
          already > 0
            ? t.booking.repeatAlready.replace("{n}", String(already))
            : "",
          /**
           * And why, which is the part that matters.
           *
           * Grouped by reason rather than listed by date: a thirty-day pack
           * refusing four weeks is one sentence with a date in it, not four
           * lines. Without this a member sees four dates they "could not book"
           * while looking at unspent sessions, which reads as a broken website
           * rather than as a pack that runs out on the 3rd.
           */
          ...repeatWhy(
            failed,
            {
              expire: t.booking.repeatWhyExpire,
              noCredits: t.booking.repeatWhyNoCredits,
              full: t.booking.repeatWhyFull,
              closed: t.booking.repeatWhyClosed,
              other: t.booking.repeatWhyOther,
            },
            { date: (d) => fmtDayMonth(d), list: joinDates },
          ),
        ].filter(Boolean);

        flash({
          kind: failed.length > 0 ? "warn" : "ok",
          text: parts.join(" "),
        });
      }

      if (typeof data.credits === "number") setBalance(data.credits);
      setRepeatWeeks(null);
      setJustBooked(booked > 0);
      router.refresh();
    } catch {
      flash({ kind: "error", text: t.booking.repeatFailed });
    } finally {
      setRepeating(false);
    }
  }

  /**
   * Cancel, and ask first only when there is something to lose.
   *
   * Inside the free window this is one press: the session comes straight back
   * and a dialog confirming a reversible thing is a dialog people learn to
   * dismiss without reading, which is how a confirmation stops working on the
   * day it matters.
   *
   * Past the window the session is gone, so the words have to be said and
   * agreed to. `forfeit` is what carries that agreement to the server, and the
   * server refuses without it — so the question cannot be skipped by a stale
   * page or a second tab.
   */
  async function cancel(s: ScheduleSession, forfeit = false) {
    if (!s.myBookingId) return;
    setBusy(s.id);
    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: s.myBookingId, forfeit }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        refunded?: boolean;
        credits?: number;
        error?: string;
      };
      if (data.ok) {
        setSessions((prev) =>
          prev.map((x) =>
            x.id === s.id
              ? {
                  ...x,
                  booked: Math.max(0, x.booked - 1),
                  spotsLeft: Math.min(x.capacity, x.spotsLeft + 1),
                  myBookingId: null,
                }
              : x,
          ),
        );
        if (typeof data.credits === "number") setBalance(data.credits);
        setForfeiting(null);
        /* Says which of the two happened. "Cancelled" alone would leave
           somebody who has just given up a session wondering whether it came
           back, which is the one thing they want to know. */
        flash({
          kind: data.refunded ? "ok" : "warn",
          text: `${t.booking.cancelled} ${
            data.refunded ? t.booking.cancelRefund : t.booking.cancelKept
          }`,
        });
        router.refresh();
      } else if (data.error === "TOO_LATE_TO_CANCEL") {
        /* The server refused because nobody has confirmed yet. Ask. Reached
           when the window closed while the page was open, so the button the
           member pressed was the plain one. */
        setForfeiting(s);
        router.refresh();
      } else {
        flash({ kind: "error", text: t.common.somethingWrong });
      }
    } catch {
      flash({ kind: "error", text: t.common.somethingWrong });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {/* No enclosing bar: the balance and the two actions sit straight on the
          page, which keeps the eye on the dates below. */}
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        {signedIn ? (
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="font-display text-3xl leading-none text-mocha-600">
              {balance}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-clay">
              {t.common.creditsLeft}
            </span>
            {/* Broken out because the total is not one balance. A member
                holding five class sessions and one personal who reads "6" and
                then cannot book two of the classes in front of them has been
                misled by the headline figure on this very page. */}
            {personalCredits > 0 && (
              <span className="rounded-full border border-gold/50 bg-[#FBF6E7]/70 px-2.5 py-1 text-[10px] uppercase tracking-widest text-[#8a6f1a]">
                {t.booking.personalHeld.replace("{n}", String(personalCredits))}
              </span>
            )}
          </p>
        ) : (
          <p className="text-[13px] text-mocha-500">
            {t.timetablePage.signedOut}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {signedIn ? (
            /* Filled rather than outlined. It is the one thing on this row a
               member ever needs to act on, and beside a hairline filter pill it
               was the same weight as a control that does nothing but hide
               classes. */
            <ButtonLink href="/pricing" size="sm">
              {t.account.walletTopUp}
            </ButtonLink>
          ) : (
            <ButtonLink href="/login?next=/timetable" size="sm">
              {t.nav.login}
            </ButtonLink>
          )}
          <button
            onClick={() => setOnlyAvailable((v) => !v)}
            className={cn(
              "rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest transition-all duration-500",
              onlyAvailable
                ? "border-mocha-600 bg-mocha-600 text-cream"
                : "border-mocha-300 text-mocha-500 hover:border-mocha-500",
            )}
          >
            {onlyAvailable
              ? t.timetablePage.filterAvailable
              : t.timetablePage.filterAll}
          </button>
        </div>
      </div>

      {/**
       * Date strip, with arrows either side and a calendar for jumping.
       *
       * The calendar is not a mobile affordance bolted on: it is the only way
       * to reach month nine of a twelve-month pack, because the strip holds
       * ninety days and nobody drags a scroller through three hundred chips.
       * On a phone it also replaces the arrow-tapping the studio complained
       * about. Shown at every width for that reason.
       *
       * **The layout is two rows on a phone and one from `sm` up**, out of a
       * single DOM order, using wrap and `order`.
       *
       * Measured twice to get here. Inline with everything on one line left the
       * strip a four-pixel sliver at 390px, because the button reads
       * "4 September 2026". Picker on its own row above was better but still
       * only fitted three chips, since the two arrows took a third of the
       * remaining width. So on a phone the picker and both arrows share the top
       * row and the strip gets the whole of the second one; from `sm` the strip
       * slots back between the arrows where there is room for ten chips.
       */}
      <div className="mt-7 flex flex-wrap items-center gap-2 sm:gap-3">
        <DateField
          id="tt-jump"
          value={activeDay}
          onChange={jumpTo}
          min={firstBookableDay}
          max={lastBookableDay}
          placeholder={t.timetablePage.pickDate}
          className="min-w-0 flex-1 sm:flex-none sm:shrink-0"
        />
        <StripArrow
          dir="prev"
          label={
            atWindowStart
              ? t.timetablePage.prevWindow.replace(
                  "{n}",
                  String(TIMETABLE_DAYS),
                )
              : t.timetablePage.prevWeek
          }
          showLabel={atWindowStart && !windowIsFirst}
          disabled={atWindowStart && windowIsFirst}
          onClick={() => {
            if (!atWindowStart) {
              stepDay(-1);
              nudge(-1);
              return;
            }
            router.push(`/timetable?date=${windowShift(-1)}`);
          }}
        />

        <div
          ref={strip}
          /**
           * The strip drops to a row of its own on a phone.
           *
           * `order-last w-full` inside the wrapping row is what does it; from
           * `sm` it returns to its place between the arrows. Measured rather
           * than guessed: with everything on one line the strip was 238px of
           * a 390px screen and fitted three chips, because the picker reads
           * "4 September 2026" and the two arrows took a third of what was
           * left. Full width it fits six.
           *
           * `min-w-0` is the part that is easy to miss: a flex child whose
           * content overflows will refuse to shrink below its content width
           * without it, and the row then pushes past the viewport.
           */
          className="no-scrollbar order-last flex w-full min-w-0 gap-2 overflow-x-auto scroll-smooth py-1 sm:order-none sm:w-auto sm:flex-1"
        >
          {days.map((d, i) => {
            const date = new Date(`${d}T12:00:00`);
            const count = (byDay.get(d) ?? []).filter(
              (x) => x.spotsLeft > 0 && x.bookable,
            ).length;
            const active = d === activeDay;
            const weekday = date.getDay();
            const isSunday = weekday === 0;
            const isSaturday = weekday === 6;
            const isClosedDay = closedDays.has(d);
            /* Closed is a fact of the rota now, not a hard-coded Sunday: a day
               the weekly schedule gives no classes reads as closed, so Saturday
               shows "Studio closed" exactly as Sunday does, and a future change
               to the rota carries the strip with it. Admin closures still count. */
            const closed = classHoursOn(weekday).length === 0 || isClosedDay;
            const todayKey = studioDateKey(studioStartOfDay(new Date()));
            const tomorrowKey = studioDateKey(
              studioAddDays(studioStartOfDay(new Date()), 1),
            );
            const isToday = d === todayKey;
            const isTomorrow = d === tomorrowKey;

            return (
              <button
                key={d}
                data-day={d}
                onClick={() => setActiveDay(d)}
                className={cn(
                  "flex min-w-[84px] shrink-0 flex-col items-center rounded-2xl border px-4 py-3 transition-all duration-500 ease-silk",
                  active
                    ? "border-mocha-600 bg-mocha-600 text-cream"
                    : closed
                      ? "border-dashed border-mocha-200/80 bg-white/40 text-mocha-400"
                      : count === 0
                        ? "border-mocha-200/60 bg-white/40 text-mocha-400"
                        : "border-mocha-200/70 bg-white/50 hover:border-mocha-400",
                )}
              >
                <span
                  className={cn(
                    "text-[9px] uppercase tracking-widest",
                    active ? "text-cream/60" : "text-clay",
                  )}
                >
                  {isToday
                    ? t.common.today
                    : isTomorrow
                      ? t.common.tomorrow
                      : isSunday
                        ? t.home.timetable.sunday
                        : isSaturday
                          ? t.home.timetable.saturday
                          : isClosedDay
                            ? t.home.timetable.closed
                            : fmtWeekdayShort(date)}
                </span>
                {/**
                 * The date, numerically: `05/09`.
                 *
                 * It was `5 SEPT` — the day number large with an abbreviated
                 * month beside it. The month has to be there at all because
                 * the strip spans three months and passes the same day number
                 * three times, so "5" alone is ambiguous to somebody scrolling
                 * ahead to book a term.
                 *
                 * The studio asked for digits, and they are better here than
                 * the words were: `05/09` is one token the eye reads as a
                 * date, it is the form written on everything else in Cyprus,
                 * and it is the same width in both languages — `SEPT` and
                 * `ΣΕΠ` are not, which made the chips jog sideways when the
                 * language changed.
                 *
                 * Day first, month second, zero-padded. Deliberately not
                 * `Intl`: every locale format is a different order, and this
                 * has to be `dd/mm` for a Cypriot reader whichever language
                 * the site is in.
                 */}
                <span className="mt-1 font-display text-xl lining-nums tabular-nums">
                  {String(date.getDate()).padStart(2, "0")}/
                  {String(date.getMonth() + 1).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "mt-0.5 text-[9px] lining-nums tabular-nums",
                    active ? "text-cream/60" : "text-clay/70",
                  )}
                >
                  {closed ? t.home.timetable.closed : count}
                </span>
              </button>
            );
          })}
        </div>

        <StripArrow
          dir="next"
          label={
            atWindowEnd
              ? t.timetablePage.nextWindow.replace(
                  "{n}",
                  String(TIMETABLE_DAYS),
                )
              : t.timetablePage.nextWeek
          }
          showLabel={atWindowEnd && !windowIsLast}
          disabled={atWindowEnd && windowIsLast}
          onClick={() => {
            if (!atWindowEnd) {
              stepDay(1);
              nudge(1);
              return;
            }
            router.push(`/timetable?date=${windowShift(1)}`);
          }}
        />
      </div>

      {/* toast */}
      {toast && (
        <div
          className={cn(
            "animate-fade-up",
            "mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-sm",
            toast.kind === "ok" && "border-mocha-300 bg-white text-mocha-600",
            toast.kind === "warn" &&
              "border-gold/40 bg-[#FBF6E7] text-mocha-700",
            toast.kind === "error" && "border-red-200 bg-red-50 text-red-700",
          )}
          role="status"
        >
          <span>{toast.text}</span>
          {toast.cta && (
            <ButtonLink href={toast.cta.href} size="sm">
              {toast.cta.label}
            </ButtonLink>
          )}
        </div>
      )}

      {/* Directly under the "booked" message, so the question is read as being
          about the class they just took. The toast clears itself after six
          seconds; this does not, because it is asking something. */}
      <PushInvite publicKey={pushPublicKey} show={justBooked} />

      {/* Shown once, only after a member's very first booking: the moment they
          have committed to one class and topping up to keep the habit is a
          welcome suggestion rather than a sell. Everyone else already has the
          "Top up sessions" button in the row above. */}
      {firstBooking && (
        <div className="mt-4 rounded-2xl border border-mocha-200/70 bg-cream-200/40 p-4">
          <p className="text-[13px] font-medium text-mocha-600">
            {t.booking.firstTopUpTitle}
          </p>
          <p className="mt-1 text-[13px] text-clay">
            {t.booking.firstTopUpBody}
          </p>
          <ButtonLink href="/pricing" size="sm" className="mt-3">
            {t.account.walletTopUp}
          </ButtonLink>
        </div>
      )}

      {/* Times as chips, then one detail panel. No long list to scroll. */}
      <div className="mt-8">
        <p className="eyebrow mb-5">
          {fmtLongDate(new Date(`${activeDay}T12:00:00`))}
        </p>

        {list.length === 0 ? (
          (() => {
            /* A desk closure carries a reason ("Public holiday"), shown inside a
               label below the "Studio closed" pill. A rota-empty day (Sunday)
               has no closure row and shows just the pill; a normal open day with
               nothing scheduled shows the plain "no classes" line. */
            const c = closedDays.get(activeDay);
            const reason =
              (locale === "el" ? c?.reasonEl : c?.reasonEn)?.trim() ||
              c?.reasonEn?.trim() ||
              c?.reasonEl?.trim();
            const isClosed =
              classHoursOn(new Date(`${activeDay}T12:00:00`).getDay())
                .length === 0 || closedDays.has(activeDay);
            if (!isClosed) {
              return (
                <p className="rounded-2xl border border-dashed border-mocha-200 px-6 py-14 text-center text-sm text-clay">
                  {t.timetablePage.noClasses}
                </p>
              );
            }
            return (
              <div className="flex flex-col items-center gap-3 rounded-3xl border border-mocha-200/70 bg-white/50 px-6 py-16 text-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-mocha-600 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-cream">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-cream/70"
                  />
                  {t.home.timetable.closed}
                </span>
                {reason && (
                  <p className="font-display text-xl text-mocha-600">{reason}</p>
                )}
              </div>
            );
          })()
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start lg:gap-8">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-4">
                {list.map((s) => {
                  const on = picked?.id === s.id;
                  const full = s.spotsLeft <= 0;
                  const mine = Boolean(s.myBookingId);
                  const solo = isPersonal(s);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setPickedId(s.id)}
                      aria-pressed={on}
                      className={cn(
                        "relative rounded-xl border py-2.5 text-center transition-all duration-400 ease-silk",
                        on
                          ? "border-mocha-600 bg-mocha-600 text-cream"
                          : full || !s.bookable
                            ? "border-mocha-200/60 bg-white/40 text-mocha-400"
                            : /* Appointments carry the studio's gold rather than
                                 the ordinary hairline. They are a different
                                 thing at a different price, and three chips in
                                 the middle of a column of fourteen identical
                                 ones would otherwise be found by accident. */
                              solo
                              ? "border-gold/60 bg-[#FBF6E7]/70 text-mocha-600 hover:border-gold"
                              : "border-mocha-200/70 bg-white/60 text-mocha-600 hover:border-mocha-500",
                      )}
                    >
                      <span className="block font-display text-lg leading-none lining-nums tabular-nums">
                        {fmtTime(s.startsAt)}
                      </span>
                      <span
                        className={cn(
                          "mt-1 block text-[9px] uppercase tracking-widest",
                          on
                            ? "text-cream/60"
                            : solo
                              ? "text-[#8a6f1a]"
                              : "text-clay/80",
                        )}
                      >
                        {/* "1/1" is not a number anybody needs. One reformer is
                            either free or it is not. */}
                        {solo
                          ? full
                            ? t.common.full
                            : t.booking.personalChip
                          : full
                            ? t.common.full
                            : /* Was "4/5", which reads as a score and left the
                                 member to work out which half was the one they
                                 cared about. `fmtSpots` says "4 spots left",
                                 singular when it is one, in either language. */
                              fmtSpots(s.spotsLeft)}
                      </span>
                      {mine && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
                            on ? "bg-cream" : "bg-mocha-600",
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {picked && (
                <div
                  key={picked.id}
                  className="animate-fade-up rounded-3xl border border-mocha-200/70 bg-white/60 p-6 backdrop-blur-sm sm:p-7"
                >
                  <div className="flex flex-col gap-6">
                    <div>
                      <p className="font-display text-4xl lining-nums tabular-nums text-mocha-600">
                        {fmtTime(picked.startsAt)}
                        <span className="ml-2 align-middle text-base text-clay">
                          {fmtTime(endOf(picked, types))}
                        </span>
                      </p>
                      <p className="mt-3 text-[17px] text-mocha-600">
                        {el
                          ? types[picked.type].nameEl
                          : types[picked.type].nameEn}
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-clay">
                        {pickedPersonal ? (
                          <span className="uppercase tracking-widest text-[#8a6f1a]">
                            {t.booking.personalTag}
                          </span>
                        ) : (
                          <span className="uppercase tracking-widest">
                            {el
                              ? (LEVEL[picked.level]?.el ?? picked.level)
                              : (LEVEL[picked.level]?.en ?? picked.level)}
                          </span>
                        )}
                        {picked.instructor && (
                          <>
                            <span className="h-1 w-1 rounded-full bg-clay/50" />
                            <span>{picked.instructor}</span>
                          </>
                        )}
                        <span className="h-1 w-1 rounded-full bg-clay/50" />
                        <span
                          className={cn(
                            "lining-nums tabular-nums",
                            picked.spotsLeft <= 0
                              ? "text-red-600/80"
                              : "text-mocha-500",
                          )}
                        >
                          {picked.spotsLeft <= 0
                            ? pickedPersonal
                              ? t.booking.personalTaken
                              : t.common.full
                            : pickedPersonal
                              ? t.booking.personalFree
                              : fmtSpots(picked.spotsLeft)}
                        </span>
                      </p>

                      {/* What the hour is, and what it costs, said once. A
                          member who has never bought one of these has no idea
                          from the chip alone that it is not an ordinary class
                          at an odd time. */}
                      {pickedPersonal && (
                        <p className="mt-4 rounded-2xl border border-gold/40 bg-[#FBF6E7]/60 px-4 py-3 text-[12px] leading-relaxed text-mocha-600">
                          {t.booking.personalExplainer}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-stretch gap-3 border-t border-mocha-200/70 pt-5">
                      {/* A fill bar over one reformer is either empty or full,
                          which is a graph of a boolean. Only drawn for classes,
                          where it says something. */}
                      {!pickedPersonal && (
                        <span
                          aria-hidden
                          className="h-1 w-full overflow-hidden rounded-full bg-mocha-200"
                        >
                          <span
                            className="block h-full rounded-full bg-mocha-500 transition-all duration-700 ease-silk"
                            style={{
                              width: `${(picked.booked / picked.capacity) * 100}%`,
                            }}
                          />
                        </span>
                      )}

                      {/**
                       * How many of you, asked before the button and not after.
                       *
                       * Only shown to somebody holding a duet session. Offering
                       * "two of us" to a member who cannot pay for two is an
                       * invitation to type a friend's name and be told no, and
                       * the refusal would arrive after the decision rather than
                       * before it. Somebody who has not bought one yet reads the
                       * explainer above instead, which says what a duet is.
                       */}
                      {pickedPersonal &&
                        !picked.myBookingId &&
                        picked.bookable &&
                        picked.spotsLeft > 0 &&
                        duetCredits > 0 && (
                          <div className="rounded-2xl border border-mocha-200/70 bg-white/70 p-4">
                            <p className="text-[10px] uppercase tracking-widest text-clay">
                              {t.booking.whoIsComing}
                            </p>

                            {canChoose ? (
                              <div className="mt-3 flex gap-2">
                                {[false, true].map((two) => (
                                  <button
                                    key={String(two)}
                                    type="button"
                                    onClick={() => setTwoOfUs(two)}
                                    aria-pressed={twoOfUs === two}
                                    className={cn(
                                      "flex-1 rounded-xl border px-3 py-2 text-[12px] transition-all duration-400",
                                      twoOfUs === two
                                        ? "border-mocha-600 bg-mocha-600 text-cream"
                                        : "border-mocha-200/70 bg-white/60 text-mocha-600 hover:border-mocha-400",
                                    )}
                                  >
                                    {two ? t.booking.twoOfUs : t.booking.justMe}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              /* No choice to offer: a Duet is what they hold, a
                                 Duet is for two. Say so instead of showing a
                                 toggle where one option would be refused. */
                              <p className="mt-2 text-[12px] leading-relaxed text-mocha-600">
                                {t.booking.duetForcedNote}
                              </p>
                            )}

                            {bringing && (
                              <div className="mt-3">
                                <label className="label" htmlFor="guest">
                                  {t.booking.guestLabel}
                                </label>
                                <input
                                  id="guest"
                                  className="input"
                                  value={guestName}
                                  maxLength={80}
                                  autoComplete="off"
                                  onChange={(e) => setGuestName(e.target.value)}
                                  placeholder={t.booking.guestPlaceholder}
                                />
                                <p className="mt-2 text-[10px] leading-snug text-clay">
                                  {t.booking.guestHint}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                      {picked.myBookingId ? (
                        <>
                          <Button
                            /**
                             * One button, in one style, whichever side of the
                             * window this booking is on.
                             *
                             * It used to be a solid grey block and disabled
                             * once cancelling had closed — a door that is
                             * shut, which is what it was. Now the door opens
                             * and the price of walking through it is a
                             * session, so it has to look pressable. The line
                             * underneath says what it costs before the press,
                             * and the dialog says it again after.
                             */
                            variant="outline"
                            size="sm"
                            disabled={busy === picked.id}
                            onClick={() =>
                              canCancelPicked
                                ? cancel(picked)
                                : setForfeiting(picked)
                            }
                          >
                            {busy === picked.id
                              ? t.common.loading
                              : t.account.cancelBooking}
                          </Button>
                          {!canCancelPicked && (
                            <span className="text-[10px] leading-snug text-clay">
                              {t.booking.cancelForfeitHint}
                            </span>
                          )}
                        </>
                      ) : !picked.bookable ? (
                        <span className="text-[10px] uppercase tracking-widest text-clay/70">
                          {pickedPersonal
                            ? t.booking.personalTooLate
                            : t.booking.tooLate}
                        </span>
                      ) : picked.spotsLeft <= 0 ? (
                        <span className="text-[10px] uppercase tracking-widest text-clay/70">
                          {pickedPersonal
                            ? t.booking.personalTaken
                            : t.common.full}
                        </span>
                      ) : (
                        <>
                          <Button
                            disabled={
                              busy === picked.id ||
                              repeating ||
                              /* A duet with nobody named is a booking the
                                 instructor cannot prepare for. */
                              (pickedPersonal &&
                                bringing &&
                                guestName.trim().length < 2)
                            }
                            onClick={() => book(picked)}
                          >
                            {busy === picked.id
                              ? t.booking.booking
                              : pickedPersonal
                                ? t.booking.bookPersonal
                                : t.booking.bookNow}
                          </Button>
                          {pickedPersonal && (
                            <span className="text-[10px] leading-snug text-clay">
                              {t.booking.personalCutoff}
                            </span>
                          )}

                          {/**
                           * Booking the same slot for a term.
                           *
                           * Members train on a fixed slot and the studio sells
                           * three-month packs, so a term of Mondays was twelve
                           * separate visits to this page. Two days a week is
                           * two presses now instead of twenty-four.
                           *
                           * Group classes only, and that is a studio decision
                           * rather than a gap: every Personal hour commits
                           * somebody to come in and teach it, arranged by hand
                           * the day before, so twelve of them booked in one
                           * press is twelve instructor hours promised without
                           * anybody at the desk seeing it happen.
                           *
                           * Collapsed until asked for. It is the second thing
                           * anybody wants from this panel and putting a row of
                           * week counts above the Book button would make the
                           * common case read as a decision.
                           */}
                          {!pickedPersonal && signedIn && (
                            <div className="mt-1 w-full">
                              {repeatWeeks === null ? (
                                <button
                                  type="button"
                                  onClick={() => setRepeatWeeks(4)}
                                  className="text-[10px] font-semibold uppercase tracking-widest text-mocha-700 underline decoration-mocha-400 underline-offset-4 transition-colors hover:text-mocha-900"
                                >
                                  {t.booking.repeatTitle}
                                </button>
                              ) : (
                                <div className="rounded-2xl border border-mocha-200/70 bg-white/70 p-4">
                                  <p className="text-[10px] uppercase tracking-widest text-clay">
                                    {t.booking.repeatTitle}
                                  </p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {/* In weeks, as the studio asked, but chosen to read as the terms they
    sell: a month, two, a term, half a year, a year. Anything finer is a
    number nobody is choosing between. */}
                                    {REPEAT_RUNS.map(({ months, weeks: w }) => (
                                      <button
                                        key={w}
                                        type="button"
                                        onClick={() => setRepeatWeeks(w)}
                                        aria-pressed={repeatWeeks === w}
                                        className={cn(
                                          "rounded-xl border px-3 py-2 text-[12px] transition-all duration-400",
                                          repeatWeeks === w
                                            ? "border-mocha-600 bg-mocha-600 text-cream"
                                            : "border-mocha-200/70 bg-white/60 text-mocha-600 hover:border-mocha-400",
                                        )}
                                      >
                                        {months === 1
                                          ? t.booking.repeatOneMonth
                                          : t.booking.repeatMonths.replace(
                                              "{n}",
                                              String(months),
                                            )}
                                      </button>
                                    ))}
                                  </div>
                                  <p className="mt-3 text-[10px] leading-snug text-clay">
                                    {t.booking.repeatHint}
                                  </p>
                                  <Button
                                    size="sm"
                                    className="mt-3"
                                    disabled={repeating || busy === picked.id}
                                    onClick={() => repeat(picked, repeatWeeks)}
                                  >
                                    {repeating
                                      ? t.booking.repeatWorking
                                      : t.booking.repeatGo.replace(
                                          "{n}",
                                          String(repeatWeeks),
                                        )}
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/**
        * The words the studio asked for, before a session is given up.
        *
        * Only ever reached for a booking past the free window: inside it the
        * cancel is one press and there is nothing to warn about. The server
        * refuses the same cancel without the `forfeit` this dialog sets, so
        * the question cannot be walked around by a stale tab.
        */}
      {forfeiting && (
        <ConfirmDialog
          title={t.booking.cancelForfeitTitle}
          body={t.booking.cancelForfeitBody}
          cancelLabel={t.booking.cancelForfeitNo}
          onClose={() => setForfeiting(null)}
          actions={[
            {
              label: t.booking.cancelForfeitYes,
              busy: busy === forfeiting.id,
              onClick: () => void cancel(forfeiting, true),
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * A thin ring with a hand-drawn chevron. Two strokes rather than a glyph, so
 * the weight matches the hairline rules used everywhere else on the page.
 */
/**
 * The strip's arrows, which do two different jobs depending on where you are.
 *
 * In the middle of the window they step a day. On the last chip of the window
 * they fetch the next thirty days — a different action, so it stops being a
 * bare glyph and says what it does. A round arrow that silently changes meaning
 * is the version of this nobody discovers: the studio asked for the arrow to
 * "say click to see the next 30 days", and that is what `showLabel` is.
 */
function StripArrow({
  dir,
  label,
  disabled,
  showLabel,
  onClick,
}: {
  dir: "prev" | "next";
  label: string;
  disabled?: boolean;
  /** Spell the label out beside the glyph, for when this pages the window. */
  showLabel?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "group grid shrink-0 place-items-center rounded-full border transition-all duration-500 ease-silk",
        showLabel
          ? "h-11 auto-cols-auto grid-flow-col items-center gap-2 px-4 text-[10px] uppercase tracking-widest"
          : "h-11 w-11",
        disabled
          ? "cursor-not-allowed border-mocha-200/50 text-mocha-300"
          : "border-mocha-300 text-mocha-500 hover:border-mocha-600 hover:bg-mocha-600 hover:text-cream",
      )}
    >
      {showLabel && dir === "prev" ? <span>{label}</span> : null}
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className={cn(
          "h-4 w-4 transition-transform duration-500 ease-silk",
          dir === "prev"
            ? "group-hover:-translate-x-0.5"
            : "rotate-180 group-hover:translate-x-0.5",
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      >
        <path d="M14.5 4.5 7 12l7.5 7.5" />
        <path d="M18.5 12H7.4" />
      </svg>
      {showLabel && dir === "next" ? <span>{label}</span> : null}
    </button>
  );
}
