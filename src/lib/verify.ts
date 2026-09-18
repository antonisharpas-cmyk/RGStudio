import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailVerifications, users } from "@/db/schema";

/**
 * Proving that an email address belongs to whoever typed it.
 *
 * A six-digit code, emailed on registration, typed back before the account can
 * be used. It exists because nothing else in this system checks that address at
 * all: the studio's reminders, receipts and "your class has moved" notices all
 * go to whatever was in the box, and a member who mistyped their own address
 * never finds out — they simply stop hearing from a studio that believes it has
 * told them everything.
 *
 * ---
 *
 * **Why six digits and not a link.**
 *
 * A link is one click and no typing, and it is the wrong shape here. Somebody
 * registering is standing in the studio or sitting on a sofa with the site open;
 * a link opens a *second* session in whichever browser their mail app prefers,
 * and they end up signed in twice in two places wondering which one is real. A
 * code is read in one window and typed in the other, and the account they came
 * from is the account that gets verified.
 *
 * ---
 *
 * **What actually protects it.**
 *
 * Not the hash. Six digits is a million possibilities, which a computer walks
 * through in under a second, so storing a keyed hash rather than the code buys
 * something real — a stolen database file is not a list of live codes — but it
 * is not the defence.
 *
 * The defence is that a code is worth guessing for fifteen minutes, five wrong
 * answers kill it, and asking for a new one is limited to five an hour. Those
 * three numbers together mean an attacker gets a handful of tries at a moving
 * target, which is the same arithmetic that makes a four-digit bank PIN safe.
 */

/** Digits in a code. Six is what everybody's muscle memory expects. */
export const OTP_LENGTH = 6;

/**
 * How long a code lives.
 *
 * Fifteen minutes rather than five. The failure this has to survive is a slow
 * mail server, and there is nothing more deflating than a code that expired
 * while it was in transit — the member types the one they were sent, is told it
 * is wrong, and reasonably concludes the site is broken.
 */
export const OTP_TTL_MINUTES = 15;

/** Wrong answers before the code is dead and a new one is needed. */
export const OTP_MAX_ATTEMPTS = 5;

/** Seconds between sends. Long enough to stop double-clicks and hammering. */
export const OTP_RESEND_SECONDS = 60;

/** Sends allowed inside one rolling hour, so nobody's inbox becomes a weapon. */
export const OTP_MAX_SENDS = 5;

const WINDOW_MS = 60 * 60 * 1000;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Add it to .env (see .env.example).",
    );
  }
  return s;
}

/**
 * The stored form of a code.
 *
 * Keyed with AUTH_SECRET rather than a bare digest. A plain SHA-256 of six
 * digits is a lookup table somebody has already built; keying it means the
 * database on its own is not enough to check a guess against.
 */
function hash(code: string) {
  return createHmac("sha256", key()).update(code).digest("hex");
}

/** Constant-time, so a wrong code cannot be narrowed down by how long it took. */
function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * A fresh code, never the one it replaces.
 *
 * `randomInt` and not `Math.random`: this is a credential, and a predictable
 * credential is not one. The retry is the studio's own requirement — a resend
 * that produced the same six digits would look to the member as though nothing
 * had happened, and would hand a second life to a code that may have been
 * guessed at four times already.
 */
function freshCode(previousHash?: string | null) {
  for (let i = 0; i < 20; i++) {
    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(
      OTP_LENGTH,
      "0",
    );
    if (!previousHash || hash(code) !== previousHash) return code;
  }
  /* Twenty collisions against one specific value is not going to happen; the
     loop is bounded so a bug cannot turn into a hang. */
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

export type Challenge = { code: string; expiresAt: Date };

/**
 * Start again: a brand-new code, the attempt counter cleared, the hourly
 * allowance reset.
 *
 * Used at registration. Not used for "send it again" — that is `resendCode`,
 * which has to answer to the limits.
 */
export function issueCode(userId: string): Challenge {
  const now = new Date();
  const existing = db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .get();

  const code = freshCode(existing?.codeHash);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);

  const row = {
    userId,
    codeHash: hash(code),
    expiresAt,
    attempts: 0,
    sends: 1,
    windowStartedAt: now,
    sentAt: now,
  };

  if (existing) {
    db.update(emailVerifications)
      .set(row)
      .where(eq(emailVerifications.id, existing.id))
      .run();
  } else {
    db.insert(emailVerifications).values(row).run();
  }

  return { code, expiresAt };
}

export type ResendResult =
  | { ok: true; challenge: Challenge }
  | { ok: false; code: "NO_CHALLENGE" }
  | { ok: false; code: "TOO_SOON"; secondsLeft: number }
  | { ok: false; code: "LIMIT"; minutesLeft: number };

/**
 * Another code, if they are allowed one.
 *
 * The cooldown is the useful half of this: the commonest reason somebody presses
 * "send it again" is that the first one has not arrived yet, and sending a second
 * immediately means two codes racing each other to an inbox where only the newer
 * one works. Sixty seconds is long enough for the first to land.
 *
 * The hourly cap is the other half, and it protects a person who is not in this
 * conversation: whoever owns the address. Somebody typing a stranger's email
 * into the registration form must not be able to turn this into a way of posting
 * mail to them all afternoon.
 */
export function resendCode(userId: string): ResendResult {
  const now = new Date();
  const row = db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .get();
  if (!row) {
    /* No challenge on record at all — an account mid-verification whose row was
       cleaned out. Issuing one is the helpful answer, not an error. */
    return { ok: true, challenge: issueCode(userId) };
  }

  const since = now.getTime() - row.sentAt.getTime();
  if (since < OTP_RESEND_SECONDS * 1000) {
    return {
      ok: false,
      code: "TOO_SOON",
      secondsLeft: Math.ceil((OTP_RESEND_SECONDS * 1000 - since) / 1000),
    };
  }

  /* A rolling window rather than a running total: five sends is five sends an
     hour, not five sends ever. A total would leave somebody permanently stuck
     with an address they cannot confirm and no way forward. */
  const windowAge = now.getTime() - row.windowStartedAt.getTime();
  const fresh = windowAge >= WINDOW_MS;
  const sends = fresh ? 0 : row.sends;
  if (sends >= OTP_MAX_SENDS) {
    return {
      ok: false,
      code: "LIMIT",
      minutesLeft: Math.max(1, Math.ceil((WINDOW_MS - windowAge) / 60_000)),
    };
  }

  const code = freshCode(row.codeHash);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);
  db.update(emailVerifications)
    .set({
      codeHash: hash(code),
      expiresAt,
      /* The attempt counter belongs to the code, not to the account: a new code
         has had nothing typed against it. */
      attempts: 0,
      sends: sends + 1,
      windowStartedAt: fresh ? now : row.windowStartedAt,
      sentAt: now,
    })
    .where(eq(emailVerifications.id, row.id))
    .run();

  return { ok: true, challenge: { code, expiresAt } };
}

export type CheckResult =
  | { ok: true }
  | { ok: false; code: "ALREADY" }
  | { ok: false; code: "NO_CHALLENGE" }
  | { ok: false; code: "EXPIRED" }
  | { ok: false; code: "LOCKED" }
  | { ok: false; code: "WRONG"; attemptsLeft: number };

/**
 * Typed back. On success the account is verified and the challenge is gone.
 *
 * "Already verified" is a success shaped like a failure, and it is reported
 * separately so the screen can send them on rather than telling somebody who
 * has done nothing wrong that their code is invalid. It happens for a mundane
 * reason: two tabs open, verified in one, the other still showing the box.
 */
export function checkCode(userId: string, typed: string): CheckResult {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false, code: "NO_CHALLENGE" };
  if (user.emailVerifiedAt) return { ok: false, code: "ALREADY" };

  const row = db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .get();
  if (!row) return { ok: false, code: "NO_CHALLENGE" };

  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, code: "LOCKED" };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, code: "EXPIRED" };
  }

  /* Digits only. People type "123 456" and paste "123456 " out of an email, and
     refusing either would be refusing the right code. */
  const code = typed.replace(/\D/g, "");
  if (code.length !== OTP_LENGTH || !sameHash(hash(code), row.codeHash)) {
    const attempts = row.attempts + 1;
    db.update(emailVerifications)
      .set({ attempts })
      .where(eq(emailVerifications.id, row.id))
      .run();
    return {
      ok: false,
      code: "WRONG",
      attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
    };
  }

  db.update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, userId))
    .run();
  /* Deleted rather than marked used: it has done its job, and a spent code left
     lying in the table is one more thing that could be checked against. */
  db.delete(emailVerifications)
    .where(eq(emailVerifications.id, row.id))
    .run();

  return { ok: true };
}

/** The live challenge's state, for the screen that shows the box. */
export function challengeState(userId: string) {
  const row = db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .get();
  if (!row) return null;
  const now = Date.now();
  return {
    expiresAt: row.expiresAt,
    expired: row.expiresAt.getTime() <= now,
    locked: row.attempts >= OTP_MAX_ATTEMPTS,
    attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - row.attempts),
    resendInSeconds: Math.max(
      0,
      Math.ceil((row.sentAt.getTime() + OTP_RESEND_SECONDS * 1000 - now) / 1000),
    ),
  };
}
