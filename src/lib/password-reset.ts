import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { hashPassword } from "./auth";

/**
 * Forgotten passwords.
 *
 * The member types their email, gets a link, taps it, types a new password
 * twice. Three rules carry the whole thing:
 *
 *   - The request never says whether the address exists. "If that address has
 *     an account, the email is on its way" is the answer for everybody, so the
 *     form cannot be used to list who is a member.
 *   - The link is a 32 byte random token, kept only as a keyed hash, good for
 *     one hour and one use. That is a space nobody guesses, so unlike the six
 *     digit verification code it needs no attempt counter; the request route
 *     is rate limited so the mailbox cannot be flooded.
 *   - Setting the password consumes the link. A second tap on the same email
 *     lands on "this link has been used", and the only way forward is to ask
 *     for a new one.
 */

export const RESET_TTL_MINUTES = 60;

/** Same floor as registration. */
export const PASSWORD_MIN = 8;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Add it to .env (see .env.example).",
    );
  }
  return s;
}

function hash(token: string) {
  return createHmac("sha256", key()).update(token).digest("hex");
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

const TOKEN_RE = /^[a-f0-9]{64}$/;

/**
 * Start a reset for an address.
 *
 * Returns the token and the account when there is one, so the caller can send
 * the email, and null otherwise. The caller answers the browser the same way
 * in both cases.
 */
export function requestReset(emailRaw: string) {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  if (!email) return null;
  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user) return null;

  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);
  const row = { userId: user.id, tokenHash: hash(token), expiresAt, usedAt: null };

  const existing = db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(eq(passwordResets.userId, user.id))
    .get();
  if (existing) {
    db.update(passwordResets).set(row).where(eq(passwordResets.id, existing.id)).run();
  } else {
    db.insert(passwordResets).values(row).run();
  }

  return { token, user, expiresAt };
}

export type ResetLookup =
  | { ok: true; userId: string; rowId: string }
  | { ok: false; code: "INVALID" | "EXPIRED" | "USED" };

/**
 * Is this link still good?
 *
 * The page asks before drawing the form, so a dead link is told so at once
 * rather than after the member has typed a password twice.
 */
export function lookupReset(tokenRaw: string, now = new Date()): ResetLookup {
  const token = String(tokenRaw ?? "").trim();
  if (!TOKEN_RE.test(token)) return { ok: false, code: "INVALID" };
  const wanted = hash(token);

  /* One row per user and a handful of rows in total, so a scan with a constant
     time compare on each is fine, and it keeps the hash out of the WHERE. */
  const rows = db.select().from(passwordResets).all();
  const row = rows.find((r) => sameHash(r.tokenHash, wanted));
  if (!row) return { ok: false, code: "INVALID" };
  if (row.usedAt) return { ok: false, code: "USED" };
  if (row.expiresAt <= now) return { ok: false, code: "EXPIRED" };
  return { ok: true, userId: row.userId, rowId: row.id };
}

export type ResetResult =
  | { ok: true; userId: string }
  | { ok: false; code: "INVALID" | "EXPIRED" | "USED" | "PASSWORD_SHORT" | "MISMATCH" };

/** Set the new password and burn the link. */
export async function completeReset(
  token: string,
  password: string,
  confirm: string,
  now = new Date(),
): Promise<ResetResult> {
  const found = lookupReset(token, now);
  if (!found.ok) return found;
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return { ok: false, code: "PASSWORD_SHORT" };
  }
  if (password !== confirm) return { ok: false, code: "MISMATCH" };

  const passwordHash = await hashPassword(password);
  db.update(users).set({ passwordHash }).where(eq(users.id, found.userId)).run();
  db.update(passwordResets)
    .set({ usedAt: now })
    .where(eq(passwordResets.id, found.rowId))
    .run();
  return { ok: true, userId: found.userId };
}
