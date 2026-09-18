import { NextResponse } from "next/server";
import { desk } from "@/lib/api-guard";
import { isOwner } from "@/lib/auth";
import { isDeskAccount, sellSessions } from "@/lib/reception";
import { grantSchema } from "@/lib/validation";

/**
 * Kept for anything already calling it, and now a thin wrapper.
 *
 * There used to be two ways to change a member's balance — this route and the
 * desk console — with their own ledger notes and their own idea of which batch
 * to take from. Two ways to do one thing is one way too many when the thing is
 * somebody's money, so this hands over to the same function the console uses.
 *
 * New code should call /api/admin/sessions.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const parsed = grantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const { userId, credits, validityDays, note } = parsed.data;

/* Reception acts for members, not for colleagues: only the owner may touch an
   account that can open this console. Otherwise the person at the counter could
   reset the owner's password and take the whole desk with it. */
  if (!isOwner(gate.user) && isDeskAccount(userId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const result = await sellSessions({
    userId,
    credits,
    validityDays,
    method: "adjustment",
    note,
    staffId: gate.user.id,
    staffName: gate.user.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  return NextResponse.json({ ok: true, credits: result.balance });
}
