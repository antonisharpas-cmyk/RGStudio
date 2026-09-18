import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, purchases } from "@/db/schema";
import { consumePromo } from "@/lib/promo-codes";
import { activateSubscription, recordSubscriptionPayment, subscriptionById } from "@/lib/subscriptions";
import { notifySubscriptionPaid } from "@/lib/messaging/events";
import { grantCredits } from "@/lib/credits";
import { getPackageById } from "@/lib/catalogue";
import { notifyPurchased } from "@/lib/messaging/events";
import { activeProvider } from "./active";
import { assignInvoiceNumber } from "@/lib/invoice-number";

/**
 * The one place a payment turns into sessions.
 *
 * Three different things can report the same successful payment: the provider's
 * webhook, the member's browser coming back from the card form, and a later
 * check from the account page. Each of them calls this, and it must be safe to
 * call twice a second apart from two different requests.
 *
 * How it is made safe: the purchase row is the lock. The status moves
 * PENDING -> PAID inside a transaction, and the update is conditional on the
 * row still being PENDING, so whichever caller gets there first is the one that
 * grants the batch. The others see zero rows changed and do nothing.
 *
 * (SQLite through better-sqlite3 is synchronous and single-writer, which makes
 * this airtight here. The conditional update is what carries the guarantee, so
 * it stays correct on a server with real concurrency too.)
 */
export type FulfilResult = {
  /** True only for the caller that actually granted the sessions. */
  granted: boolean;
  credits: number;
  /** The purchase as it stands after the call. */
  status: string;
};

export async function fulfilPurchase(args: {
  purchaseId: string;
  /** The provider's own reference, for the receipt trail. */
  ref?: string | null;
  /** What the provider says was taken, if it says. */
  amountCents?: number | null;
  note?: string;
}): Promise<FulfilResult> {
  const { purchaseId, ref = null, amountCents = null, note } = args;

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();

  if (!purchase) {
    console.error(`[pay] fulfil called for a purchase that is not there: ${purchaseId}`);
    return { granted: false, credits: 0, status: "MISSING" };
  }

  if (purchase.status === "PAID") {
    /* Already done. Record the reference if this caller knows it and the
       earlier one did not — a webhook often carries more than the browser. */
    if (ref && !purchase.providerRef) {
      db.update(purchases)
        .set({ providerRef: ref })
        .where(eq(purchases.id, purchase.id))
        .run();
    }
    return { granted: false, credits: purchase.credits, status: "PAID" };
  }

  /* Validity comes from the pack as it was sold. Falling back to 90 days would
     silently shorten or lengthen what the member paid for, so if the pack has
     gone from the catalogue since, the purchase row is still the record of what
     was bought and the batch is granted without an expiry rather than with a
     guessed one. */
  const pkg = purchase.packageId ? await getPackageById(purchase.packageId) : null;
  const validityDays = pkg?.validityDays ?? null;

  let granted = false;

  db.transaction(() => {
    /* The guard, and the whole reason this is safe to call twice: the update
       only claims a row that has not been paid yet, and RETURNING tells us
       whether this call is the one that claimed it. A second caller matches
       nothing and grants nothing.
     *
     * PENDING *or* FAILED, and the FAILED is the important half. A card that
     * fails once and then succeeds on retry — a wrong number, or the bank's
     * 3-D Secure step — produces a `payment_intent.payment_failed` that marks
     * the purchase FAILED, and then a `payment_intent.succeeded` a second
     * later. `succeeded` is the truth: the money was taken, so the sessions are
     * owed, whatever an earlier attempt did. Without FAILED here that member
     * paid and got nothing. It stays safe to call twice because PAID is
     * excluded, so the first success still claims it and any later caller
     * grants nothing. */
    const claimed = db
      .update(purchases)
      .set({
        status: "PAID",
        paidAt: new Date(),
        providerRef: ref ?? purchase.providerRef,
        amountCents: amountCents ?? purchase.amountCents,
      })
      .where(
        and(
          eq(purchases.id, purchase.id),
          inArray(purchases.status, ["PENDING", "FAILED"]),
        ),
      )
      .returning({ id: purchases.id })
      .all();

    if (!claimed.length) return;

    /* The code is spent now, when the money has arrived, not when the card
       form was opened. */
    if (purchase.promoCode) consumePromo(purchase.promoCode);

    /* A month of a plan buys time, not sessions: the sessions were handed over
       when the plan began (or are handed over now, if this is its first month).
       See lib/subscriptions.ts. */
    if (purchase.subscriptionId) {
      const sub = subscriptionById(purchase.subscriptionId);
      if (sub?.status === "PENDING") activateSubscription(sub.id, purchase.id);
      else if (sub) recordSubscriptionPayment(sub.id);
      granted = true;
      return;
    }

    /* Belt as well as braces: if a batch is somehow already attached to this
       purchase, granting a second one would double the member's balance. */
    const already = db
      .select({ id: creditBatches.id })
      .from(creditBatches)
      .where(eq(creditBatches.purchaseId, purchase.id))
      .all();
    if (already.length) {
      console.error(
        `[pay] purchase ${purchase.id} was PENDING but already had a credit batch — not granting again`,
      );
      return;
    }

    grantCredits({
      userId: purchase.userId,
      credits: purchase.credits,
      validityDays,
      purchaseId: purchase.id,
      reason: "PURCHASE",
      note: note ?? `${purchase.provider} ${ref ?? purchase.id}`,
      /* Read from the pack as it was sold, like the validity above it, and for
         the same reason: what these sessions can buy is part of what was paid
         for. A personal session granted as a class one would be €30 turned into
         something the member did not order. Falls back to CLASS if the pack has
         since left the catalogue, which is the behaviour every purchase before
         this had. */
      kind: pkg?.kind === "PERSONAL" || pkg?.kind === "DUET" ? pkg.kind : "CLASS",
      perDayLimit: pkg?.perDayLimit ?? null,
    });
    granted = true;
  });

  if (granted) {
    console.log(
      `[pay] ${purchase.credits} sessions granted to ${purchase.userId} for purchase ${purchase.id}`,
    );

    /**
     * The provider's receipt, fetched and stored before the member is told.
     *
     * Order matters here and it is the only reason this sits above the notify
     * call rather than below it: the confirmation email is composed from the
     * purchase row, so the link has to be on the row by the time that runs.
     * One extra API call, once per payment, on the single caller that actually
     * granted — the webhook and the browser both arrive here and only one of
     * them gets this far.
     *
     * Wrapped in its own try/catch and asked of the provider only when the
     * purchase was actually taken by that provider. A cash sale at the desk has
     * no receipt to link to, and `activeProvider()` throws outright when
     * nothing is configured — neither of which should be able to unwind a
     * payment that has already succeeded and been granted.
     */
    try {
      const provider = activeProvider();
      if (provider.id === purchase.provider && provider.receipt) {
        const url = await provider.receipt({
          ...purchase,
          providerRef: ref ?? purchase.providerRef,
        });
        if (url) {
          db.update(purchases)
            .set({ receiptUrl: url })
            .where(eq(purchases.id, purchase.id))
            .run();
        }
      }
    } catch (err) {
      console.error("[pay] no receipt link for this payment", err);
    }

    /**
     * The studio's own invoice number, for a payment taken through a provider.
     *
     * Only for those. A sale taken in cash or on the card machine at the desk
     * is handed a paper receipt over the counter, which is the studio's
     * decision — so those deliberately get no number and no PDF, and the
     * sequence stays a sequence of the payments this system actually took.
     *
     * Before the notify call, like the receipt above and for the same reason:
     * the confirmation email attaches the invoice, and it cannot attach a
     * document that has no number yet. Its own try/catch because a payment that
     * has already succeeded must not be unwound by a numbering problem — the
     * worst case is an email without its attachment, and a number that can be
     * issued later from the desk.
     */
    if (purchase.provider !== "cash" && purchase.provider !== "card_at_desk") {
      try {
        const numbered = assignInvoiceNumber(purchase.id);
        if (!numbered.ok) {
          console.log(
            `[pay] purchase ${purchase.id} has no invoice number: ${numbered.reason}`,
          );
        }
      } catch (err) {
        console.error("[pay] could not assign an invoice number", err);
      }
    }

    /* Told once, by whichever caller actually granted. The webhook, the browser
       coming back and a later check all arrive here; only one of them gets
       `granted`, which is exactly the one that should say so. Not awaited: the
       sessions are already in the balance, and a message that fails to send must
       not turn a completed payment into an error. */
    if (purchase.subscriptionId) {
      void notifySubscriptionPaid(purchase.subscriptionId, purchase.id).catch(() => {});
    } else {
      void notifyPurchased(purchase.id).catch(() => {});
    }
  }

  return { granted, credits: purchase.credits, status: "PAID" };
}

/** Marks a payment that did not go through. Never touches a paid purchase. */
export function failPurchase(purchaseId: string, reason?: string) {
  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();
  if (!purchase || purchase.status === "PAID") return;
  db.update(purchases)
    .set({ status: "FAILED" })
    .where(eq(purchases.id, purchaseId))
    .run();
  if (reason) console.log(`[pay] purchase ${purchaseId} failed: ${reason}`);
}
