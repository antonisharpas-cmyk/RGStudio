import { and, asc, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, classSessions, creditBatches, creditLedger } from "@/db/schema";
import type { CreditKind } from "./packs";
import { windowAllows } from "./promo";
import { studioDateKey, studioEndOfDay } from "./time";

/**
 * What a class needs paying with.
 *
 * A group class takes a CLASS session and nothing else. A midday appointment
 * takes a PERSONAL one, or a DUET one when a second person is coming. Neither
 * can be paid for with the other's, in either direction: a member holding five
 * class sessions and one personal has six sessions and exactly one of them can
 * book noon on Tuesday.
 */
export function kindsThatPayFor(
  classKind: "GROUP" | "PERSONAL",
  seats = 1,
): CreditKind[] {
  if (classKind === "GROUP") return ["CLASS"];
  /**
   * Three kinds, and each buys exactly one thing.
   *
   * A Duet session admits two people and is priced for two, so it cannot be
   * spent on an hour where only one turns up: that would be the studio charging
   * €45 for a €30 hour, and it would leave a second reformer set up for nobody.
   * A Personal session cannot cover two for the mirror-image reason.
   *
   * This was briefly forgiving in the other direction, with a solo booking
   * falling back to a Duet session when no Personal one was held. It read as a
   * kindness and it was a hole: a member with a Duet in their balance could book
   * the hour alone, and the studio would have sold the pair rate for one person.
   */
  return seats > 1 ? ["DUET"] : ["PERSONAL"];
}

export type CreditSummary = {
  available: number;
  /** Only the sessions that buy a place in a group class. */
  classCredits: number;
  /** Sessions that buy a midday appointment, personal or duet. */
  personalCredits: number;
  /** Of those, the ones that admit a second person. */
  duetCredits: number;
  /**
   * Of those, the ones for one person alone.
   *
   * Reported apart from `duetCredits` rather than left to be subtracted,
   * because the two are not interchangeable and the screens that offer a
   * choice need to know which of them the member actually holds.
   */
  soloCredits: number;
  batches: {
    id: string;
    creditsRemaining: number;
    creditsTotal: number;
    expiresAt: Date | null;
    source: string;
    kind: string;
    perDayLimit: number | null;
    /** Set when these sessions may only be spent on classes in a date range. */
    usableFrom: Date | null;
    usableTo: Date | null;
  }[];
  /** Soonest expiry among batches that still hold credits */
  nextExpiry: Date | null;
  nextExpiryCredits: number;
};

/** Batches that still hold credits and have not expired, soonest expiry first. */
export async function liveBatches(userId: string, now = new Date()) {
  return db
    .select()
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.userId, userId),
        gt(creditBatches.creditsRemaining, 0),
        or(isNull(creditBatches.expiresAt), gt(creditBatches.expiresAt, now)),
        /* A monthly plan whose month is unpaid has its sessions frozen: still
           theirs, still on the record, not spendable until the month is
           settled. See lib/subscriptions.ts. */
        isNull(creditBatches.frozenAt),
      ),
    )
    .orderBy(asc(creditBatches.expiresAt), asc(creditBatches.createdAt));
}

export async function getCreditSummary(
  userId: string,
  now = new Date(),
): Promise<CreditSummary> {
  const batches = await liveBatches(userId, now);
  const available = batches.reduce((n, b) => n + b.creditsRemaining, 0);
  const withExpiry = batches.filter((b) => b.expiresAt);
  const nextExpiry = withExpiry[0]?.expiresAt ?? null;
  const nextExpiryCredits = nextExpiry
    ? batches
        .filter((b) => b.expiresAt?.getTime() === nextExpiry.getTime())
        .reduce((n, b) => n + b.creditsRemaining, 0)
    : 0;

  const sum = (kinds: string[]) =>
    batches
      .filter((b) => kinds.includes(b.kind))
      .reduce((n, b) => n + b.creditsRemaining, 0);

  return {
    available,
    /* Counted apart because they are not one balance. A member with five class
       sessions and one personal reading "6 sessions" and finding they cannot
       book two of the classes they were looking at is a site that lied to them
       in its own headline figure. */
    classCredits: sum(["CLASS"]),
    personalCredits: sum(["PERSONAL", "DUET"]),
    duetCredits: sum(["DUET"]),
    soloCredits: sum(["PERSONAL"]),
    batches: batches.map((b) => ({
      id: b.id,
      creditsRemaining: b.creditsRemaining,
      creditsTotal: b.creditsTotal,
      expiresAt: b.expiresAt,
      source: b.source,
      kind: b.kind,
      perDayLimit: b.perDayLimit,
      usableFrom: b.usableFrom,
      usableTo: b.usableTo,
    })),
    nextExpiry,
    nextExpiryCredits,
  };
}

/**
 * Does this member hold anything at all, window or no window?
 *
 * Used only to tell two failures apart: "you have no sessions" and "you have
 * sessions that cannot pay for *this* class". Those need different words on
 * screen, and a member with a visible balance of 1 being told they have none is
 * how a site loses somebody's trust in one sentence.
 */
export function spendableAnywhere(
  userId: string,
  now = new Date(),
  kinds?: CreditKind[],
) {
  return (
    db
      .select()
      .from(creditBatches)
      .where(
        and(
          eq(creditBatches.userId, userId),
          gt(creditBatches.creditsRemaining, 0),
          or(isNull(creditBatches.expiresAt), gt(creditBatches.expiresAt, now)),
          isNull(creditBatches.frozenAt),
        ),
      )
      .all()
      .filter((b) => !kinds || kinds.includes(b.kind as CreditKind)).length > 0
  );
}

export async function getAvailableCredits(userId: string, now = new Date()) {
  const rows = await liveBatches(userId, now);
  return rows.reduce((n, b) => n + b.creditsRemaining, 0);
}

/**
 * How many classes this member has already booked on a given studio day.
 *
 * Cancelled bookings do not count: somebody who booked 07:00, thought better of
 * it and cancelled in time has used nothing, and telling them they have had
 * their class for the day would be punishing them for changing their mind.
 *
 * Written as SQL against the studio's own calendar day rather than a range of
 * instants, because "one class a day" is a statement about days in Larnaca.
 */
export function bookingsOnStudioDay(
  userId: string,
  day: Date,
  /** A session to leave out, used when the member is re-booking one. */
  exceptSessionId?: string,
) {
  const key = studioDateKey(day);
  return db
    .select({ sessionId: bookings.sessionId, startsAt: classSessions.startsAt })
    .from(bookings)
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .where(and(eq(bookings.userId, userId), ne(bookings.status, "CANCELLED")))
    .all()
    .filter(
      (r) =>
        studioDateKey(r.startsAt) === key && r.sessionId !== exceptSessionId,
    ).length;
}

/**
 * Why a member holding sessions still cannot pay for this class.
 *
 * Worked out from the same three filters `spendOneCredit` applies, in the same
 * order, so the reason on screen is the reason the spend failed rather than a
 * guess made afterwards. Five outcomes and each needs its own sentence:
 *
 *   NONE        they hold nothing at all
 *   WRONG_KIND  they hold sessions, but not the kind this class takes
 *   WINDOW      the right kind, restricted to other dates (the opening week)
 *   PER_DAY     the right kind, but they have already trained today
 *   NOT_BLOCKED nothing here explains it, so the caller should not claim to
 */
export function spendBlockReason(
  userId: string,
  opts: { classStartsAt: Date; kinds?: CreditKind[]; sessionId?: string },
  now = new Date(),
): "NONE" | "WRONG_KIND" | "WINDOW" | "PER_DAY" | "NOT_BLOCKED" {
  const all = db
    .select()
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.userId, userId),
        gt(creditBatches.creditsRemaining, 0),
        or(isNull(creditBatches.expiresAt), gt(creditBatches.expiresAt, now)),
        isNull(creditBatches.frozenAt),
      ),
    )
    .all();

  if (all.length === 0) return "NONE";

  const rightKind = opts.kinds
    ? all.filter((b) => opts.kinds!.includes(b.kind as CreditKind))
    : all;
  if (rightKind.length === 0) return "WRONG_KIND";

  const inWindow = rightKind.filter((b) => windowAllows(b, opts.classStartsAt));
  if (inWindow.length === 0) return "WINDOW";

  const already = bookingsOnStudioDay(
    userId,
    opts.classStartsAt,
    opts.sessionId,
  );
  const underCap = inWindow.filter(
    (b) => b.perDayLimit === null || already < b.perDayLimit,
  );
  if (underCap.length === 0) return "PER_DAY";

  return "NOT_BLOCKED";
}

/**
 * The last class date the member's own sessions can reach, of a given kind.
 *
 * Only batches with no `usableFrom`, which is what separates an ordinary pack
 * from the opening-week offer: a promo session is restricted to a week in the
 * middle of the calendar and needs a different sentence on screen than "your
 * sessions expire before then". Returns null when nothing applies, which the
 * caller reads as "do not claim a date you cannot name".
 */
export function lastClassDateFor(
  userId: string,
  kinds: CreditKind[],
  now = new Date(),
): Date | null {
  const rows = db
    .select()
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.userId, userId),
        gt(creditBatches.creditsRemaining, 0),
        or(isNull(creditBatches.expiresAt), gt(creditBatches.expiresAt, now)),
        isNull(creditBatches.frozenAt),
      ),
    )
    .all()
    .filter(
      (b) =>
        kinds.includes(b.kind as CreditKind) &&
        b.usableFrom === null &&
        b.usableTo !== null,
    );

  if (rows.length === 0) return null;
  return rows.reduce<Date>(
    (latest, b) => (b.usableTo! > latest ? b.usableTo! : latest),
    rows[0]!.usableTo!,
  );
}

/**
 * Spend one credit on one class.
 *
 * From the batch that expires soonest **among those allowed to pay for a class
 * on that date**. The second half is not a detail: a free opening-week session
 * carries a spend window, and without checking it here the member would book a
 * class in November, silently burn the free session, and then find they had
 * nothing left for the week the offer was for. Nobody would have seen an error;
 * they would simply have been robbed by a sort order.
 *
 * `classStartsAt` is optional so that callers with nothing to do with the
 * timetable — an adjustment at the desk, a test — keep working. Omitting it
 * means "any batch will do", which is the old behaviour.
 *
 * Returns the batch id it came from, or null if the member has nothing that can
 * pay for this class. Safe under concurrency: the UPDATE is conditional on
 * creditsRemaining > 0.
 */
export function spendOneCredit(
  userId: string,
  opts: {
    bookingId?: string;
    note?: string;
    classStartsAt?: Date;
    /**
     * Which kinds of session may pay for this class, best first. Omitted means
     * any, which is what a desk adjustment or a test wants.
     */
    kinds?: CreditKind[];
    /** The session being booked, so re-booking it does not count against a cap. */
    sessionId?: string;
  } = {},
  now = new Date(),
): string | null {
  const all = db
    .select()
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.userId, userId),
        gt(creditBatches.creditsRemaining, 0),
        or(isNull(creditBatches.expiresAt), gt(creditBatches.expiresAt, now)),
        isNull(creditBatches.frozenAt),
      ),
    )
    .orderBy(asc(creditBatches.expiresAt), asc(creditBatches.createdAt))
    .all();

  let batches = opts.classStartsAt
    ? all.filter((b) => windowAllows(b, opts.classStartsAt!))
    : all;

  /**
   * The kind filter, and the order it imposes.
   *
   * `kinds` is a preference list, not a set: a solo appointment says
   * ["PERSONAL", "DUET"] because a personal session should be used up before a
   * duet one is spent on one person. Sorting by the position in that list and
   * then by expiry gives both rules in the right order of priority — spend the
   * right kind first, and within a kind spend what dies soonest.
   */
  if (opts.kinds) {
    const rank = new Map(opts.kinds.map((k, i) => [k as string, i]));
    batches = batches
      .filter((b) => rank.has(b.kind))
      .sort((a, b) => {
        const byKind = rank.get(a.kind)! - rank.get(b.kind)!;
        if (byKind !== 0) return byKind;
        const ax = a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bx = b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return ax - bx || a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  /**
   * The daily cap, checked only if a capped batch is in the running.
   *
   * An Unlimited plan grants one session for every day the studio opens in the
   * quarter, and this is the half of the plan that makes the word honest. The
   * count is taken once and only when it can matter, so an ordinary booking
   * pays nothing for a rule that does not apply to it.
   */
  if (opts.classStartsAt && batches.some((b) => b.perDayLimit !== null)) {
    const already = bookingsOnStudioDay(
      userId,
      opts.classStartsAt,
      opts.sessionId,
    );
    batches = batches.filter(
      (b) => b.perDayLimit === null || already < b.perDayLimit,
    );
  }

  for (const batch of batches) {
    const res = db
      .update(creditBatches)
      .set({ creditsRemaining: sql`${creditBatches.creditsRemaining} - 1` })
      .where(
        and(eq(creditBatches.id, batch.id), gt(creditBatches.creditsRemaining, 0)),
      )
      .run();

    if (res.changes > 0) {
      db.insert(creditLedger)
        .values({
          userId,
          delta: -1,
          reason: "BOOKING",
          note: opts.note,
          batchId: batch.id,
          bookingId: opts.bookingId,
        })
        .run();
      return batch.id;
    }
  }
  return null;
}

/** Return one credit to the batch it was taken from (used on free cancellation). */
export function refundOneCredit(
  userId: string,
  batchId: string | null,
  opts: {
    bookingId?: string;
    note?: string;
    /**
     * What to replace it with if the original batch has gone.
     *
     * Only reached in the fallback below, and it matters there: a cancelled
     * noon appointment refunded as an ordinary class session would quietly turn
     * €30 of one to one into €20 of group class, and the member would find out
     * the next time they tried to book noon.
     */
    kind?: CreditKind;
  } = {},
) {
  if (batchId) {
    const res = db
      .update(creditBatches)
      .set({
        creditsRemaining: sql`min(${creditBatches.creditsRemaining} + 1, ${creditBatches.creditsTotal})`,
      })
      .where(eq(creditBatches.id, batchId))
      .run();
    if (res.changes > 0) {
      db.insert(creditLedger)
        .values({
          userId,
          delta: 1,
          reason: "CANCELLATION_REFUND",
          note: opts.note,
          batchId,
          bookingId: opts.bookingId,
        })
        .run();
      return true;
    }
  }

  /**
   * No batch recorded, or the row has gone. Two steps, and neither of them may
   * hand back more than was taken.
   *
   * This fallback used to mint a fresh batch with **ninety days** on it, which is
   * a hole in two directions at once. A member whose session expired in a week
   * would have got three months back for cancelling, so booking and cancelling
   * became a way to reset an expiry; and a booking with no batch on it at all
   * would have produced a session out of nothing, which the member may never
   * have paid for.
   *
   * So the first move is to reconstruct where it came from. By the spending rule
   * a credit is always taken from the soonest-expiring batch, so the soonest
   * batch with room in it is the best available answer, and putting it there can
   * never extend an expiry. `creditsRemaining < creditsTotal` is what "with room"
   * means: a batch nothing was spent from cannot be the one this came from, and
   * topping it up past its own total would create a session.
   */
  const home = db
    .select()
    .from(creditBatches)
    .where(eq(creditBatches.userId, userId))
    .all()
    .filter(
      (b) =>
        b.creditsRemaining < b.creditsTotal &&
        (opts.kind ? b.kind === opts.kind : b.kind === "CLASS"),
    )
    .sort((a, b) => {
      const ax = a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bx = b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return ax - bx || a.createdAt.getTime() - b.createdAt.getTime();
    })[0];

  if (home) {
    db.update(creditBatches)
      .set({ creditsRemaining: home.creditsRemaining + 1 })
      .where(eq(creditBatches.id, home.id))
      .run();
    db.insert(creditLedger)
      .values({
        userId,
        delta: 1,
        reason: "CANCELLATION_REFUND",
        note: opts.note
          ? `${opts.note} (batch not recorded, returned to the soonest one)`
          : "Batch not recorded, returned to the soonest one",
        batchId: home.id,
        bookingId: opts.bookingId,
      })
      .run();
    return true;
  }

  /**
   * Nothing to put it back into at all.
   *
   * Reached only when the member holds no batch that anything was ever spent
   * from, which means either the record is broken or every batch has been
   * cleared away. A cancellation that takes a session and returns nothing is
   * worse than a short compensation, so one is written, and it is deliberately
   * *short* rather than the ninety days this used to give: goodwill the studio
   * did not authorise is not the same thing as a refund. It is marked
   * COMPENSATION, which Analytics already keeps out of revenue and which shows
   * plainly in the member's own session history.
   */
  const until = studioEndOfDay(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  console.error(
    `[credits] refund for ${userId} had no batch to return to; wrote a 30-day compensation session`,
  );
  const batch = db
    .insert(creditBatches)
    .values({
      userId,
      creditsTotal: 1,
      creditsRemaining: 1,
      source: "COMPENSATION",
      expiresAt: until,
      usableTo: until,
      kind: opts.kind ?? "CLASS",
    })
    .returning()
    .get();

  db.insert(creditLedger)
    .values({
      userId,
      delta: 1,
      reason: "CANCELLATION_REFUND",
      note: opts.note ?? "Original credit batch unavailable",
      batchId: batch.id,
      bookingId: opts.bookingId,
    })
    .run();
  return true;
}

/** Grant credits: used by the Stripe webhook and by admin adjustments. */
export function grantCredits(args: {
  userId: string;
  credits: number;
  validityDays: number | null;
  source?: "PURCHASE" | "GRANT" | "COMPENSATION";
  purchaseId?: string;
  reason?: string;
  note?: string;
  /** An exact expiry, when it is a date rather than a number of days. */
  expiresAt?: Date | null;
  /**
   * Which class dates these sessions may be spent on. Both null — the normal
   * case — means any class. See lib/promo.ts for why this is separate from
   * expiry.
   */
  usableFrom?: Date | null;
  usableTo?: Date | null;
  /**
   * What these sessions buy. Defaults to CLASS, so every existing caller —
   * the webhook, the desk, the promo, the tests — keeps granting exactly what
   * it granted before.
   */
  kind?: CreditKind;
  /** The most classes a day they may pay for. Null means no cap. */
  perDayLimit?: number | null;
}) {
  const {
    userId,
    credits,
    validityDays,
    source = "PURCHASE",
    purchaseId,
    reason = "PURCHASE",
    note,
  } = args;

  /**
   * Expiry lands at the end of the last day, not at the minute of purchase.
   *
   * It used to be `now + 30 × 24h` to the millisecond, which meant a pack bought
   * at 14:53 died at 14:53 on the thirtieth day. The member's account shows only
   * the date, so somebody who bought at nine in the morning and came back at
   * eight in the evening on their last day saw a date that was still today and a
   * balance that had already gone. Two people buying the same pack on the same
   * day had expiry times hours apart, for no reason either of them could see.
   *
   * Rounding up to 23:59:59.999 in Larnaca makes the date on screen exactly
   * true, and hands the member the rest of their last day. An explicit
   * `expiresAt` is left alone: the promo passes a real date and means it.
   */
  /**
   * A pack bought while another is still running starts when that one ends.
   *
   * Without this, a member on one class a week who bought a month on the 18th
   * of September and booked the four Tuesdays would buy the next month on the
   * 8th of October and find it dead on the 7th of November, three weeks of it
   * spent overlapping the pack they already had. Nobody buys a pack early to
   * shorten it, so the new pack's days are counted from the day after the
   * current pack's last day, and its sessions are on the account at once, so
   * booking the Tuesdays that fall after the current pack ends works the day the
   * new pack is paid.
   *
   * Only paid packs of the same kind chain, so a personal session does not
   * push a class pack out, and a promo or a desk goodwill grant, which carry
   * their own dates, does not either. The anchor is the latest live expiry,
   * whatever is left on that batch: a pack whose four sessions are all booked
   * is still the pack the member is on until it ends.
   */
  const kind = args.kind ?? "CLASS";
  /* Through Date.now so the tests can move the clock. */
  const now = new Date(Date.now());
  const chainFrom =
    source === "PURCHASE" && args.expiresAt === undefined && validityDays && validityDays > 0
      ? db
          .select({ expiresAt: creditBatches.expiresAt })
          .from(creditBatches)
          .where(
            and(
              eq(creditBatches.userId, userId),
              eq(creditBatches.kind, kind),
              eq(creditBatches.source, "PURCHASE"),
              isNull(creditBatches.frozenAt),
              gt(creditBatches.expiresAt, now),
            ),
          )
          .orderBy(desc(creditBatches.expiresAt))
          .limit(1)
          .get()?.expiresAt ?? null
      : null;
  const anchor = chainFrom && chainFrom > now ? chainFrom : now;

  const expiresAt =
    args.expiresAt !== undefined
      ? args.expiresAt
      : validityDays && validityDays > 0
        ? studioEndOfDay(
            new Date(anchor.getTime() + validityDays * 24 * 60 * 60 * 1000),
          )
        : null;

  const chainNote =
    chainFrom && expiresAt
      ? `${note ? `${note}. ` : ""}Starts after the current pack (${studioDateKey(chainFrom)}), sessions expire ${studioDateKey(expiresAt)}`
      : note;

  /**
   * And the class has to fall inside the window too, not just the booking.
   *
   * This was the bug underneath the bug. `expiresAt` governed when a session
   * could be *spent* and nothing governed what it could be spent *on*, so a
   * member could buy a 30-day pack, wait until day 29, and book classes across
   * November and December. Thirty days then constrained the shopping and not the
   * training: the pack became unlimited in horizon, and seats came out of a
   * timetable the studio had not started selling.
   *
   * The mechanism already existed for the opening-week offer, which is exactly
   * this question asked about a promotion. So an ordinary pack now carries the
   * same upper bound as its own expiry, and `usableFrom` stays null because
   * there is no lower one: a session bought today is good for a class tonight.
   *
   * A batch with no expiry keeps no window either, which is right. Nothing
   * limits a session that never dies.
   */
  const usableTo =
    args.usableTo !== undefined ? args.usableTo : expiresAt;

  const batch = db
    .insert(creditBatches)
    .values({
      userId,
      purchaseId,
      creditsTotal: credits,
      creditsRemaining: credits,
      source,
      expiresAt,
      usableFrom: args.usableFrom ?? null,
      usableTo,
      kind: args.kind ?? "CLASS",
      perDayLimit: args.perDayLimit ?? null,
    })
    .returning()
    .get();

  db.insert(creditLedger)
    .values({
      userId,
      delta: credits,
      reason,
      note: chainNote,
      batchId: batch.id,
      purchaseId,
    })
    .run();

  return batch;
}

export async function getLedger(userId: string, limit = 40) {
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}

/* ------------------------------------------------------------ the desk */

export type ExtendResult =
  | { ok: true; expiresAt: Date; creditsRemaining: number }
  | { ok: false; code: "NOT_FOUND" | "BAD_DAYS" | "NO_EXPIRY" | "EMPTY" };

/**
 * Give a member more time on sessions they already hold.
 *
 * The batch's expiry moves forward by whole days and lands on the end of a
 * studio day, the same place every expiry lands, so "extended by 30 days" reads
 * as a date on the member's account rather than an odd hour. A batch that has
 * already expired is brought back: its new date is counted from today, not from
 * the old date, because the point of the favour is that the member can book
 * again from now. The spend window (`usableTo`), when there is one, moves with
 * it so a free session extended is a free session that can be used.
 *
 * Written to the ledger with a delta of zero: nothing was added or taken, but
 * the desk did something to this member's balance and the record should say so.
 */
export function extendBatch(args: {
  userId: string;
  batchId: string;
  days: number;
  staffName: string;
  now?: Date;
}): ExtendResult {
  const now = args.now ?? new Date();
  const days = Math.round(args.days);
  if (!Number.isFinite(days) || days < 1 || days > 730) {
    return { ok: false, code: "BAD_DAYS" };
  }

  const batch = db
    .select()
    .from(creditBatches)
    .where(
      and(eq(creditBatches.id, args.batchId), eq(creditBatches.userId, args.userId)),
    )
    .get();
  if (!batch) return { ok: false, code: "NOT_FOUND" };
  if (!batch.expiresAt) return { ok: false, code: "NO_EXPIRY" };
  if (batch.creditsRemaining <= 0) return { ok: false, code: "EMPTY" };

  const from = batch.expiresAt > now ? batch.expiresAt : now;
  const target = new Date(from.getTime() + days * 86_400_000);
  const expiresAt = studioEndOfDay(target);

  db.transaction(() => {
    db.update(creditBatches)
      .set({
        expiresAt,
        usableTo:
          batch.usableTo && batch.usableTo < expiresAt ? expiresAt : batch.usableTo,
      })
      .where(eq(creditBatches.id, batch.id))
      .run();

    db.insert(creditLedger)
      .values({
        userId: args.userId,
        delta: 0,
        reason: "ADMIN_EXTEND",
        note: `${args.staffName}: +${days} days, ${batch.creditsRemaining} sessions now expire ${studioDateKey(expiresAt)}`,
        batchId: batch.id,
      })
      .run();
  });

  return { ok: true, expiresAt, creditsRemaining: batch.creditsRemaining };
}
