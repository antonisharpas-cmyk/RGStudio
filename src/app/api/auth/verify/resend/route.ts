import { NextResponse } from "next/server";
import { member } from "@/lib/api-guard";
import { sendVerificationCode } from "@/lib/messaging/events";
import { OTP_TTL_MINUTES, resendCode } from "@/lib/verify";

/**
 * "Send it again."
 *
 * The limits live in lib/verify.ts rather than here, because they are a rule
 * about the account and not about this route: a cooldown enforced only in the
 * handler is a cooldown that disappears the moment somebody adds a second way to
 * ask for a code.
 *
 * A refusal is not an error the member has caused, so each one comes back with
 * the number the screen needs to explain itself — how many seconds to wait, or
 * how many minutes until the hourly allowance resets. "Try again later" with no
 * later in it is the most annoying message a form can give.
 */
export async function POST() {
  const gate = await member();
  if ("res" in gate) return gate.res;

  if (gate.user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, already: true });
  }

  const result = resendCode(gate.user.id);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.code,
        ...(result.code === "TOO_SOON"
          ? { secondsLeft: result.secondsLeft }
          : {}),
        ...(result.code === "LIMIT" ? { minutesLeft: result.minutesLeft } : {}),
      },
      { status: 429 },
    );
  }

  const res = await sendVerificationCode(
    gate.user.email,
    result.challenge.code,
    OTP_TTL_MINUTES,
    gate.user.id,
  ).catch((e) => {
    console.error("[verify] resend threw for", gate.user.email, e);
    return { ok: false as const, error: "THREW" };
  });

  /* A send that failed has still spent one of the five, deliberately: the reason
     it failed is usually the address, and letting somebody retry a bad address
     without limit is exactly what the limit is for. */
  if (!res.ok) {
    return NextResponse.json({ error: "SEND_FAILED" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
