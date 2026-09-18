import { eq } from "drizzle-orm";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { activeProvider } from "./index";
import { failPurchase, fulfilPurchase } from "./fulfil";

/**
 * Check one purchase with the provider, on behalf of the member who owns it.
 *
 * Shared by the settle route and the success page. Kept in its own module
 * because a page importing an API route's internals is the kind of tangle that
 * looks fine until somebody moves a file.
 *
 * Ownership is checked here rather than trusted from the caller: this is the
 * function that can add sessions to an account, so it does not take anyone's
 * word for whose purchase it is.
 */
export async function settleForMember(
  userId: string,
  purchaseId: string,
): Promise<{ status: string }> {
  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();

  if (!purchase || purchase.userId !== userId) return { status: "NOT_FOUND" };
  /* Already settled either way — nothing to check. A PENDING *or* FAILED
     purchase is still worth asking the provider about: a card that failed once
     and then succeeded on retry leaves the row FAILED, and the provider now
     says PAID. See the note in fulfil.ts. */
  if (purchase.status === "PAID" || purchase.status === "REFUNDED") {
    return { status: purchase.status };
  }

  let settlement;
  try {
    settlement = await activeProvider().settle(purchase);
  } catch (err) {
    console.error("[pay] provider check failed", err);
    return { status: "PENDING" };
  }

  if (settlement.status === "PAID") {
    await fulfilPurchase({
      purchaseId: purchase.id,
      ref: settlement.ref,
      amountCents: settlement.amountCents,
    });
    return { status: "PAID" };
  }

  if (settlement.status === "FAILED") {
    failPurchase(purchase.id, settlement.reason ?? undefined);
    return { status: "FAILED" };
  }

  return { status: "PENDING" };
}
