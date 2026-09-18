import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  classSessions,
  studioClosures,
  users,
  type StudioClosure,
} from "@/db/schema";
import { refundOneCredit } from "@/lib/credits";
import { studioDateKey, studioStartOfDay, studioAddDays } from "@/lib/time";

/**
 * Days the studio is shut.
 *
 * A closure is a statement about a *day in Larnaca* — the 15th of August, the
 * fortnight in July — not about an instant in time, so it is stored as the
 * studio's own calendar day and compared that way. That keeps it right whether
 * the server runs in Cyprus or in UTC.
 *
 * Closing a day is not a soft thing: every booking on it is cancelled and the
 * session goes back to the member, even inside the 24-hour window, because it
 * is the studio that changed its mind and not the member. The classes are
 * marked cancelled so the timetable stops offering them, and reception gets the
 * list of everyone affected so they can be told.
 */

export type ClosureView = {
  id: string;
  day: string;
  reasonEn: string;
  reasonEl: string;
  /** Classes that were cancelled when the day was closed. */
  classesCancelled: number;
  bookingsRefunded: number;
};

export type CloseResult = {
  day: string;
  classesCancelled: number;
  /** Who lost a class, so the desk can ring them. */
  affected: {
    userId: string;
    name: string;
    email: string;
    phone: string | null;
    startsAt: Date;
    refunded: boolean;
  }[];
};

/** Every closure from today onwards, soonest first. */
export function upcomingClosures(now = new Date()): StudioClosure[] {
  const from = studioDateKey(studioStartOfDay(now));
  return db
    .select()
    .from(studioClosures)
    .all()
    .filter((c) => c.day >= from)
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The closed days, each with the reason the desk typed for it, for the
 * timetable to skip and to label.
 *
 * A Map rather than a Set, because a closed day is not only a date to grey out
 * — the studio wrote "Public holiday" or "Christmas" against it and the member
 * should see that instead of a bare "Studio closed". `.has(day)` still answers
 * the "is this day closed" question the strip asks; `.get(day)` carries the
 * reason for the panel. A day the weekly rota simply has no classes on (a
 * Sunday) is not in here and keeps the generic label — only a desk closure has
 * a reason to show.
 */
export function closedDayReasons(): Map<
  string,
  { reasonEn: string; reasonEl: string }
> {
  const out = new Map<string, { reasonEn: string; reasonEl: string }>();
  for (const r of db
    .select({
      day: studioClosures.day,
      reasonEn: studioClosures.reasonEn,
      reasonEl: studioClosures.reasonEl,
    })
    .from(studioClosures)
    .all()) {
    out.set(r.day, { reasonEn: r.reasonEn, reasonEl: r.reasonEl });
  }
  return out;
}

export function isClosed(day: Date | string) {
  const key = typeof day === "string" ? day : studioDateKey(day);
  return Boolean(
    db.select().from(studioClosures).where(eq(studioClosures.day, key)).get(),
  );
}

/**
 * Shut one day.
 *
 * Everything happens in one transaction: if a single refund fails, the day is
 * not left half closed with half the members refunded.
 */
export function closeDay(args: {
  day: string;
  reasonEn: string;
  reasonEl?: string;
  staffId: string;
  now?: Date;
}): CloseResult {
  const { day, reasonEn, reasonEl = "", staffId, now = new Date() } = args;

  return db.transaction((): CloseResult => {
    db.insert(studioClosures)
      .values({ day, reasonEn, reasonEl, createdBy: staffId })
      .onConflictDoUpdate({
        target: studioClosures.day,
        set: { reasonEn, reasonEl },
      })
      .run();

    /* The day, as the studio reckons it. */
    const start = studioStartOfDay(new Date(`${day}T12:00:00Z`));
    const end = studioAddDays(start, 1);

    const doomed = db
      .select()
      .from(classSessions)
      .where(
        and(gte(classSessions.startsAt, start), lt(classSessions.startsAt, end)),
      )
      .all();

    if (!doomed.length) return { day, classesCancelled: 0, affected: [] };

    const ids = doomed.map((s) => s.id);
    const live = db
      .select()
      .from(bookings)
      .where(
        and(
          inArray(bookings.sessionId, ids),
          eq(bookings.status, "CONFIRMED"),
        ),
      )
      .all();

    const affected: CloseResult["affected"] = [];

    for (const booking of live) {
      /* Past classes are history: a class that already happened is not refunded
         because the studio closed the day afterwards. */
      const session = doomed.find((s) => s.id === booking.sessionId)!;
      const future = session.startsAt.getTime() > now.getTime();

      if (future) {
        refundOneCredit(booking.userId, booking.creditBatchId, {
          bookingId: booking.id,
          note: `Studio closed ${day}`,
        });
        db.update(bookings)
          .set({ status: "CANCELLED", cancelledAt: now, creditRefunded: true })
          .where(eq(bookings.id, booking.id))
          .run();
      }

      const member = db
        .select({
          name: users.name,
          email: users.email,
          phone: users.phone,
        })
        .from(users)
        .where(eq(users.id, booking.userId))
        .get();

      affected.push({
        userId: booking.userId,
        name: member?.name ?? "",
        email: member?.email ?? "",
        phone: member?.phone ?? null,
        startsAt: session.startsAt,
        refunded: future,
      });
    }

    /* The classes themselves stop existing as far as the timetable is
       concerned. Kept as rows rather than deleted so the history of what was
       scheduled — and who had been in it — survives. */
    db.update(classSessions)
      .set({ status: "CANCELLED" })
      .where(inArray(classSessions.id, ids))
      .run();

    return { day, classesCancelled: doomed.length, affected };
  });
}

/** Open a day back up. Cancelled classes are restored; bookings are not. */
export function reopenDay(day: string) {
  return db.transaction(() => {
    const removed = db
      .delete(studioClosures)
      .where(eq(studioClosures.day, day))
      .run();

    if (!removed.changes) return { day, reopened: false, classesRestored: 0 };

    const start = studioStartOfDay(new Date(`${day}T12:00:00Z`));
    const end = studioAddDays(start, 1);

    /* The classes come back empty. Members whose bookings were refunded keep
       their sessions and book again if they still want the slot — quietly
       reinstating a booking somebody has been told is cancelled would be
       worse than asking them to rebook. */
    const restored = db
      .update(classSessions)
      .set({ status: "SCHEDULED" })
      .where(
        and(
          gte(classSessions.startsAt, start),
          lt(classSessions.startsAt, end),
          eq(classSessions.status, "CANCELLED"),
        ),
      )
      .run();

    return { day, reopened: true, classesRestored: restored.changes };
  });
}

export type CancelSessionResult =
  | { ok: false; code: "NOT_FOUND" | "ALREADY_CANCELLED" | "PAST" }
  | {
      ok: true;
      sessionId: string;
      startsAt: Date;
      /** How many members got a session back. */
      refunded: number;
      affected: {
        bookingId: string;
        userId: string;
        name: string;
        email: string;
        phone: string | null;
        refunded: boolean;
      }[];
    };

/**
 * Call off a single class, and put its members' sessions back.
 *
 * The small sibling of `closeDay`: not the whole day shut for a public holiday,
 * but one hour taken out of a working day — the studio opening late, closing
 * early, or a reformer down for two hours. So it is a desk action rather than an
 * owner one (an instructor calling in the fault is the ordinary case), and it
 * names one session instead of a date.
 *
 * The rules are the day-closure's rules, applied to one slot. The class stops
 * existing as far as the timetable is concerned, so nobody can book the hour the
 * studio has just said is off. Every confirmed booking on it is cancelled and
 * the session goes straight back to the member's balance, inside the usual
 * cancellation window or not, because it is the studio that changed its mind and
 * not the member. The affected list carries the booking ids so the caller can
 * tell each member their class is off and their session is back.
 *
 * Refused for a class that has already started or finished: those are history,
 * their members were there, and "refund the room" is not a thing that can be
 * done to an hour that has happened.
 */
export function cancelSession(args: {
  sessionId: string;
  now?: Date;
}): CancelSessionResult {
  const { sessionId, now = new Date() } = args;

  return db.transaction((): CancelSessionResult => {
    const session = db
      .select()
      .from(classSessions)
      .where(eq(classSessions.id, sessionId))
      .get();

    if (!session) return { ok: false, code: "NOT_FOUND" };
    if (session.status === "CANCELLED") {
      return { ok: false, code: "ALREADY_CANCELLED" };
    }
    /* An hour that has already begun cannot be un-run. The desk uses the
       member-by-member removal for tidying up an attended class; this control is
       only for a class that has not happened yet. */
    if (session.startsAt.getTime() <= now.getTime()) {
      return { ok: false, code: "PAST" };
    }

    const live = db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.sessionId, sessionId),
          eq(bookings.status, "CONFIRMED"),
        ),
      )
      .all();

    const affected: Extract<CancelSessionResult, { ok: true }>["affected"] = [];

    for (const booking of live) {
      refundOneCredit(booking.userId, booking.creditBatchId, {
        bookingId: booking.id,
        note: "Class cancelled by the studio",
      });
      db.update(bookings)
        .set({ status: "CANCELLED", cancelledAt: now, creditRefunded: true })
        .where(eq(bookings.id, booking.id))
        .run();

      const member = db
        .select({ name: users.name, email: users.email, phone: users.phone })
        .from(users)
        .where(eq(users.id, booking.userId))
        .get();

      affected.push({
        bookingId: booking.id,
        userId: booking.userId,
        name: member?.name ?? "",
        email: member?.email ?? "",
        phone: member?.phone ?? null,
        refunded: true,
      });
    }

    /* Kept as a row, not deleted, so the history of what was scheduled and who
       had been in it survives — the same choice `closeDay` makes. */
    db.update(classSessions)
      .set({ status: "CANCELLED" })
      .where(eq(classSessions.id, sessionId))
      .run();

    return {
      ok: true,
      sessionId,
      startsAt: session.startsAt,
      refunded: affected.length,
      affected,
    };
  });
}

export type RestoreSessionResult =
  | { ok: false; code: "NOT_FOUND" | "NOT_CANCELLED" }
  | { ok: true; sessionId: string };

/**
 * Put a single cancelled class back on the timetable.
 *
 * The undo for `cancelSession`, and the same shape as `reopenDay`: the class
 * comes back empty. The members whose sessions were refunded keep them and book
 * again if they still want the slot, exactly as when a whole day is reopened —
 * silently reinstating a booking somebody has been told is cancelled would be
 * the worse mistake. Refused for a class that is not actually cancelled, so a
 * double-click cannot turn into a confusing no-op that looks like it did
 * something.
 */
export function restoreSession(args: {
  sessionId: string;
}): RestoreSessionResult {
  return db.transaction((): RestoreSessionResult => {
    const session = db
      .select()
      .from(classSessions)
      .where(eq(classSessions.id, args.sessionId))
      .get();

    if (!session) return { ok: false, code: "NOT_FOUND" };
    if (session.status !== "CANCELLED") {
      return { ok: false, code: "NOT_CANCELLED" };
    }

    db.update(classSessions)
      .set({ status: "SCHEDULED" })
      .where(eq(classSessions.id, args.sessionId))
      .run();

    return { ok: true, sessionId: args.sessionId };
  });
}
