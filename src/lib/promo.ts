import { studioWallTimeToInstant } from "./time";

/**
 * The opening offer, in one place.
 *
 * One free session for every account created between `grantFrom` and
 * `grantUntil`, spendable only on classes inside `spendFrom`…`spendUntil`.
 *
 * Everything about the campaign lives here on purpose. The alternative — a
 * `2026-09-20` written into the registration route, another into the booking
 * rules, a third into the copy — is four places to remember and three of them
 * will be missed the next time the studio runs an offer. Which it will: there is
 * always a Christmas.
 *
 * ---
 *
 * **Two different dates, and they are not the same thing.**
 *
 *   expiresAt     the last moment the session can be *spent*
 *   spendUntil    the last class it can be spent *on*
 *
 * The credit system already understood the first and not the second, and without
 * the second the offer does not work: a member granted a free session on the 1st
 * could spend it on the 2nd to book a class in November. The free session would
 * leak straight into the paid schedule and the opening-week constraint would mean
 * nothing. See `spendOneCredit`, which now takes the class date for exactly this.
 *
 * ---
 *
 * **If the month fills up, widen it here.**
 *
 * The offer ran for one week when it was written and now runs for the whole of
 * September, which is roughly four times the seats: the rota puts about 300
 * seats a week into the schedule, so the month holds something over a thousand.
 * One free session each is comfortable at that size. If it does run out, moving
 * `spendUntil` and `expiresAt` later is a one-line change and no member loses
 * anything by it. That escape hatch is the reason the dates are constants
 * rather than a hard-coded string.
 *
 * ---
 *
 * **When the session is actually handed over.**
 *
 * Not at registration. See `promoForJoin` at the bottom of this file: the offer
 * is decided by the date the account was *created* and granted the moment the
 * emailed code is typed back. Registering inside the window and confirming
 * afterwards still qualifies, so nothing is lost by the delay, and an address
 * that never confirms is never given anything.
 */

/** Studio wall-clock, so a date here means that date in Larnaca. */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  studioWallTimeToInstant(y, m, d, h, min);

export const PROMO = {
  /**
   * Turn the whole thing off without deleting anything.
   *
   * `PROMO_ENABLED=false` in the environment switches it off — which the studio
   * may want on a day's notice if the week fills up, and which the test suites
   * need because they assert what a new account starts with. A registration that
   * hands out a free session is correct behaviour and it is *not* the behaviour
   * the rest of the app is tested against.
   */
  enabled: process.env.PROMO_ENABLED !== "false",

  /** A short name, for the ledger and the desk. */
  name: "Opening week",

  /** How many free sessions a qualifying new account gets. */
  credits: 1,

  /**
   * Accounts created inside this window qualify. Accounts older than
   * `grantFrom` do not — the studio's decision, and the reason is that the
   * accounts predating the offer are development and staff ones.
   */
  grantFrom: at(2026, 8, 28),
  /**
   * And it stops when the offer does.
   *
   * This has to move whenever `spendUntil` moves, and it is the easy one to
   * forget: leave it a week later than the spendable window and somebody who
   * registers after the last class is handed a free session that cannot buy
   * anything, ever. They would see it in their balance, try to use it, and be
   * refused by a rule they were never told about. Better to make no promise than
   * an empty one.
   */
  grantUntil: at(2026, 10, 1, 0, 0),

  /**
   * The classes it may be spent on: Monday 14 September to the end of Wednesday
   * 30 September, which is the last day of the month and a day the studio is
   * open. The free-session note on the balance card reads these dates straight
   * off the granted batch, so moving this date moves the message with it.
   */
  spendFrom: at(2026, 9, 14, 0, 0),
  spendUntil: at(2026, 9, 30, 23, 59),

  /**
   * And the last moment it can be spent at all.
   *
   * The end of the 30th, the same evening as the last class it can buy. It used
   * to be a day later than `spendUntil` so that a member looking at their
   * balance did not see a session and a date that had both just gone; that
   * kindness does not survive the month boundary, because a session that
   * outlives the offer by a day can buy nothing at all and reads as a promise
   * broken rather than kept. Ending both together is the honest version.
   */
  expiresAt: at(2026, 9, 30, 23, 59),
} as const;

/**
 * The offer, if an account created at this moment qualifies for it.
 *
 * Takes the account's creation date rather than "now", and that is the whole
 * point of the parameter. The session is handed over when the emailed code is
 * typed back, which can be minutes or a day after registering, and the member
 * must not be punished for reading their email in the morning: somebody who
 * signs up at 23:50 on the 30th and confirms on the 1st registered inside the
 * offer and gets it.
 *
 * The other direction is closed by the same rule. Confirming an account that
 * was created before the offer opened grants nothing, so an old development or
 * staff account cannot collect a free session by verifying late.
 */
export function promoForJoin(createdAt: Date) {
  if (!PROMO.enabled) return null;
  if (createdAt < PROMO.grantFrom || createdAt >= PROMO.grantUntil) return null;
  return PROMO;
}

/** The offer, if somebody registering right now would qualify for it. */
export function activePromo(now = new Date()) {
  return promoForJoin(now);
}

/** Whether a batch with this window may be spent on a class at this time. */
export function windowAllows(
  batch: { usableFrom: Date | null; usableTo: Date | null },
  classStartsAt: Date,
) {
  if (batch.usableFrom && classStartsAt < batch.usableFrom) return false;
  if (batch.usableTo && classStartsAt > batch.usableTo) return false;
  return true;
}
