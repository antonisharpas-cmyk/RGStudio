import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { isOwner } from "@/lib/auth";
import { isDeskAccount, resetPassword } from "@/lib/reception";

/**
 * A new password for a member who cannot get in.
 *
 * The desk sets it and tells them. Blunt on purpose: with no email provider
 * wired up, a reset link would go nowhere, and somebody locked out at the
 * counter needs it fixed now. The member can change it again from their own
 * account the moment they are in.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{ userId?: string; password?: string }>(req);
  if (!data?.userId || !data.password) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

/* Reception acts for members, not for colleagues: only the owner may touch an
   account that can open this console. Otherwise the person at the counter could
   reset the owner's password and take the whole desk with it. */
  if (!isOwner(gate.user) && isDeskAccount(data.userId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const result = await resetPassword(data.userId, data.password);
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
