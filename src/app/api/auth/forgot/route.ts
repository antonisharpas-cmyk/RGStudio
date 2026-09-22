import { NextResponse } from "next/server";
import { sendPasswordReset } from "@/lib/messaging/events";
import { RESET_TTL_MINUTES, requestReset } from "@/lib/password-reset";
import { clientIp, hit, tooMany } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/stripe";

/**
 * "Forgot your password?"
 *
 * Five requests a quarter hour from one address. Every request costs an email,
 * and an address that can be made to send unlimited email is a nuisance to
 * whoever is on the receiving end and a black mark against the studio's
 * mailbox with Google.
 */
const LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const gate = hit("forgot", clientIp(req), LIMIT, WINDOW_MS);
  if (!gate.ok) return tooMany(gate.retryAfter);

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email.trim())) {
    return NextResponse.json({ error: "EMAIL_INVALID" }, { status: 400 });
  }

  const started = requestReset(email);
  let sent = true;
  if (started) {
    const url = `${siteUrl()}/reset?token=${started.token}`;
    const res = await sendPasswordReset(started.user.email, url, RESET_TTL_MINUTES);
    sent = res.ok;
    if (!res.ok) console.error("[reset] email failed for", started.user.email, res);
  }

  /* The same answer whether or not the address has an account. `sent` is
     only false when there IS an account and the mail could not leave, which
     the member needs to know about; for an unknown address it stays true. */
  return NextResponse.json({ ok: true, sent, minutes: RESET_TTL_MINUTES });
}
