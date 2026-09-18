import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { notVerified } from "@/lib/api-guard";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getCreditSummary } from "@/lib/credits";
import { settleForMember } from "@/lib/payments/settle-once";

/**
 * "The card went through — did it?"
 *
 * Called by the checkout page the moment the provider's form reports success,
 * and again by the success page while it waits. It exists because the browser's
 * word is not proof of payment: the answer comes from asking the provider about
 * the payment we opened, server to server.
 *
 * The webhook does the same job unprompted and is the more reliable of the two
 * (it arrives even if the member closes the laptop). Both run through the same
 * idempotent fulfilment, so whichever gets there first grants the sessions and
 * the other is a no-op. This one exists so the member does not have to sit
 * looking at a spinner while a webhook queue catches up.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const stop = notVerified(user);
  if (stop) return stop;

  const body = (await req.json().catch(() => null)) as {
    purchaseId?: string;
  } | null;
  const purchaseId = body?.purchaseId;
  if (!purchaseId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();

  /* Somebody else's purchase is none of this member's business, and answering
     "not found" rather than "not yours" gives away nothing about what exists. */
  if (!purchase || purchase.userId !== user.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (purchase.status === "PAID") {
    return NextResponse.json({
      status: "PAID",
      credits: (await getCreditSummary(user.id)).available,
    });
  }

  if (purchase.status === "REFUNDED" || purchase.status === "FAILED") {
    return NextResponse.json({ status: purchase.status, credits: 0 });
  }

  const { status } = await settleForMember(user.id, purchase.id);

  if (status === "PAID") {
    return NextResponse.json({
      status: "PAID",
      credits: (await getCreditSummary(user.id)).available,
    });
  }

  /* PENDING or FAILED, as the provider reported it. */
  return NextResponse.json({ status });
}
