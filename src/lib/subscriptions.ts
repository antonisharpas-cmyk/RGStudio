import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  classSessions,
  creditBatches,
  creditLedger,
  creditPackages,
  purchases,
  subscriptions,
  users,
  type Subscription,
} from "@/db/schema";
import { cancelBooking } from "./booking";
import { grantCredits } from "./credits";
import { priceOf } from "./pricing";
import { studioEndOfDay, studioParts, studioWallTimeToInstant } from "./time";

/**
 * Monthly plans: a long commitment, paid one month at a time.
 *
 * ---
 *
 * **What the member gets and what they owe.**
 *
 * A plan is a term (six to twelve months) at a cadence (one to four classes a
 * week). Every session the term contains is handed over on the first day: nine
 * months at twice a week is 72 sessions on the account at once, so the member
 * can book their regular hours for the whole term straight away. The price is
 * per month, and it is the same as the one month pack for that cadence, read
 * live from the price list so an offer on the monthly packs is an offer on the
 * plans too.
 *
 * **What happens when a month is not paid.**
 *
 * `paidThrough` is the day the next month falls due. The studio gives
 * `graceDays` (three) after it. Past that the plan lapses: its batch is frozen,
 * so nothing on it can pay for a class, and every upcoming booking it paid for
 * is cancelled, which puts those places back on the timetable for everybody
 * else. The sessions themselves are not lost. The moment a month is paid, from
 * whichever till, the batch thaws, `paidThrough` moves on a month, and the
 * member books again.
 *
 * **Where the money comes in.**
 *
 * Three tills, one function. The website (a checkout for one month), the desk
 * (cash or card, recorded on the member's card) and, if the studio wires it up
 * later, a card the provider charges on its own. All three end in
 * `recordSubscriptionPayment`, which is the only thing that moves the dates.
 * Cash one month and card the next is therefore ordinary rather than special.
 *
 * **Reminders.** Three days before a month falls due, and again on the day, the
 * member is told once each (`remindedFor` remembers which month was nagged).
 */

export const PLAN_MONTHS = [6, 7, 8, 9, 10, 11, 12] as const;
export const PLAN_PER_WEEK = [1, 2, 3, 4] as const;
export const PLAN_GRACE_DAYS = 3;
/** A calendar month is taken as four studio weeks for the session count. */
export const WEEKS_PER_MONTH = 4;

export type PlanQuote = {
  months: number;
  perWeek: number;
  monthlyPriceCents: number;
  /** The one month pack the price came from, when there is one. */
  packId: string | null;
  totalCredits: number;
};

/**
 * What a plan costs a month and how many sessions it holds.
 *
 * The price comes from the `month-{perWeek}` pack as it is priced right now,
 * offer included, so the plans and the packs never disagree.
 */
export function planQuote(months: number, perWeek: number): PlanQuote | null {
  if (!(PLAN_MONTHS as readonly number[]).includes(months)) return null;
  if (!(PLAN_PER_WEEK as readonly number[]).includes(perWeek)) return null;
  const pack = db
    .select()
    .from(creditPackages)
    .where(and(eq(creditPackages.slug, `month-${perWeek}`), eq(creditPackages.active, true)))
    .get();
  if (!pack) return null;
  return {
    months,
    perWeek,
    monthlyPriceCents: priceOf(pack).cents,
    packId: pack.id,
    totalCredits: months * perWeek * WEEKS_PER_MONTH,
  };
}

/** Every plan the pricing page can offer, priced now. */
export function planQuotes(): PlanQuote[] {
  const out: PlanQuote[] = [];
  for (const m of PLAN_MONTHS) {
    for (const w of PLAN_PER_WEEK) {
      const q = planQuote(m, w);
      if (q) out.push(q);
    }
  }
  return out;
}

/** The same day of the month, `n` months on, in the studio's calendar. */
export function addMonths(from: Date, n: number): Date {
  const p = studioParts(from);
  let month = p.month + n;
  let year = p.year;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return studioWallTimeToInstant(year, month, Math.min(p.day, lastDay), p.hour, p.minute);
}

/* --------------------------------------------------------------- lifecycle */

export type SubscriptionView = {
  id: string;
  months: number;
  perWeek: number;
  monthlyPriceCents: number;
  totalCredits: number;
  status: string;
  startedAt: Date | null;
  endsAt: Date | null;
  paidThrough: Date | null;
  monthsPaid: number;
  graceDays: number;
  /** The last day a payment can arrive before the plan lapses. */
  dueBy: Date | null;
  /** Whether a month is owed right now (past paidThrough, not yet lapsed). */
  owing: boolean;
  frozen: boolean;
  creditsRemaining: number;
};

function view(s: Subscription, now = new Date()): SubscriptionView {
  const batch = s.batchId
    ? db.select().from(creditBatches).where(eq(creditBatches.id, s.batchId)).get()
    : null;
  const dueBy = s.paidThrough
    ? studioEndOfDay(new Date(s.paidThrough.getTime() + s.graceDays * 86_400_000))
    : null;
  return {
    id: s.id,
    months: s.months,
    perWeek: s.perWeek,
    monthlyPriceCents: s.monthlyPriceCents,
    totalCredits: s.totalCredits,
    status: s.status,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    paidThrough: s.paidThrough,
    monthsPaid: s.monthsPaid,
    graceDays: s.graceDays,
    dueBy,
    owing:
      s.status === "ACTIVE" &&
      s.monthsPaid < s.months &&
      Boolean(s.paidThrough && now > s.paidThrough),
    frozen: Boolean(batch?.frozenAt),
    creditsRemaining: batch?.creditsRemaining ?? 0,
  };
}

/** The member's current plan, if they have one that is not finished. */
export function currentSubscription(userId: string, now = new Date()): SubscriptionView | null {
  const rows = db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, ["PENDING", "ACTIVE", "LAPSED"]),
      ),
    )
    .orderBy(desc(subscriptions.createdAt))
    .all();
  /* A plan that is running outranks one that was only opened at checkout and
     never paid for. */
  const row =
    rows.find((r) => r.status === "ACTIVE") ??
    rows.find((r) => r.status === "LAPSED") ??
    rows[0];
  return row ? view(row, now) : null;
}

export function subscriptionById(id: string) {
  return db.select().from(subscriptions).where(eq(subscriptions.id, id)).get() ?? null;
}

export type StartResult =
  | { ok: true; subscription: Subscription }
  | { ok: false; code: "BAD_PLAN" | "ALREADY_ON_A_PLAN" | "NOT_FOUND" };

/**
 * Open a plan that is not yet paid for. The website does this before taking
 * the first month; the first payment's fulfilment activates it.
 */
export function createPendingSubscription(args: {
  userId: string;
  months: number;
  perWeek: number;
  createdBy?: string;
}): StartResult {
  const quote = planQuote(args.months, args.perWeek);
  if (!quote) return { ok: false, code: "BAD_PLAN" };
  const user = db.select().from(users).where(eq(users.id, args.userId)).get();
  if (!user) return { ok: false, code: "NOT_FOUND" };
  /* One live plan at a time. A second would mean two sets of dues and two
     batches racing for the same booking, which nobody at the desk can explain. */
  const live = currentSubscription(args.userId);
  if (live && live.status !== "PENDING") return { ok: false, code: "ALREADY_ON_A_PLAN" };

  /* A checkout that is re-opened (a promo code applied, a page reloaded)
     reuses the plan it already opened rather than leaving a trail of unpaid
     ones behind it. */
  if (live && live.status === "PENDING") {
    const row = db
      .update(subscriptions)
      .set({
        months: quote.months,
        perWeek: quote.perWeek,
        monthlyPriceCents: quote.monthlyPriceCents,
        totalCredits: quote.totalCredits,
      })
      .where(eq(subscriptions.id, live.id))
      .returning()
      .get();
    return { ok: true, subscription: row };
  }

  const row = db
    .insert(subscriptions)
    .values({
      userId: args.userId,
      months: quote.months,
      perWeek: quote.perWeek,
      monthlyPriceCents: quote.monthlyPriceCents,
      totalCredits: quote.totalCredits,
      status: "PENDING",
      graceDays: PLAN_GRACE_DAYS,
      createdBy: args.createdBy ?? null,
    })
    .returning()
    .get();
  return { ok: true, subscription: row };
}

/**
 * The first month has been paid: hand over every session and start the clock.
 * Idempotent, so a webhook and a settle call arriving together grant once.
 */
export function activateSubscription(subId: string, purchaseId: string | null, now = new Date()) {
  return db.transaction(() => {
    const s = db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
    if (!s || s.status !== "PENDING") return s ?? null;

    const endsAt = studioEndOfDay(addMonths(now, s.months));
    const batch = grantCredits({
      userId: s.userId,
      credits: s.totalCredits,
      validityDays: null,
      expiresAt: endsAt,
      purchaseId: purchaseId ?? undefined,
      source: "PURCHASE",
      reason: "PURCHASE",
      note: `Monthly plan: ${s.months} months, ${s.perWeek} a week`,
      kind: "CLASS",
    });
    db.update(creditBatches)
      .set({ subscriptionId: s.id })
      .where(eq(creditBatches.id, batch.id))
      .run();

    return db
      .update(subscriptions)
      .set({
        status: "ACTIVE",
        startedAt: now,
        endsAt,
        paidThrough: addMonths(now, 1),
        monthsPaid: 1,
        batchId: batch.id,
      })
      .where(eq(subscriptions.id, s.id))
      .returning()
      .get();
  });
}

/**
 * A month has been paid, from whichever till. Moves the due date on, counts
 * the month, and thaws the sessions if the plan had lapsed.
 */
export function recordSubscriptionPayment(subId: string, now = new Date()) {
  return db.transaction(() => {
    const s = db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
    if (!s) return null;
    if (s.status === "PENDING") return activateSubscription(subId, null, now);
    if (s.status === "CANCELLED" || s.status === "COMPLETED") return s;

    /* Count from where the plan was paid to, not from today: paying on the
       25th for a month that fell due on the 19th still buys the month that
       started on the 19th. */
    const base = s.paidThrough ?? now;
    const paidThrough = addMonths(base, 1);

    if (s.batchId) {
      db.update(creditBatches)
        .set({ frozenAt: null })
        .where(eq(creditBatches.id, s.batchId))
        .run();
    }
    return db
      .update(subscriptions)
      .set({
        status: "ACTIVE",
        paidThrough,
        monthsPaid: s.monthsPaid + 1,
        lapsedAt: null,
      })
      .where(eq(subscriptions.id, s.id))
      .returning()
      .get();
  });
}

/**
 * Release every upcoming class this plan's sessions paid for. Refunds go back
 * to the plan's batch (frozen or not), so nothing is lost, only unbooked.
 */
function releaseUpcoming(s: Subscription, now: Date): string[] {
  if (!s.batchId) return [];
  const rows = db
    .select({ bookingId: creditLedger.bookingId })
    .from(creditLedger)
    .innerJoin(bookings, eq(bookings.id, creditLedger.bookingId))
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(
      and(
        eq(creditLedger.batchId, s.batchId),
        eq(creditLedger.reason, "BOOKING"),
        eq(bookings.status, "CONFIRMED"),
        gt(classSessions.startsAt, now),
      ),
    )
    .all();
  const released: string[] = [];
  for (const r of rows) {
    if (!r.bookingId) continue;
    const res = cancelBooking(s.userId, r.bookingId, now, { forfeit: true });
    if (res.ok) released.push(r.bookingId);
  }
  return released;
}

/** Past the grace period: freeze the sessions and free the places. */
export function lapseSubscription(subId: string, now = new Date()) {
  const s = db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
  if (!s || s.status !== "ACTIVE") return { lapsed: false, released: [] as string[] };

  if (s.batchId) {
    db.update(creditBatches)
      .set({ frozenAt: now })
      .where(eq(creditBatches.id, s.batchId))
      .run();
  }
  const released = releaseUpcoming(s, now);
  db.update(subscriptions)
    .set({ status: "LAPSED", lapsedAt: now })
    .where(eq(subscriptions.id, s.id))
    .run();
  return { lapsed: true, released };
}

/** The studio or the member ends the plan. Remaining sessions are frozen for good. */
export function cancelSubscription(subId: string, now = new Date()) {
  const s = db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
  if (!s || s.status === "CANCELLED" || s.status === "COMPLETED") return s ?? null;
  const released = releaseUpcoming(s, now);
  if (s.batchId) {
    db.update(creditBatches)
      .set({ frozenAt: now })
      .where(eq(creditBatches.id, s.batchId))
      .run();
  }
  const row = db
    .update(subscriptions)
    .set({ status: "CANCELLED", cancelledAt: now })
    .where(eq(subscriptions.id, s.id))
    .returning()
    .get();
  return { ...row, released };
}

/* ------------------------------------------------------------------ desk */

export type DeskMethod = "cash" | "card_at_desk";

/** Start a plan at the counter: the first month is paid here and now. */
export function startSubscriptionAtDesk(args: {
  userId: string;
  months: number;
  perWeek: number;
  method: DeskMethod;
  staffId: string;
  staffName: string;
}) {
  const started = createPendingSubscription({
    userId: args.userId,
    months: args.months,
    perWeek: args.perWeek,
    createdBy: args.staffId,
  });
  if (!started.ok) return started;
  const s = started.subscription;
  const purchase = db
    .insert(purchases)
    .values({
      userId: s.userId,
      credits: s.totalCredits,
      amountCents: s.monthlyPriceCents,
      currency: "eur",
      status: "PAID",
      provider: args.method,
      paidAt: new Date(),
      providerRef: `desk:${args.staffId.slice(0, 8)}`,
      subscriptionId: s.id,
    })
    .returning()
    .get();
  const active = activateSubscription(s.id, purchase.id);
  return { ok: true as const, subscription: active!, purchaseId: purchase.id };
}

/** A month paid at the counter. */
export function paySubscriptionAtDesk(args: {
  subscriptionId: string;
  method: DeskMethod;
  staffId: string;
}) {
  const s = subscriptionById(args.subscriptionId);
  if (!s) return { ok: false as const, code: "NOT_FOUND" as const };
  if (s.status === "CANCELLED" || s.status === "COMPLETED") {
    return { ok: false as const, code: "FINISHED" as const };
  }
  if (s.monthsPaid >= s.months) return { ok: false as const, code: "ALL_PAID" as const };
  const purchase = db
    .insert(purchases)
    .values({
      userId: s.userId,
      credits: 0,
      amountCents: s.monthlyPriceCents,
      currency: "eur",
      status: "PAID",
      provider: args.method,
      paidAt: new Date(),
      providerRef: `desk:${args.staffId.slice(0, 8)}`,
      subscriptionId: s.id,
    })
    .returning()
    .get();
  const updated = recordSubscriptionPayment(s.id);
  return { ok: true as const, subscription: updated!, purchaseId: purchase.id };
}

/* ----------------------------------------------------------------- sweep */

export type SubscriptionSweep = {
  lapsed: number;
  released: number;
  completed: number;
  /** Plans a reminder is due for: the caller sends the words. */
  remind: { subscription: Subscription; kind: "SOON" | "DUE" }[];
};

/**
 * Once a sweep: lapse what is overdue, close what has run its course, and say
 * which members should be reminded. Idempotent; runs on the cron sweep.
 */
export function sweepSubscriptions(now = new Date()): SubscriptionSweep {
  const out: SubscriptionSweep = { lapsed: 0, released: 0, completed: 0, remind: [] };
  const live = db
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["ACTIVE", "LAPSED"]))
    .all();

  for (const s of live) {
    /* Finished: the term is over. Whatever is left on the batch expires with it. */
    if (s.endsAt && now > s.endsAt) {
      db.update(subscriptions)
        .set({ status: "COMPLETED" })
        .where(eq(subscriptions.id, s.id))
        .run();
      out.completed++;
      continue;
    }
    if (s.status !== "ACTIVE" || !s.paidThrough || s.monthsPaid >= s.months) continue;

    const dueBy = studioEndOfDay(
      new Date(s.paidThrough.getTime() + s.graceDays * 86_400_000),
    );
    if (now > dueBy) {
      const r = lapseSubscription(s.id, now);
      if (r.lapsed) {
        out.lapsed++;
        out.released += r.released.length;
      }
      continue;
    }

    /* Reminders: once three days ahead, once on the day. `remindedFor` holds
       the due date last reminded about, plus a day when the "on the day" one
       has gone, so each of the two goes exactly once per month. */
    /* Timestamps are stored to the second, so the markers are whole days
       apart: the "soon" marker is three days before the due date, the "due"
       marker a day after it. */
    const DAY = 86_400_000;
    const soonAt = s.paidThrough.getTime() - 3 * DAY;
    const dueMark = s.paidThrough.getTime() + DAY;
    const already = s.remindedFor?.getTime() ?? 0;
    if (now.getTime() >= s.paidThrough.getTime() && already < dueMark) {
      out.remind.push({ subscription: s, kind: "DUE" });
      db.update(subscriptions)
        .set({ remindedFor: new Date(dueMark) })
        .where(eq(subscriptions.id, s.id))
        .run();
    } else if (now.getTime() >= soonAt && already < soonAt) {
      out.remind.push({ subscription: s, kind: "SOON" });
      db.update(subscriptions)
        .set({ remindedFor: new Date(soonAt) })
        .where(eq(subscriptions.id, s.id))
        .run();
    }
  }
  return out;
}
