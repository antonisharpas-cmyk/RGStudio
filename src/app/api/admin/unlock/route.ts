import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  currentUser,
  isStaff,
  unlockDesk,
  verifyPassword,
} from "@/lib/auth";
import { body } from "@/lib/api-guard";

/**
 * The way in to the desk console.
 *
 * Two shapes, one route. With an email it is a sign-in: the credentials are
 * checked, the site session is created and the desk is unlocked in one go, so
 * typing /admin and typing a password is the whole journey. With only a
 * password it is a re-unlock for somebody already signed in as staff, which is
 * what the idle lock asks for when it lapses.
 *
 * Only STAFF and ADMIN get through, and a member's correct password gets the
 * same answer as a wrong one: this route never confirms that an account exists,
 * because /admin is a door that should tell a stranger nothing at all.
 *
 * A failed attempt waits a second. That turns "try every password in a list"
 * from minutes into weeks, and nobody typing their own password notices.
 */
export const dynamic = "force-dynamic";

const NO = () =>
  NextResponse.json({ error: "WRONG_PASSWORD" }, { status: 401 });

export async function POST(req: Request) {
  const data = await body<{ email?: string; password?: string }>(req);
  const password = data?.password ?? "";
  const email = data?.email?.trim().toLowerCase();

  if (!password) return NO();

  /* Signing in and unlocking at once. */
  if (email) {
    const account = db.select().from(users).where(eq(users.email, email)).get();

    if (
      !account ||
      !isStaff(account) ||
      !(await verifyPassword(password, account.passwordHash))
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      return NO();
    }

    await createSession(account);
    await unlockDesk(account);
    return NextResponse.json({
      ok: true,
      name: account.name,
      role: account.role,
    });
  }

  /* Already signed in as staff; the lock simply lapsed. */
  const user = await currentUser();
  if (!user || !isStaff(user)) return NO();

  if (!(await verifyPassword(password, user.passwordHash))) {
    await new Promise((r) => setTimeout(r, 1000));
    return NO();
  }

  await unlockDesk(user);
  return NextResponse.json({ ok: true, name: user.name, role: user.role });
}
