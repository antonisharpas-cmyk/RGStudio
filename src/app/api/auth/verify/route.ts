import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import { body, member } from "@/lib/api-guard";
import { createSession } from "@/lib/auth";
import { grantCredits } from "@/lib/credits";
import { notifyNewMember, notifyPromoGranted } from "@/lib/messaging/events";
import { promoForJoin } from "@/lib/promo";
import { challengeState, checkCode } from "@/lib/verify";

/**
 * The opening offer, handed over the moment the address is proved.
 *
 * This is where it belongs, and the reason is the one thing registration could
 * not know: that the person typing the address can read it. Granting at
 * registration meant a session and a congratulatory email for any address
 * somebody chose to type, including one belonging to a stranger, and for the
 * accounts the housekeeping sweep deletes seven days later for never confirming.
 *
 * Three things make this safe to run inside a request:
 *
 *   - It runs once per account. `checkCode` returns `ALREADY` for an account
 *     that is verified, and that path returns before reaching here, so the
 *     transition from unverified to verified happens exactly once.
 *   - It is belt-and-braces idempotent anyway. Accounts verified before this
 *     moved already hold their batch, and the check below finds it. The
 *     condition is the batch's own spend window, which no other grant shares.
 *   - It can never fail the verification. Somebody who typed the right code is
 *     verified whatever happens to a promotional grant; a missing free session
 *     is ten seconds of the desk's time, a member locked out of their own
 *     account by a failed bonus is not.
 */
function grantJoiningPromo(user: { id: string; email: string; createdAt: Date }) {
  const promo = promoForJoin(user.createdAt);
  if (!promo) return;
  try {
    const already = db
      .select({ n: sql<number>`count(*)` })
      .from(creditBatches)
      .where(
        and(
          eq(creditBatches.userId, user.id),
          eq(creditBatches.source, "GRANT"),
          eq(creditBatches.usableFrom, promo.spendFrom),
          eq(creditBatches.usableTo, promo.spendUntil),
        ),
      )
      .get();
    if (already && already.n > 0) return;

    grantCredits({
      userId: user.id,
      credits: promo.credits,
      validityDays: null,
      expiresAt: promo.expiresAt,
      usableFrom: promo.spendFrom,
      usableTo: promo.spendUntil,
      source: "GRANT",
      reason: "ADMIN_GRANT",
      note: `${promo.name}: free session on joining`,
    });
    void notifyPromoGranted(user.id, promo).catch(() => {});
  } catch (e) {
    console.error("[promo] grant failed for", user.email, e);
  }
}

/**
 * The code, typed back.
 *
 * Guarded by `member()` and not by `verified()`, which would be a door locked
 * from the inside: this is the route that does the verifying.
 *
 * There is no `userId` in the request. The account being verified is the account
 * whose cookie arrived, which means a code cannot be typed at somebody else's
 * registration even by somebody who has it.
 */
export async function POST(req: Request) {
  const gate = await member();
  if ("res" in gate) return gate.res;

  const data = await body<{ code?: string }>(req);
  const result = checkCode(gate.user.id, String(data?.code ?? ""));

  if (!result.ok) {
    /* ALREADY is not a failure — see lib/verify.ts. Two tabs, verified in one. */
    if (result.code === "ALREADY") {
      return NextResponse.json({ ok: true, already: true });
    }
    return NextResponse.json(
      {
        error: result.code,
        ...(result.code === "WRONG"
          ? { attemptsLeft: result.attemptsLeft }
          : {}),
      },
      { status: result.code === "WRONG" ? 400 : 409 },
    );
  }

  /* The address is proved, so the offer can be honoured. Before the new cookie
     rather than after, so that a member who closes the tab the instant it
     succeeds still has it. */
  grantJoiningPromo(gate.user);

  /* Tell the studio a real, verified account now exists. Fired and not awaited,
     like the promo above: a member who typed the right code is verified whatever
     the mail server does. This is the one place the unverified-to-verified
     transition happens exactly once (ALREADY returns above), so the studio is
     emailed once per member. */
  void notifyNewMember(gate.user.id).catch(() => {});

  /**
   * A fresh cookie, now saying verified.
   *
   * The one they are holding was issued at registration and says otherwise, and
   * the middleware reads the cookie — so without this the member types the right
   * code and is bounced straight back to the code box, for thirty days.
   */
  await createSession({ ...gate.user, emailVerifiedAt: new Date() });

  return NextResponse.json({ ok: true });
}

/** What the screen needs to draw itself: the clock, the lock, the cooldown. */
export async function GET() {
  const gate = await member();
  if ("res" in gate) return gate.res;
  return NextResponse.json({
    verified: Boolean(gate.user.emailVerifiedAt),
    email: gate.user.email,
    challenge: challengeState(gate.user.id),
  });
}
