import { and, desc, eq, gt, gte } from "drizzle-orm";
import {
  CONDITION_MAX_CHARS,
  STAFF_NOTES_MAX_CHARS,
  isPilatesExperience,
  isPilatesLevel,
} from "./intake";
import { db } from "@/db";
import {
  bookings,
  classSessions,
  classTemplates,
  classTypes,
  creditBatches,
  creditLedger,
  instructors,
  purchases,
  users,
} from "@/db/schema";
import { isClassLevel, type ClassLevel } from "@/lib/class-level";
import { studioStartOfDay } from "@/lib/time";
import { hashPassword, isVerified } from "@/lib/auth";
import { deviceCount } from "@/lib/messaging/push";
import { toE164 } from "@/lib/messaging/sms";
import { getCreditSummary, grantCredits, refundOneCredit } from "@/lib/credits";
import { assignInvoiceNumber } from "@/lib/invoice-number";
import { bookClass } from "@/lib/booking";
import { MAX_REPEAT_WEEKS, repeatWeekly } from "@/lib/booking-repeat";
import { cancelReminder, scheduleReminder } from "@/lib/reminders";
import {
  notifyBooked,
  notifyCancelled,
  notifyRepeatBooked,
  notifyInstructorChanged,
  notifyPurchased,
  notifyGranted,
} from "@/lib/messaging/events";
import type { CreditKind } from "@/lib/packs";

/**
 * What somebody at the desk can do on a member's behalf.
 *
 * Every one of these is an action taken *for* a member by somebody else, so
 * every one of them writes to the session ledger with a note saying who and
 * why. A balance that changed with no explanation is the thing that turns a
 * disagreement at the desk into an argument.
 */

/* ------------------------------------------------------------ find a member */

export type MemberSummary = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  createdAt: Date;
  credits: number;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyPush: boolean;
  marketingOptIn: boolean;
  /** A dummy account the studio keeps for testing. Shown as a badge. */
  isTest: boolean;
};

/**
 * Whether an account is one of the studio's own.
 *
 * Reception may not read or change a colleague's account: not the owner's phone
 * number, and certainly not their password, which would hand the whole console
 * over. Only the owner can. This is the one check the routes share, rather than
 * each remembering it for itself.
 */
export function isDeskAccount(userId: string) {
  const row = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.role === "STAFF" || row?.role === "ADMIN";
}

export const MEMBERS_PER_PAGE = 10;

export type MemberFilter = "all" | "test" | "real";

/**
 * The membership, searched or simply browsed.
 *
 * Paged, because browsing is a real way to use this screen and it used to be
 * impossible: the list was capped at twelve with no way past them, so a studio
 * with a hundred members could only reach somebody by typing their name. Which
 * is fine when you know who you are looking for and useless when you are looking
 * *for* somebody — the member who came in last week, the one whose name you half
 * remember.
 *
 * `filter` separates the studio's dummy accounts from real members. Both
 * directions are useful: "real" to see the actual membership, "test" to find the
 * account you were experimenting with an hour ago.
 */
export async function findMembers(
  query: string,
  {
    limit = MEMBERS_PER_PAGE,
    includeDesk = false,
    filter = "all",
    page = 1,
  }: {
    limit?: number;
    includeDesk?: boolean;
    filter?: MemberFilter;
    page?: number;
  } = {},
) {
  const q = query.trim().toLowerCase();
  const all = db.select().from(users).orderBy(desc(users.createdAt)).all();
  /* The studio's own accounts are not part of the membership as far as the desk
     is concerned. The owner sees them; reception does not. */
  const visible = includeDesk
    ? all
    : all.filter((u) => u.role !== "STAFF" && u.role !== "ADMIN");

  const searched = q
    ? visible.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.phone ?? "").replace(/\s/g, "").includes(q.replace(/\s/g, "")),
      )
    : visible;

  /* Counted before the filter is applied, so the three pills can each show how
     many they would find rather than only the one in use. */
  const counts = {
    all: searched.length,
    test: searched.filter((u) => u.isTest).length,
    real: searched.filter((u) => !u.isTest).length,
  };

  const matched =
    filter === "test"
      ? searched.filter((u) => u.isTest)
      : filter === "real"
        ? searched.filter((u) => !u.isTest)
        : searched;

  const perPage = Math.min(Math.max(limit, 1), 100);
  const pages = Math.max(1, Math.ceil(matched.length / perPage));
  /* Somebody on page 6 who then types a search would otherwise be looking at an
     empty page and conclude there were no results. */
  const current = Math.min(Math.max(page, 1), pages);

  const out: MemberSummary[] = [];
  for (const u of matched.slice((current - 1) * perPage, current * perPage)) {
    out.push({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      createdAt: u.createdAt,
      credits: (await getCreditSummary(u.id)).available,
      notifyEmail: u.notifyEmail,
      notifySms: u.notifySms,
      notifyPush: u.notifyPush,
      marketingOptIn: u.marketingOptIn,
      isTest: u.isTest,
    });
  }

  return { rows: out, total: matched.length, page: current, pages, counts };
}

/** One member, with everything the desk needs on screen at once. */
export async function memberDetail(userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;

  const wallet = await getCreditSummary(userId);

  const upcoming = db
    .select({
      id: bookings.id,
      status: bookings.status,
      startsAt: classSessions.startsAt,
      className: classTypes.nameEn,
    })
    .from(bookings)
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .innerJoin(classTypes, eq(classSessions.classTypeId, classTypes.id))
    .where(
      and(
        eq(bookings.userId, userId),
        eq(bookings.status, "CONFIRMED"),
        gt(classSessions.startsAt, new Date()),
      ),
    )
    .orderBy(classSessions.startsAt)
    .all();

  const payments = db
    .select()
    .from(purchases)
    .where(eq(purchases.userId, userId))
    .orderBy(desc(purchases.createdAt))
    .limit(10)
    .all();

  const ledger = db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(15)
    .all();

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    createdAt: user.createdAt,
    credits: wallet.available,
    batches: wallet.batches,
    notifyEmail: user.notifyEmail,
    notifySms: user.notifySms,
    notifyPush: user.notifyPush,
    /**
     * How many of this member's devices have allowed notifications.
     *
     * Here because the desk asked whether it could switch notifications on for
     * a member, and it cannot: the permission belongs to the browser on the
     * member's own phone, is only ever granted by a press on that phone, and
     * there is no API — for us or for anyone — that grants it from somewhere
     * else. That is deliberate on Apple's and Google's part and it is the whole
     * reason the permission is worth anything.
     *
     * What the desk can have instead is the fact. Zero devices is the answer to
     * "why did they not get the cancellation", and it turns an argument at the
     * counter into a thing somebody can fix in ten seconds on the member's own
     * phone while they are standing there.
     */
    pushDevices: deviceCount(user.id),
    /* Which language the studio writes to them in. Null means they have never
       touched the switch, which is not the same as choosing English. */
    locale: user.locale,
    marketingOptIn: user.marketingOptIn,
    isTest: user.isTest,
    /* Both shown on the member's card. Unverified explains why somebody cannot
       book despite having sessions, which is otherwise the desk's problem to
       guess at; erased explains why the row has no name on it. */
    emailVerifiedAt: user.emailVerifiedAt,
    erasedAt: user.erasedAt,
    erasedBy: user.erasedBy,
    /**
     * What the member said about their own pilates, and anything to be careful
     * of.
     *
     * This used to say "on their page and nowhere else", and the class roster
     * deliberately left it out, because a day view is read on a monitor in a
     * room with other people in it. The studio asked for it on the roster and
     * they were right: an instructor with five people on reformers needs to
     * know who is new and whose shoulder to watch at the class, and nobody
     * looks five members up one at a time beforehand.
     *
     * So the rule changed from "not sent" to "not shown until asked for": the
     * roster carries it, and `BookingsPanel` keeps the condition and the
     * studio's note collapsed behind a press. The monitor in the shared room is
     * still a real concern; a collapsed box answers it, and withholding the
     * information from the person teaching the class did not.
     */
    pilatesLevel: user.pilatesLevel,
    pilatesSince: user.pilatesSince,
    healthCondition: user.healthCondition,
    /**
     * The studio's own notes. Staff-only, and there is no route anywhere that
     * returns this to a member: `listMyBookings`, the profile route and the
     * account page all read a fixed set of columns and this is not in any of
     * them. Worth stating rather than assuming, because the difference between
     * "the desk's private note" and "a thing the member reads" is one careless
     * `select *` in a member-facing query.
     */
    notes: user.notes,
    /* Told apart from "nothing to declare", which is also an answer. */
    intakeAt: user.intakeAt,
    upcoming,
    payments,
    ledger,
  };
}

/* ------------------------------------------------- sessions sold at the desk */

export type SellResult =
  | { ok: true; credits: number; balance: number }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOTHING_TO_TAKE" | "BAD_AMOUNT" | "EMAIL_UNVERIFIED";
    };

/**
 * Add sessions a member paid for in cash, or take sessions back off them.
 *
 * A cash sale is recorded as a purchase as well as a batch, so it shows up in
 * the member's payment history and in the studio's takings beside the card
 * ones. Removing sessions writes a negative ledger line instead, because there
 * is no such thing as a negative purchase.
 *
 * ---
 *
 * **An unconfirmed account cannot be sold to, and that is deliberate.**
 *
 * The rule the studio set is that nothing happens on an account until its email
 * address has been proved, and "nothing" has to include the desk or it is not a
 * rule. It was not, briefly, and the hole it left was a nasty one: reception
 * takes 110 euro in cash against an account whose address is a typo, and now the
 * studio has a paying customer it cannot send a receipt to, cannot remind about a
 * class, and cannot reach when one moves. The member believes they are a member;
 * the studio believes it has told them things.
 *
 * The remedy is in front of the person who can apply it. Reception is standing
 * with the member: correct the address on this same screen if it is wrong, have
 * them sign in and type the code from their phone, then sell them the pack. It is
 * half a minute, and it is the only half-minute in which anybody will ever have
 * both the member and the right address in the same room.
 *
 * **Taking sessions back is still allowed**, and so is cancelling their classes.
 * The asymmetry is the point: an unconfirmed account can never be *given*
 * anything, and the studio can always correct what an earlier version of this
 * code let through. Blocking a correction would strand exactly the rows that most
 * need fixing.
 */
export async function sellSessions(args: {
  userId: string;
  credits: number;
  validityDays?: number;
  amountCents?: number;
  method?: "cash" | "card_at_desk" | "adjustment";
  note?: string;
  staffId: string;
  staffName: string;
  /**
   * What the sessions buy: CLASS, PERSONAL or DUET.
   *
   * The desk takes cash for a one to one as often as the website takes a card
   * for one, and a personal session sold as a class session is €30 the member
   * cannot spend on the thing they paid for. Defaults to CLASS, so every
   * existing caller sells what it always sold.
   */
  kind?: CreditKind;
}): Promise<SellResult> {
  const {
    userId,
    credits,
    validityDays = 90,
    amountCents = 0,
    method = "cash",
    note,
    staffId,
    staffName,
    kind = "CLASS",
  } = args;

  if (!Number.isInteger(credits) || credits === 0 || Math.abs(credits) > 100) {
    return { ok: false, code: "BAD_AMOUNT" };
  }

  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false, code: "NOT_FOUND" };

  /* Giving, not taking. See the note above. */
  if (credits > 0 && !isVerified(user)) {
    return { ok: false, code: "EMAIL_UNVERIFIED" };
  }

  const reason = note?.trim()
    ? `${note.trim()}, ${staffName}`
    : `At the desk, ${staffName}`;

  if (credits > 0) {
    /* Set inside the transaction, read after it. The notification has to happen
       outside: a slow email must not hold a SQLite write open while somebody at
       the desk waits, and a failed one must not roll back a sale that was
       already paid for in cash. */
    let sold: string | null = null;

    db.transaction(() => {
      const purchase =
        method === "adjustment"
          ? null
          : db
              .insert(purchases)
              .values({
                userId,
                credits,
                amountCents,
                currency: "eur",
                status: "PAID",
                provider: method,
                paidAt: new Date(),
                providerRef: `desk:${staffId.slice(0, 8)}`,
              })
              .returning()
              .get();

      grantCredits({
        userId,
        credits,
        validityDays,
        purchaseId: purchase?.id,
        source: method === "adjustment" ? "GRANT" : "PURCHASE",
        reason: method === "adjustment" ? "ADMIN_GRANT" : "PURCHASE",
        note: reason,
        kind,
      });

      sold = purchase?.id ?? null;
    });

    /**
     * Tell the member their sessions have arrived.
     *
     * This sent nothing at all until the studio asked for it, which was a real
     * gap: somebody paid cash at the counter, walked out, and had no record of
     * it anywhere except a number on a screen they were no longer looking at.
     * The same message as an online purchase, because it is the same event with
     * a different till: the in-app copy, the phone notification, and the email
     * that is the receipt.
     *
     * Only for money. `adjustment` writes no purchase, so a comped session or a
     * correction stays quiet — an apology session does not need an invoice, and
     * "your payment of €0.00" would be a strange thing to receive.
     *
     * Not awaited, and it can never fail the sale: the money is in the till
     * whatever the mail server does.
     */
    /* The staff name is passed through so the studio's own copy can say who was
       serving. Nothing else needs it, and the purchase row does not carry it. */
    if (sold) {
      /* Give the desk sale a number in the same gapless sequence as an online
         payment, before the confirmation is built, so the member's email
         carries a real VAT invoice PDF instead of nothing. It used to get no
         number and no document on purpose — the assumption was a paper receipt
         over the counter — but the studio would rather email the same proper
         invoice for cash and card as for an online card.

         assignInvoiceNumber is idempotent and only issues a number once the
         INVOICE_* configuration is real: while it is still placeholder this
         assigns nothing and the email attaches no specimen, exactly as the
         online path behaves. One sale, one number, whichever till took the
         money — no duplication between online, cash and card. */
      try {
        assignInvoiceNumber(sold);
      } catch (err) {
        /* A receipt that will not number must never undo a sale already paid in
           cash. The sessions are granted, the member still gets their
           confirmation, and the desk can produce the invoice afterwards. */
        console.error(`[desk] could not number purchase ${sold}`, err);
      }
      void notifyPurchased(sold, { staffName }).catch(() => {});
    } else if (method === "adjustment") {
      /* Sessions given for free: no purchase was written and there is no
         invoice, but the member and the studio still hear about it — a
         confirmation without a receipt. */
      void notifyGranted(userId, { credits, staffName }).catch(() => {});
    }

    return {
      ok: true,
      credits,
      balance: (await getCreditSummary(userId)).available,
    };
  }

  /* Taking sessions back: from the batch that expires last, so the member
     keeps the ones closest to expiring and nothing is quietly written off. */
  const wanted = Math.abs(credits);
  const live = db
    .select()
    .from(creditBatches)
    .where(and(eq(creditBatches.userId, userId), gt(creditBatches.creditsRemaining, 0)))
    .all()
    .sort((a, b) => {
      const ax = a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bx = b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return bx - ax;
    });

  const total = live.reduce((n, b) => n + b.creditsRemaining, 0);
  if (total === 0) return { ok: false, code: "NOTHING_TO_TAKE" };

  const taking = Math.min(wanted, total);

  db.transaction(() => {
    let left = taking;
    for (const batch of live) {
      if (left <= 0) break;
      const off = Math.min(left, batch.creditsRemaining);
      db.update(creditBatches)
        .set({ creditsRemaining: batch.creditsRemaining - off })
        .where(eq(creditBatches.id, batch.id))
        .run();
      left -= off;
    }

    db.insert(creditLedger)
      .values({
        userId,
        delta: -taking,
        reason: "ADMIN_GRANT",
        note: reason,
      })
      .run();
  });

  return {
    ok: true,
    credits: -taking,
    balance: (await getCreditSummary(userId)).available,
  };
}

/* ------------------------------------------------------ cancel for a member */

export type DeskCancelResult =
  | { ok: true; refunded: boolean; balance: number }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_CANCELLED" };

/**
 * Cancel a booking from the desk, refunding or not as the member is told.
 *
 * Unlike a member cancelling their own class, this ignores the 24-hour window:
 * when somebody rings the studio an hour before with a good reason, the person
 * at the desk is the one who decides, and the software should not overrule
 * them. Which way it went is written to the ledger either way.
 *
 * ---
 *
 * **Two things this did not do, and had to.**
 *
 * The member's own cancel route has always cancelled the queued reminder and
 * sent a notice. This path did neither, and nothing pointed at it because both
 * failures are silent in the same direction: the booking really was cancelled,
 * the balance really was right, and the screen said so.
 *
 * What actually happened was that a member removed from a class by the desk
 * still had a reminder sitting in the queue, and got "your class starts in two
 * hours" for a class they were no longer in — from a studio that had never told
 * them they had been taken off it. The studio asked for the notification when
 * they asked for the remove buttons on the roster, which is how it surfaced.
 *
 * Both live here rather than in the routes because there are now three callers
 * (the member's card, and the two remove buttons on the roster) and a courtesy
 * that depends on which button somebody pressed is a courtesy that will
 * eventually be missed.
 */
export async function cancelForMember(args: {
  bookingId: string;
  refund: boolean;
  staffName: string;
  note?: string;
}): Promise<DeskCancelResult> {
  const { bookingId, refund, staffName, note } = args;

  const booking = db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .get();

  if (!booking) return { ok: false, code: "NOT_FOUND" };
  if (booking.status === "CANCELLED") {
    return { ok: false, code: "ALREADY_CANCELLED" };
  }

  const now = new Date();
  db.transaction(() => {
    if (refund) {
      refundOneCredit(booking.userId, booking.creditBatchId, {
        bookingId: booking.id,
        note: note?.trim()
          ? `${note.trim()}, ${staffName}`
          : `Cancelled at the desk, ${staffName}`,
      });
    }
    db.update(bookings)
      .set({ status: "CANCELLED", cancelledAt: now, creditRefunded: refund })
      .where(eq(bookings.id, booking.id))
      .run();
  });

  /* Outside the transaction, and neither allowed to fail the cancellation: the
     booking is already gone and the balance is already right, so a push service
     being slow must not turn that into an error at the counter. */
  try {
    cancelReminder(bookingId);
  } catch {
    /* A reminder that will not delete is a stray message, not a lost class.
       The sweep drops reminders for classes that have already started. */
  }
  /* Says whether the session came back, which is the only part the member
     cannot work out for themselves. */
  void notifyCancelled(bookingId, refund).catch(() => {});

  return {
    ok: true,
    refunded: refund,
    balance: (await getCreditSummary(booking.userId)).available,
  };
}

/* --------------------------------------------------------- member's details */

export type ContactPatch = {
  email?: string;
  phone?: string;
  notifyEmail?: boolean;
  notifySms?: boolean;
  notifyPush?: boolean;
  marketingOptIn?: boolean;
  /** A dummy account for testing. Left out of campaigns unless included. */
  isTest?: boolean;
  /**
   * The three answers from the welcome step, as told to the desk.
   *
   * Reception fills these in for the member who joined over the counter, or
   * corrects them for the member who mentions a shoulder on the way past. An
   * empty string for `healthCondition` means "nothing to declare", which is a
   * real answer and stored as null.
   */
  pilatesLevel?: string;
  pilatesSince?: string;
  healthCondition?: string;
  /**
   * The studio's own notes about a member. Staff write it, the member never
   * sees it, and it is deliberately a different field from `healthCondition`.
   *
   * That separation is the whole point and it is worth saying why, because one
   * box would have been less work. `healthCondition` is what the member said
   * about themselves; this is what an instructor observed. Merging them would
   * let the desk overwrite somebody's own words about their own body, and it
   * would put a staff note in front of the member on their account page. Two
   * fields, two audiences, and neither can quietly become the other.
   */
  notes?: string;
};

export async function updateContact(userId: string, patch: ContactPatch) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false as const, code: "NOT_FOUND" as const };

  const next: Record<string, unknown> = {};

  if (patch.email !== undefined) {
    const email = patch.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return { ok: false as const, code: "EMAIL_INVALID" as const };
    }
    /* Email is the login, so a clash would lock somebody out of their own
       account. Caught here rather than by a database error. */
    const clash = db.select().from(users).where(eq(users.email, email)).get();
    if (clash && clash.id !== userId) {
      return { ok: false as const, code: "EMAIL_TAKEN" as const };
    }
    next.email = email;
  }

  if (patch.phone !== undefined) {
    const phone = patch.phone.trim();
    const digits = (phone.match(/\d/g) ?? []).length;
    if (digits < 8 || digits > 15) {
      return { ok: false as const, code: "PHONE_INVALID" as const };
    }
    /* Same rule as registration, compared the same way: one number, one member.
       Otherwise the desk correcting a typo could quietly create the duplicate
       that registration is careful to refuse. */
    const asked = toE164(phone);
    if (asked) {
      const clash = db
        .select({ id: users.id, phone: users.phone })
        .from(users)
        .all()
        .find((u) => u.id !== userId && toE164(u.phone) === asked);
      if (clash) return { ok: false as const, code: "PHONE_TAKEN" as const };
    }
    next.phone = phone;
  }

  for (const key of [
    "notifyEmail",
    "notifySms",
    "notifyPush",
    "marketingOptIn",
    "isTest",
  ] as const) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }

  /**
   * The pilates answers, validated rather than trusted.
   *
   * A level of "Beginer" typed at the desk would sit in the column forever and
   * match nothing the member's own screen offers, so an unrecognised value is a
   * refusal and not a silent write.
   */
  if (patch.pilatesLevel !== undefined) {
    if (!isPilatesLevel(patch.pilatesLevel)) {
      return { ok: false as const, code: "LEVEL_INVALID" as const };
    }
    next.pilatesLevel = patch.pilatesLevel;
  }
  if (patch.pilatesSince !== undefined) {
    if (!isPilatesExperience(patch.pilatesSince)) {
      return { ok: false as const, code: "EXPERIENCE_INVALID" as const };
    }
    next.pilatesSince = patch.pilatesSince;
  }
  if (patch.healthCondition !== undefined) {
    const text = patch.healthCondition.trim();
    if (text.length > CONDITION_MAX_CHARS) {
      return { ok: false as const, code: "CONDITION_TOO_LONG" as const };
    }
    next.healthCondition = text.length ? text : null;
  }
  /* The staff note. Emptied to null rather than to "", so "nothing written
     here" is one value and not two that look the same on a screen. */
  if (patch.notes !== undefined) {
    const text = patch.notes.trim();
    if (text.length > STAFF_NOTES_MAX_CHARS) {
      return { ok: false as const, code: "NOTES_TOO_LONG" as const };
    }
    next.notes = text.length ? text : null;
  }

  /* Answering any of the three at the desk marks the step done, so a member
     the desk has already asked in person is not stopped by the gate on the
     booking route the first time they use the site. Only ever set, never
     cleared: see lib/intake.ts. */
  if (
    !user.intakeAt &&
    (patch.pilatesLevel !== undefined ||
      patch.pilatesSince !== undefined ||
      patch.healthCondition !== undefined)
  ) {
    next.intakeAt = new Date();
  }

  if (!Object.keys(next).length) return { ok: true as const, changed: [] };

  db.update(users).set(next).where(eq(users.id, userId)).run();
  return { ok: true as const, changed: Object.keys(next) };
}

/**
 * Set a new password for a member who cannot get in.
 *
 * The desk types a password and reads it out. That is deliberately blunt: there
 * is no email provider wired up yet, so a reset link would go nowhere, and a
 * member standing at the desk locked out of their account is a problem now.
 * When email is connected this should become a one-time link instead.
 */
export async function resetPassword(userId: string, plain: string) {
  if (plain.length < 8) return { ok: false as const, code: "PASSWORD_SHORT" as const };
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false as const, code: "NOT_FOUND" as const };

  db.update(users)
    .set({ passwordHash: await hashPassword(plain) })
    .where(eq(users.id, userId))
    .run();

  return { ok: true as const };
}

/* ------------------------------------------------ booking for a member ---- */

export type DeskBookResult =
  | { ok: true; bookingId: string; balance: number; guestName: string | null }
  | { ok: false; code: string; until?: Date };

/**
 * Reception taking a booking over the telephone.
 *
 * The studio's reason for wanting this is worth writing down, because it shapes
 * the rules: a class with three people in it and another with one is a Tuesday
 * that could have been two full classes, and the fix is somebody at the desk
 * ringing round to ask whether the member with the quiet class can come to the
 * busy one. That call ends with "yes, put me in", and until now there was no way
 * to put them in.
 *
 * **It books under the member's own rules, not the desk's.** This is the whole
 * design of it, and it was a decision rather than the easy path: `bookClass` is
 * called exactly as the member's own screen calls it, so a session comes out of
 * the package that expires soonest, a group session cannot pay for a noon
 * appointment, a full class is still full, the one-a-day cap on the Unlimited
 * plan still applies, and a member with nothing left is refused.
 *
 * The alternative — a desk that can book without spending anything, or with an
 * override for the member who has run out — is more convenient about twice a
 * month and wrong every day after that. The balance on the member's screen stops
 * matching what they have actually used, and the first person to notice is a
 * member who counted differently from the studio. Reception can already sell
 * sessions in ten seconds; a member who wants a class and has none should buy
 * one, and that conversation is a better outcome for the studio than a free
 * class nobody recorded.
 *
 * Two things it deliberately does *not* inherit. The cancellation window is not
 * one of them, because cancelling is `cancelForMember` and that one does
 * override the window: the difference is that a late cancellation is the desk
 * exercising judgement about a member who rang with a reason, while a booking
 * paid for by nothing is the desk creating money.
 */
export async function bookForMember(args: {
  sessionId: string;
  userId: string;
  staffName: string;
  /** For a duet, the second person. Same rule as the member's own screen. */
  guestName?: string | null;
  now?: Date;
}): Promise<DeskBookResult> {
  const { sessionId, userId, staffName, guestName = null, now } = args;

  const member = db.select().from(users).where(eq(users.id, userId)).get();
  if (!member) return { ok: false, code: "NOT_FOUND" };

  /**
   * An unconfirmed address cannot hold a seat, at the desk or anywhere else.
   *
   * The same rule the member's own booking route applies, and for the same
   * reason: the seat is real and finite, and the studio has no way to tell the
   * holder it has moved. The desk can confirm the address in half a minute
   * while they are on the phone, which is why this is a refusal with an obvious
   * next step rather than an obstacle.
   */
  if (!isVerified(member)) {
    return { ok: false, code: "EMAIL_UNVERIFIED" };
  }

  const result = bookClass(userId, sessionId, {
    guestName,
    ...(now ? { now } : {}),
  });

  if (!result.ok) {
    return { ok: false, code: result.code, until: result.until };
  }

  /**
   * The member is told, exactly as if they had booked it themselves.
   *
   * They agreed to it on the telephone, so this is not news — but it is the
   * only written record they get, and it carries the date, the time and the
   * cancellation deadline. Somebody who says yes on Monday to a class on
   * Thursday has forgotten the details by Tuesday.
   *
   * Not awaited: a push service being slow must not make the person at the desk
   * wait, and a notification that fails must not read as a booking that failed.
   */
  void notifyBooked(result.bookingId).catch(() => {});

  /**
   * And the reminder, which a desk booking was not getting at all.
   *
   * A member booking themselves gets one queued by the booking route; a member
   * booked over the telephone got nothing, so the people most likely to need
   * reminding — the ones who ring up rather than use the site — were the only
   * ones not reminded. Nobody would have noticed until somebody missed a class
   * they had been booked into by somebody else.
   *
   * Here rather than in the route, so the single booking and the term booking
   * both get it from one place. Never allowed to throw: a reminder that will not
   * queue must not cost somebody their class.
   */
  try {
    scheduleReminder(result.bookingId);
  } catch {
    /* Logged nowhere on purpose — the booking is what matters, and the sweep
       will not miss a row it never had. */
  }

  /* Who did it, in the ledger, next to the session it spent. The spend line is
     already there from `bookClass`; this names the hand that made it, which is
     the difference between "a session was used" and "reception booked them in
     on the phone". */
  db.insert(creditLedger)
    .values({
      userId,
      delta: 0,
      reason: "ADMIN_GRANT",
      note: `Booked at the desk by ${staffName}`,
      batchId: result.creditBatchId,
      bookingId: result.bookingId,
    })
    .run();

  return {
    ok: true,
    bookingId: result.bookingId,
    guestName: result.guestName,
    balance: (await getCreditSummary(userId)).available,
  };
}

/* --------------------------------------------- a term of the same slot, at the desk */

export type DeskRepeatResult =
  | {
      ok: true;
      /** Weeks taken by this call. */
      booked: number;
      /** Weeks the member already held. Not a failure. */
      alreadyHad: number;
      /**
       * Weeks that could not be booked, each with its date, its reason, and —
       * where the reason is an expiry — the last date the member's sessions
       * reach. Reception has to explain the refusal down the telephone, and
       * "could not book the 5th" is not an explanation.
       */
      failed: { startsAt: string; code?: string; until?: string }[];
      /** How many weeks were considered, so the desk can say "6 of 8". */
      asked: number;
      balance: number;
    }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "EMAIL_UNVERIFIED"
        | "SESSION_NOT_FOUND"
        | "NOT_REPEATABLE"
        | "BAD_WEEKS";
    };

/**
 * "Can you put me in every Monday until Christmas?"
 *
 * The member's own screen has had this since the three-month packs went on sale,
 * and the desk asked for the same thing within a day of seeing it — which is
 * exactly right: the people who ring up rather than use the site are the ones
 * most likely to want a fixed slot for a term, and reception was doing it twelve
 * clicks at a time.
 *
 * Deliberately thin. Everything about *what may be booked* lives in
 * `repeatWeekly`, which is the same function the member's own screen calls, so
 * the desk cannot accidentally get a different answer from the website about the
 * same class. What this adds is the three things that are the desk's alone: the
 * member has to exist and be confirmed, every booking gets a ledger line naming
 * the receptionist who took the call, and the member is told once rather than
 * twelve times.
 *
 * The rules it does *not* override are the ones that would cost the studio
 * money: no sessions, no booking. See `bookForMember` for why that is not
 * negotiable, and note that it applies to all twelve weeks here — a member with
 * four sessions left gets four weeks and is told about the other eight, which is
 * a far more useful answer at a counter than a flat refusal.
 */
export async function repeatForMember(args: {
  sessionId: string;
  userId: string;
  weeks: number;
  staffName: string;
  now?: Date;
}): Promise<DeskRepeatResult> {
  const { sessionId, userId, weeks, staffName, now } = args;

  const member = db.select().from(users).where(eq(users.id, userId)).get();
  if (!member) return { ok: false, code: "NOT_FOUND" };
  /* The same rule as a single desk booking: an unconfirmed address cannot hold
     a seat, and the desk can confirm one in half a minute while the member is
     still on the telephone. */
  if (!isVerified(member)) return { ok: false, code: "EMAIL_UNVERIFIED" };

  if (!Number.isInteger(weeks) || weeks < 2 || weeks > MAX_REPEAT_WEEKS) {
    return { ok: false, code: "BAD_WEEKS" };
  }

  const run = repeatWeekly({ userId, sessionId, weeks, ...(now ? { now } : {}) });
  if (!run.ok) return { ok: false, code: run.code };

  /**
   * A ledger line per booking, naming who took the call.
   *
   * One per week rather than one for the run. The ledger is read one member at a
   * time to answer "where did this session go", and a single line covering
   * twelve of them would be a line that cannot be matched to any of the classes
   * it paid for.
   */
  for (const o of run.outcomes) {
    if (!o.ok || !o.bookingId) continue;
    db.insert(creditLedger)
      .values({
        userId,
        delta: 0,
        reason: "ADMIN_GRANT",
        note: `Booked at the desk by ${staffName}, ${weeks}-week run`,
        batchId: o.creditBatchId ?? null,
        bookingId: o.bookingId,
      })
      .run();
  }

  /* The reminders, one per class. Each is queued at the member's own lead time
     against its own class, which is the whole point of doing this per booking
     rather than per run. */
  for (const id of run.bookingIds) {
    try {
      scheduleReminder(id);
    } catch {
      /* A reminder that will not queue must not cost somebody their class. */
    }
  }

  /**
   * Told once, about the whole run.
   *
   * Twelve notifications for one telephone call is a phone buzzing in somebody's
   * hand while they are still talking to reception, and it is how a member
   * learns to turn notifications off.
   *
   * It used to be one notification about the *first class*, which was quiet and
   * wrong: a member who booked a term over the telephone got a message naming
   * one Monday. This one names the slot, the count, the span and any week that
   * could not be taken — which matters more here than on the website, because
   * the person who books by telephone is the one not looking at a screen.
   */
  void notifyRepeatBooked(run).catch(() => {});

  return {
    ok: true,
    booked: run.booked,
    alreadyHad: run.alreadyHad,
    failed: run.failed.map((f) => ({
      startsAt: f.startsAt,
      code: f.code,
      until: f.until,
    })),
    asked: run.outcomes.length,
    balance: (await getCreditSummary(userId)).available,
  };
}

/* ------------------------------------------------------- who is teaching it */

export type AssignResult =
  | {
      ok: true;
      /** Who is teaching it now, or null if the slot was cleared. */
      instructor: string | null;
      /** Who was teaching it before. */
      previous: string | null;
      /** Members told about the change. Zero unless it was a real swap. */
      told: number;
    }
  | {
      ok: false;
      code: "SESSION_NOT_FOUND" | "INSTRUCTOR_NOT_FOUND" | "INSTRUCTOR_INACTIVE";
    };

/**
 * Put an instructor on one class, or take them off it.
 *
 * One class, not the weekly template. That is the whole reason this exists: the
 * rota says Elena teaches Tuesdays at 18:00, and this morning Elena is ill. What
 * the studio needs to change is Tuesday the 8th, not every Tuesday, and a tool
 * that could only edit the template would either be useless for the actual
 * problem or would quietly rewrite the rota to solve one day of it.
 *
 * It is also how a midday appointment gets staffed at all. Those slots are
 * generated with nobody on them on purpose, because who teaches an hour that
 * nobody was rostered for is decided by a phone call after the booking lands.
 * This is where the answer to that phone call is written down.
 *
 * ---
 *
 * **Past classes can still be edited, and deliberately.**
 *
 * "Elena covered that one, not Andreas" is a correction to the record, and the
 * record is what the studio looks at months later. Refusing it would keep the
 * history tidy-looking and wrong. Nothing is sent for a class that has already
 * started, though: see below.
 *
 * **When the members are told.**
 *
 * Only on a real swap: a named instructor replaced by a different named
 * instructor, on a class still to come, with somebody booked into it. Filling an
 * empty slot is not a swap and nobody was promised anything, so it sends
 * nothing; nor does clearing one, because "your instructor is now nobody" is not
 * a message anybody should receive. An instructor changing is one of the things
 * a member cannot opt out of hearing about, which is the studio's own rule and
 * the reason `serviceOptInAt` exists.
 */
export async function assignInstructor(args: {
  sessionId: string;
  /** Null clears the slot. */
  instructorId: string | null;
  staffName: string;
  now?: Date;
}): Promise<AssignResult> {
  const { sessionId, instructorId, staffName } = args;
  const now = args.now ?? new Date();

  const session = db
    .select()
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
    .get();
  if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };

  const before = session.instructorId
    ? (db
        .select()
        .from(instructors)
        .where(eq(instructors.id, session.instructorId))
        .get() ?? null)
    : null;

  let after: typeof before = null;
  if (instructorId) {
    after =
      db
        .select()
        .from(instructors)
        .where(eq(instructors.id, instructorId))
        .get() ?? null;
    if (!after) return { ok: false, code: "INSTRUCTOR_NOT_FOUND" };
    /* An instructor who has left the studio can be taken off a class but not
       put on one. Otherwise the rota can be filled with somebody who is not
       coming in. */
    if (!after.active) return { ok: false, code: "INSTRUCTOR_INACTIVE" };
  }

  /* Nothing to do, and nothing to announce. */
  if ((session.instructorId ?? null) === (instructorId ?? null)) {
    return {
      ok: true,
      instructor: after?.name ?? null,
      previous: before?.name ?? null,
      told: 0,
    };
  }

  db.update(classSessions)
    .set({ instructorId: instructorId ?? null })
    .where(eq(classSessions.id, sessionId))
    .run();

  const isSwap =
    Boolean(before) && Boolean(after) && before!.id !== after!.id;
  const stillToCome = session.startsAt.getTime() > now.getTime();

  let told = 0;
  if (isSwap && stillToCome) {
    /* Not awaited into the caller's error path: a message that fails to send
       must not read as a change that failed to save. It has saved. */
    told = await notifyInstructorChanged(sessionId, {
      from: before!.name,
      to: after!.name,
      by: staffName,
    }).catch(() => 0);
  }

  return {
    ok: true,
    instructor: after?.name ?? null,
    previous: before?.name ?? null,
    told,
  };
}

export type SetLevelResult =
  | { ok: false; code: "SESSION_NOT_FOUND" | "BAD_LEVEL" }
  | { ok: true; level: ClassLevel; upcoming: number };

/**
 * Set a class's level, either on the one class or on the recurring slot.
 *
 * A label, not a rule: this changes what members are told a class is aimed at,
 * and refuses nobody a booking. Two shapes, which is the whole point of asking:
 *
 *   - one class only — the desk is fixing a single date. The level is written on
 *     the session, which overrides whatever the slot says for that class alone.
 *
 *   - every upcoming class of this slot — the desk is changing the timetable. The
 *     level is written on the *template*, so classes the rota generates next
 *     month already carry it, and onto every already-generated class of the slot
 *     from the start of today onward. Classes that have already run are history
 *     and left alone, so "from now on Thursday 10:00 is Beginners" does not
 *     rewrite last Thursday.
 *
 * Pure updates: a template row and some session rows. Nothing is deleted, no
 * booking is touched, and a level nobody recognises is refused before any write.
 */
export function setClassLevel(args: {
  sessionId: string;
  level: string;
  applyToUpcoming: boolean;
  now?: Date;
}): SetLevelResult {
  const now = args.now ?? new Date();
  if (!isClassLevel(args.level)) return { ok: false, code: "BAD_LEVEL" };
  const level = args.level;

  const session = db
    .select()
    .from(classSessions)
    .where(eq(classSessions.id, args.sessionId))
    .get();
  if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };

  /* Just this class — or a one-off class with no slot behind it. */
  if (!args.applyToUpcoming || !session.templateId) {
    db.update(classSessions)
      .set({ level })
      .where(eq(classSessions.id, args.sessionId))
      .run();
    return { ok: true, level, upcoming: 1 };
  }

  const templateId = session.templateId;
  const cutoff = studioStartOfDay(now);
  return db.transaction((): SetLevelResult => {
    db.update(classTemplates)
      .set({ level })
      .where(eq(classTemplates.id, templateId))
      .run();
    const res = db
      .update(classSessions)
      .set({ level })
      .where(
        and(
          eq(classSessions.templateId, templateId),
          gte(classSessions.startsAt, cutoff),
        ),
      )
      .run();
    return { ok: true, level, upcoming: res.changes };
  });
}
