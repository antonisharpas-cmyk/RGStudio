import { NextResponse } from "next/server";
import { body, member } from "@/lib/api-guard";
import { createSession } from "@/lib/auth";
import { notifyNewMember } from "@/lib/messaging/events";
import { challengeState, checkCode } from "@/lib/verify";

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

  /* Tell the studio a real, verified account now exists. Fired and not awaited,
     like the rest of this route: a member who typed the right code is verified whatever
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
