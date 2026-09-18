import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { isOwner } from "@/lib/auth";
import { notifySubscriptionPaid } from "@/lib/messaging/events";
import { isDeskAccount } from "@/lib/reception";
import {
  cancelSubscription,
  currentSubscription,
  paySubscriptionAtDesk,
  startSubscriptionAtDesk,
  subscriptionById,
  type DeskMethod,
} from "@/lib/subscriptions";

/**
 * A member's monthly plan, from the desk.
 *
 * GET ?userId=     the plan as it stands
 * POST action=start   open a plan with the first month paid here (cash or card)
 * POST action=pay     record another month paid here
 * POST action=cancel  end the plan (owner only)
 *
 * Any desk account can start a plan and take a month's money, exactly as it
 * sells a pack. Ending somebody's plan is the owner's call.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  return NextResponse.json({ plan: currentSubscription(userId) });
}

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{
    action?: "start" | "pay" | "cancel";
    userId?: string;
    subscriptionId?: string;
    months?: number;
    perWeek?: number;
    method?: DeskMethod;
  }>(req);
  if (!data?.action) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  const method: DeskMethod = data.method === "card_at_desk" ? "card_at_desk" : "cash";

  if (data.action === "start") {
    if (!data.userId) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    if (!isOwner(gate.user) && isDeskAccount(data.userId)) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    const result = startSubscriptionAtDesk({
      userId: data.userId,
      months: Number(data.months),
      perWeek: Number(data.perWeek),
      method,
      staffId: gate.user.id,
      staffName: gate.user.name,
    });
    if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 });
    void notifySubscriptionPaid(result.subscription.id, result.purchaseId).catch(() => {});
    return NextResponse.json({ ok: true, plan: currentSubscription(data.userId) });
  }

  if (!data.subscriptionId) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  const sub = subscriptionById(data.subscriptionId);
  if (!sub) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (data.action === "pay") {
    const result = paySubscriptionAtDesk({
      subscriptionId: sub.id,
      method,
      staffId: gate.user.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 });
    void notifySubscriptionPaid(sub.id, result.purchaseId).catch(() => {});
    return NextResponse.json({ ok: true, plan: currentSubscription(sub.userId) });
  }

  if (data.action === "cancel") {
    if (!isOwner(gate.user)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    cancelSubscription(sub.id);
    return NextResponse.json({ ok: true, plan: currentSubscription(sub.userId) });
  }

  return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
}
