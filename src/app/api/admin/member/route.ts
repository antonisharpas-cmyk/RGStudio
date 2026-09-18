import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { isOwner } from "@/lib/auth";
import { isDeskAccount, updateContact } from "@/lib/reception";

/**
 * The details a member cannot change themselves: their email, their phone, and
 * which channels the studio may use to reach them.
 *
 * Email and phone are deliberately out of the member's own hands — they are how
 * the studio identifies and contacts them — which means somebody has to be able
 * to correct a typo, and that somebody is the desk.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{
    userId?: string;
    email?: string;
    phone?: string;
    notifyEmail?: boolean;
    notifySms?: boolean;
    notifyPush?: boolean;
    marketingOptIn?: boolean;
    isTest?: boolean;
    pilatesLevel?: string;
    pilatesSince?: string;
    healthCondition?: string;
    /* The desk's own note about a member. Any desk account may write it, the
       same as the health answers beside it — the studio's instruction was that
       reception keeps these, not only the owner. */
    notes?: string;
  }>(req);

  if (!data?.userId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

/* Reception acts for members, not for colleagues: only the owner may touch an
   account that can open this console. Otherwise the person at the counter could
   reset the owner's password and take the whole desk with it. */
  if (!isOwner(gate.user) && isDeskAccount(data.userId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const { userId, ...patch } = data;
  const result = await updateContact(userId, patch);

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  return NextResponse.json(result);
}
