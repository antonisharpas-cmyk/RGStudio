import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, isVerified, verifyPassword } from "@/lib/auth";
import { clientIp, hit, peek, tooMany } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";

/**
 * Guessing budget for one address: ten WRONG tries a quarter hour.
 *
 * Only failures are counted. A correct password passes free, so a working
 * member is never rate-limited by signing in — and the whole budget is there for
 * the guesser, who produces nothing but failures. Counted per IP rather than per
 * email so that one address probing many accounts meets the same wall that stops
 * it hammering one, and so an attacker naming a member's address can never lock
 * that member out.
 *
 * bcrypt at cost 11 already taxes each guess about a sixth of a second; this
 * puts a ceiling on top of the tax.
 */
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * A real bcrypt hash of nothing anyone knows, compared against when the email
 * does not exist so the wrong-email and wrong-password paths take the same time.
 * Without it, a missing account returns before bcrypt runs and a present one
 * after, and that timing difference tells an attacker which addresses are
 * registered even though the error message is identical. Cost 11, matching the
 * real hashes.
 */
const DUMMY_HASH =
  "$2a$11$WeqdDG3sK0qrNTPUCqcoHOzZJpJIICJjaQ8ID2SrC5XCpz3sU/fSC";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const gate = peek("login", ip, LOGIN_LIMIT);
  if (!gate.ok) return tooMany(gate.retryAfter);

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, parsed.data.email),
  });
  /* Always spend the bcrypt time, against the real hash or the dummy one, so the
     response cannot be timed to tell a registered address from an unknown one.
     The `!user` check below is what actually refuses the unknown account. */
  const ok = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? DUMMY_HASH,
  );
  if (!user || !ok) {
    /* A wrong answer spends one from the budget; a right one never does. */
    hit("login", ip, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  await createSession(user);
  return NextResponse.json({
    ok: true,
    /**
     * Somebody signing in to an account they never confirmed.
     *
     * They are let in — the password was right, and the account is theirs — and
     * then sent to the code box rather than to the timetable. The alternative is
     * worse than a redirect: they land on a page that looks like every other
     * member's, press Book, and are refused by a rule nobody has mentioned to
     * them since the day they registered.
     */
    verify: !isVerified(user),
    user: { id: user.id, name: user.name, role: user.role },
  });
}
