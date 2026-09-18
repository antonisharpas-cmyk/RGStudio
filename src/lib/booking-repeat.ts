import { and, asc, eq, gt, lte } from "drizzle-orm";
import { db } from "@/db";
import { classSessions, classTypes } from "@/db/schema";
import { bookClass, type BookingResultCode } from "./booking";
import { studioAddDays, studioDayOfWeek, studioParts } from "./time";

/**
 * "Book my Monday ten o'clock for the next seven weeks."
 *
 * The studio sells three-month packs and members train on a fixed slot: the same
 * class, the same hour, the same two days a week, for a term. Booking that a
 * class at a time meant twenty-four visits to the timetable, and the studio was
 * asked for something better within a week of the packs going on sale.
 *
 * ---
 *
 * **What counts as "the same class".**
 *
 * Same class type, same weekday, same wall-clock start. Not the same instructor:
 * the rota is the studio's business and changes weeks ahead of a class, and a
 * member repeating their Monday slot is asking for the slot, not for Andreas.
 *
 * Matched on the studio's own weekday and minutes rather than by adding seven
 * days repeatedly, which is the same thing until a clock change: Cyprus moves in
 * late October, so a naive "+7 days" from September lands an hour out for the
 * back half of a twelve-week booking, and the member's Monday 10:00 becomes a
 * Monday 09:00 they never asked for.
 *
 * ---
 *
 * **Every week is booked on its own terms, and a refusal is not a failure.**
 *
 * This is a loop over `bookClass`, deliberately. Every rule that protects one
 * booking has to protect all of them: the capacity of the room, the sessions in
 * hand, the day limit on an Unlimited plan, the expiry date of a pack that runs
 * out in week nine. Reimplementing any of that here would be a second copy of
 * the rules, and a second copy is one that will eventually disagree.
 *
 * So the honest answer is a partial one. "Booked six of seven; the 24th is
 * full" is useful. Refusing all seven because one is full is not, and neither is
 * booking six and saying nothing about the seventh.
 *
 * ---
 *
 * **Group classes only.**
 *
 * An appointment is not repeatable from here and that is a studio decision, not
 * a missing feature. Every Personal or Duet hour commits somebody to come in and
 * teach it, arranged by hand the day before; twelve of them booked in one press
 * is twelve instructor hours the studio has promised without anybody at the desk
 * seeing it happen. Those stay one at a time.
 */

/**
 * The most weeks one press may book. Nine months, the longest term the studio
 * sells.
 *
 * This was 13 — "a term, and not a year" — and that was the right ceiling while
 * the longest pack was three months. The studio now sells 6 and 9 month packs,
 * and a member holding 72 sessions for their Monday and Thursday slots cannot be
 * asked to press the button several times. It rose to 52 while a twelve-month
 * pack was on sale; that pack is gone, so the ceiling comes back to the nine
 * months of the longest one that remains.
 *
 * The real protection was never this number. Every week still goes through
 * `bookClass` on its own terms, so a run stops itself the moment the sessions
 * run out, the pack expires or a class is full — and reports which.
 */
export const MAX_REPEAT_WEEKS = 39;

export type RepeatOutcome = {
  sessionId: string;
  /** ISO, so the caller can name the date it could not book. */
  startsAt: string;
  ok: boolean;
  /** Why not, when not. Absent on success. */
  code?: BookingResultCode;
  /** Set on success, for a caller that has bookkeeping of its own to do. */
  bookingId?: string;
  /**
   * Which package paid for it. Only the desk needs this, and it needs it to
   * write the ledger line that names the receptionist who took the call — see
   * `repeatForMember`. Surfaced here rather than looked up afterwards because
   * `bookClass` already knows and a second query per week to re-derive it would
   * be twelve queries to learn what twelve returns already told us.
   */
  creditBatchId?: string | null;
  /**
   * The last class date their sessions reach. Only on SESSIONS_EXPIRE_FIRST.
   *
   * This is the one refusal a member cannot act on without a date. "Four of
   * your eight weeks could not be booked" to somebody who can see eight
   * sessions sitting in their balance reads as a fault in the website, and the
   * true answer — the pack runs out on the 3rd of October — is both the reason
   * and the thing to do about it. Carried per week rather than once, because
   * different weeks could in principle be refused by different batches.
   */
  until?: string;
};

export type RepeatResult =
  | {
      ok: true;
      /** How many were actually taken by this call. */
      booked: number;
      /** Already theirs before this ran. Not a failure and not a new booking. */
      alreadyHad: number;
      /** Weeks that could not be booked, with the reason for each. */
      failed: RepeatOutcome[];
      /** Every week considered, in order, for a caller that wants the detail. */
      outcomes: RepeatOutcome[];
      /** The first booking made, so the caller can schedule what it needs to. */
      firstBookingId: string | null;
      bookingIds: string[];
    }
  | { ok: false; code: "SESSION_NOT_FOUND" | "NOT_REPEATABLE" | "BAD_WEEKS" };

export function repeatWeekly(args: {
  userId: string;
  /** The class they are looking at. Week one of the run. */
  sessionId: string;
  /** Including the one they picked. 4 means this week and three more. */
  weeks: number;
  now?: Date;
}): RepeatResult {
  const now = args.now ?? new Date();

  if (
    !Number.isInteger(args.weeks) ||
    args.weeks < 2 ||
    args.weeks > MAX_REPEAT_WEEKS
  ) {
    return { ok: false, code: "BAD_WEEKS" };
  }

  const seed = db
    .select({
      id: classSessions.id,
      startsAt: classSessions.startsAt,
      classTypeId: classSessions.classTypeId,
      kind: classTypes.kind,
    })
    .from(classSessions)
    .innerJoin(classTypes, eq(classSessions.classTypeId, classTypes.id))
    .where(eq(classSessions.id, args.sessionId))
    .get();

  if (!seed) return { ok: false, code: "SESSION_NOT_FOUND" };
  if (seed.kind === "PERSONAL") return { ok: false, code: "NOT_REPEATABLE" };

  /* The slot, in the studio's own terms: which weekday and which minute of it.
     This is what survives a clock change; an offset in milliseconds does not. */
  const seedParts = studioParts(seed.startsAt);
  const weekday = studioDayOfWeek(seed.startsAt);
  const minuteOfDay = seedParts.hour * 60 + seedParts.minute;

  /**
   * Every class of the same type in the window, then filtered to the slot.
   *
   * One query rather than one per week. The window is closed at both ends so a
   * member cannot ask for thirteen weeks and be handed a class in March because
   * the timetable happens to run that far.
   */
  const until = studioAddDays(seed.startsAt, (args.weeks - 1) * 7 + 1);

  const candidates = db
    .select({ id: classSessions.id, startsAt: classSessions.startsAt })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.classTypeId, seed.classTypeId),
        eq(classSessions.status, "SCHEDULED"),
        gt(classSessions.startsAt, studioAddDays(seed.startsAt, -1)),
        lte(classSessions.startsAt, until),
      ),
    )
    .orderBy(asc(classSessions.startsAt))
    .all()
    .filter((s) => {
      const p = studioParts(s.startsAt);
      return (
        studioDayOfWeek(s.startsAt) === weekday &&
        p.hour * 60 + p.minute === minuteOfDay
      );
    })
    .slice(0, args.weeks);

  const outcomes: RepeatOutcome[] = [];
  const bookingIds: string[] = [];
  let booked = 0;
  let alreadyHad = 0;

  for (const c of candidates) {
    const res = bookClass(args.userId, c.id, { now });
    const entry: RepeatOutcome = {
      sessionId: c.id,
      startsAt: c.startsAt.toISOString(),
      ok: res.ok,
      ...(res.ok
        ? { bookingId: res.bookingId, creditBatchId: res.creditBatchId }
        : {
            code: res.code,
            ...(res.until ? { until: res.until.toISOString() } : {}),
          }),
    };
    outcomes.push(entry);

    if (res.ok) {
      booked++;
      bookingIds.push(res.bookingId);
      continue;
    }
    /* Already theirs is not a refusal in any sense a member would recognise —
       they asked for their Monday slot and they have their Monday slot. Counted
       separately so the summary can say "6 booked, 1 you already had" rather
       than reporting a failure nobody needs to act on. */
    if (res.code === "ALREADY_BOOKED") alreadyHad++;
  }

  return {
    ok: true,
    booked,
    alreadyHad,
    failed: outcomes.filter((o) => !o.ok && o.code !== "ALREADY_BOOKED"),
    outcomes,
    firstBookingId: bookingIds[0] ?? null,
    bookingIds,
  };
}
