import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

/* Imported and re-exported so every existing import keeps working. The constant
   itself lives in its own file because middleware.ts needs it and cannot import
   this one — see lib/session-cookie.ts. */
import { SESSION_COOKIE } from "./session-cookie";
export { SESSION_COOKIE };
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * The desk console is behind a second door.
 *
 * Being signed in as staff is not enough to open /admin: the password has to be
 * typed again. The reason is the reception computer — it stands in a public
 * room, signed in all day, and a member of the public who wanders behind the
 * desk should not be one click away from every member's phone number and a
 * password reset. A long-lived session cookie is the right trade for booking a
 * class; it is the wrong trade for this.
 *
 * ---
 *
 * **Fifteen minutes of idleness, not forty-five minutes of wall clock.**
 *
 * This was a flat 45-minute window from the moment the password was typed,
 * which is the wrong shape twice over. It shut the console on somebody in the
 * middle of serving a queue, and it left an abandoned counter open for up to
 * three quarters of an hour. Both of those are the same mistake: measuring the
 * wrong thing.
 *
 * So the window is now short and it slides. Every desk action pushes it out
 * again — see `touchDesk` — so reception working through a morning is never
 * interrupted, and a counter nobody has touched for a quarter of an hour asks
 * for the password. Shorter *and* less annoying, which is unusual enough to be
 * worth saying out loud.
 */
export const ADMIN_COOKIE = "rg_desk";

/** How long the desk stays open with nobody touching it. */
export const ADMIN_IDLE_SECONDS = 60 * 15;

/**
 * How little life a cookie must have left before an action re-issues it.
 *
 * Without this, every desk request would sign a fresh token and set a cookie —
 * correct, and needless. Two thirds of the window is the sweet spot: any action
 * inside the idle period still slides it, and a busy screen rewrites the cookie
 * at most once every five minutes instead of on every click.
 */
const ADMIN_REFRESH_BELOW_SECONDS = 60 * 10;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Add it to .env (see .env.example).",
    );
  }
  return new TextEncoder().encode(s);
}

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  role: string;
  /**
   * Whether this account had confirmed its email when the cookie was issued.
   *
   * In the token as well as in the database, because the middleware needs it and
   * the middleware cannot read the database — it runs on every request, before
   * any page, and SQLite is not available to it.
   *
   * The database stays the authority. This claim only decides where somebody is
   * *sent*; every route that acts on a member's behalf re-reads the row. A stale
   * cookie can therefore let somebody look at a page they should have been
   * redirected away from, and can never let them do anything.
   *
   * Undefined on cookies issued before this existed. Treated as verified, so
   * nobody signed in at the moment this shipped is locked out of a site they
   * have been using for weeks.
   */
  verified: boolean;
};

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 11);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerifiedAt?: Date | null;
}) {
  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    /* Re-issued when the code comes back, which is what moves this to true —
       see /api/auth/verify. */
    v: isVerified({ role: user.role, emailVerifiedAt: user.emailVerifiedAt ?? null }),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: String(payload.role ?? "MEMBER"),
      /* Absent on an older cookie, and absent means verified — see the note on
         SessionPayload. */
      verified: payload.v === undefined ? true : payload.v === true,
    };
  } catch {
    return null;
  }
}

/** Full user row for the signed-in visitor, or null. */
export async function currentUser(): Promise<User | null> {
  const session = await readSession();
  if (!session) return null;
  const row = await db.query.users.findFirst({
    where: eq(users.id, session.sub),
  });
  if (!row) return null;
  /**
   * An erased account is nobody, including to itself.
   *
   * The session cookie is a signed token with a thirty-day life and no way to
   * recall it, so a member who was signed in when the desk erased them would
   * otherwise carry on browsing an account that no longer has a person attached
   * to it. Treated here as simply not signed in — which is the truth: the row
   * survives for the studio's accounts, and there is nobody left to be.
   *
   * The desk reads members through lib/reception.ts and is unaffected.
   */
  if (row.erasedAt) return null;
  return row;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  return user;
}

/**
 * Signed in, and the address proved.
 *
 * The studio's own accounts are exempt. They are created at a keyboard by
 * somebody who is already standing there — `npm run staff` on the studio's own
 * machine, or the seed — and there is no inbox in that story to send a code to.
 * Making the owner verify an address in order to reach the console that would
 * tell them the code never arrived is a locked door with the key inside.
 */
export async function requireVerified(): Promise<User> {
  const user = await requireUser();
  if (!isVerified(user)) throw new AuthError("UNVERIFIED");
  return user;
}

/** Has this account's email been confirmed — or is it the studio's own? */
export function isVerified(
  user: { role: string; emailVerifiedAt: Date | null } | null | undefined,
) {
  if (!user) return false;
  if (isStaff(user)) return true;
  return Boolean(user.emailVerifiedAt);
}

export async function requireStaff(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "STAFF" && user.role !== "ADMIN") {
    throw new AuthError("FORBIDDEN");
  }
  return user;
}

/* ------------------------------------------------------- the desk's own lock */

export async function unlockDesk(user: { id: string; role: string }) {
  const token = await new SignJWT({ role: user.role, scope: "desk" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_IDLE_SECONDS}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_IDLE_SECONDS,
  });
}

export async function lockDesk() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}

/** True when this browser has unlocked the desk recently, as this same user. */
export async function deskUnlocked(userId: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.sub === userId && payload.scope === "desk";
  } catch {
    return false;
  }
}

/**
 * Push the idle window out again, because somebody just did something.
 *
 * This is what makes fifteen minutes bearable: the window measures idleness, and
 * every desk action is proof of the opposite. Called from `requireDesk`, so
 * every guarded route slides it without any route having to remember to.
 *
 * Deliberately silent about its own failure. A cookie that cannot be re-issued
 * means the desk locks a few minutes earlier than it might have, which is a
 * mild inconvenience; throwing here would turn it into a failed action on a
 * screen somebody is working on.
 *
 * The one place it cannot run is a page render — Next refuses to set a cookie
 * during one, which is why /admin checks `deskUnlocked` and the routes call
 * this. In practice the console's panels call an API within a second of loading,
 * so the difference never shows.
 */
async function touchDesk(user: { id: string; role: string }) {
  try {
    const jar = await cookies();
    const token = jar.get(ADMIN_COOKIE)?.value;
    if (!token) return;

    const { payload } = await jwtVerify(token, secret());
    const left = (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
    if (left > ADMIN_REFRESH_BELOW_SECONDS) return;

    await unlockDesk(user);
  } catch {
    /* Nothing worth failing an action over. See above. */
  }
}

/**
 * The guard on every desk action: signed in, staff, and unlocked.
 *
 * All three, every time. The unlock is checked on the API routes and not only
 * on the page, because a page is a suggestion and an API route is the door.
 */
export async function requireDesk(): Promise<User> {
  const user = await requireStaff();
  if (!(await deskUnlocked(user.id))) throw new AuthError("LOCKED");
  /* Working is the opposite of idle, so the window starts again. */
  await touchDesk(user);
  return user;
}

/**
 * The desk, and the owner's half of it.
 *
 * Two people use this console and they are not owed the same view. Reception
 * needs to sell sessions, cancel a class and correct a phone number. What the
 * studio takes, and how many members it has, is the owner's business — and the
 * reception computer stands in a public room, which is a second reason those
 * figures are not on it. So the takings live behind this guard, not behind the
 * desk lock alone.
 */
export async function requireOwner(): Promise<User> {
  const user = await requireDesk();
  if (user.role !== "ADMIN") throw new AuthError("FORBIDDEN");
  return user;
}

export class AuthError extends Error {
  constructor(
    public code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "LOCKED"
      | "UNVERIFIED",
  ) {
    super(code);
  }
}

export function isStaff(user: { role: string } | null | undefined) {
  return user?.role === "STAFF" || user?.role === "ADMIN";
}

/** The studio's own account: the desk, plus the takings and the keys. */
export function isOwner(user: { role: string } | null | undefined) {
  return user?.role === "ADMIN";
}
