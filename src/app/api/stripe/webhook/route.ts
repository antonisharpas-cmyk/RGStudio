import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { failPurchase, fulfilPurchase } from "@/lib/payments";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe's own account of what happened, which is the version that counts.
 *
 * The card fields live in our page and the browser tells us when they succeed
 * (see /api/payments/settle), but a browser can be closed mid-payment, lose its
 * connection, or lie. This webhook arrives regardless, so it is the backstop
 * that means a member who paid always ends up with their sessions.
 *
 * Local testing:
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 * then put the printed whsec_… into STRIPE_WEBHOOK_SECRET.
 *
 * Granting is idempotent and lives in one place, so this and the browser's
 * report can both fire for the same payment with no risk of double credit.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json(
      { error: "STRIPE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "NO_SIGNATURE" }, { status: 400 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("[stripe] signature verification failed", err);
    return NextResponse.json({ error: "BAD_SIGNATURE" }, { status: 400 });
  }

  switch (event.type) {
    /* The card fields in our own page produce these. */
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      const purchaseId = intent.metadata?.purchaseId;
      if (!purchaseId) {
        console.error("[stripe] paid intent with no purchaseId", intent.id);
        break;
      }
      db.update(purchases)
        .set({ stripeIntent: intent.id })
        .where(eq(purchases.id, purchaseId))
        .run();
      await fulfilPurchase({
        purchaseId,
        ref: intent.id,
        amountCents: intent.amount_received || intent.amount,
        note: `Stripe ${intent.id}`,
      });
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      const purchaseId = intent.metadata?.purchaseId;
      if (purchaseId) {
        failPurchase(
          purchaseId,
          intent.last_payment_error?.message ?? "card declined",
        );
      }
      break;
    }

    /* Kept for any Checkout Session still in flight from the earlier
       hosted-page flow, and for Payment Links if the studio ever uses one. */
    case "checkout.session.completed": {
      const session = event.data.object;
      const purchaseId =
        session.metadata?.purchaseId ?? session.client_reference_id;
      if (!purchaseId) break;
      db.update(purchases)
        .set({
          stripeSession: session.id,
          stripeIntent:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : null,
        })
        .where(eq(purchases.id, purchaseId))
        .run();
      await fulfilPurchase({
        purchaseId,
        ref: session.id,
        amountCents: session.amount_total,
        note: `Stripe ${session.id}`,
      });
      break;
    }

    case "checkout.session.expired": {
      const session = event.data.object;
      const purchaseId =
        session.metadata?.purchaseId ?? session.client_reference_id;
      if (purchaseId) failPurchase(purchaseId, "checkout session expired");
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const intent =
        typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      if (intent) {
        /* The sessions are not clawed back automatically: a refund is a
           conversation with the studio, and the batch may already be part
           spent. The purchase is marked so the account page and the admin
           screen show the truth, and the studio adjusts the balance
           deliberately. */
        db.update(purchases)
          .set({ status: "REFUNDED" })
          .where(eq(purchases.stripeIntent, intent))
          .run();
        console.log(`[stripe] refund recorded for intent ${intent}`);
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
