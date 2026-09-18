import type {
  PaymentProvider,
  PaymentRequest,
  PurchaseLike,
  Settlement,
  StartedPayment,
} from "./types";
import { getStripe, stripeConfigured } from "@/lib/stripe";

/**
 * Stripe, with the card fields inside our own page.
 *
 * This is a Payment Intent rather than a Checkout Session, and the difference
 * is the whole point: a Checkout Session sends the member to a page at
 * stripe.com, while an intent hands back a one-time secret that the Payment
 * Element uses to talk to Stripe directly from the browser. The card number
 * never touches this server, so the studio stays out of PCI scope, and the
 * member never leaves rgpilates.
 *
 * Payment methods are card, Apple Pay and Google Pay. The last two are not
 * separate methods to Stripe — they are cards presented by a wallet — so asking
 * for `card` is what enables all three, and excludes everything else.
 *
 * The one exception is 3-D Secure. When the bank wants the member to confirm,
 * Stripe takes over the screen for a moment and then returns to `returnUrl`.
 * That is the bank's requirement, not a design choice, and it is the same for
 * every provider.
 */
export const stripeProvider: PaymentProvider = {
  id: "stripe",
  label: "Stripe",

  configured: () => stripeConfigured() && Boolean(publishableKey()),

  async start(req: PaymentRequest): Promise<StartedPayment> {
    const stripe = getStripe();
    if (!stripe) throw new Error("STRIPE_NOT_CONFIGURED");

    const intent = await stripe.paymentIntents.create({
      amount: req.amountCents,
      currency: req.currency,
      /**
       * Card only — which is also how Apple Pay and Google Pay arrive.
       *
       * Both wallets are the `card` type wearing a different coat: they hand
       * Stripe a card token, so naming `card` gets all three and nothing else.
       * The alternative, `automatic_payment_methods`, shows whatever happens to
       * be switched on in the Stripe dashboard — Klarna, Link, iDEAL, Revolut
       * Pay — which is a studio discovering it has offered somebody credit
       * because a checkbox was ticked in a web console. This list is the studio's
       * decision and it lives in the repository where it can be reviewed.
       */
      payment_method_types: ["card"],
      /**
       * Stripe's own receipt is deliberately not requested any more.
       *
       * `receipt_email` here is what made Stripe email its own receipt to the
       * member on every payment. The studio now sends its own: a proper VAT
       * invoice as a PDF, attached to the purchase confirmation (see
       * notifyPurchased / invoice-for.ts). Two receipts for one payment is one
       * too many, and the studio's own is the one that is a valid Cyprus invoice,
       * so this is left off and the "Successful payments" email is turned off in
       * the Stripe dashboard to match.
       *
       * Note this depends on the INVOICE_* configuration being real: the PDF is
       * only sent for a numbered, non-specimen invoice. Until that config is set,
       * removing this leaves a gap with no receipt at all, so the studio's own
       * invoice must be live before this goes to production.
       *
       * The Stripe receipt *URL* still exists on the charge regardless (see
       * `receipt` below) — this only stops Stripe emailing it.
       */
      description: `RG Pilates Studio: ${req.packName}`,
      statement_descriptor_suffix: "RG PILATES STUDIO",
      metadata: {
        purchaseId: req.purchaseId,
        userId: req.userId,
        credits: String(req.credits),
        validityDays: String(req.validityDays),
        packName: req.packName,
      },
    });

    if (!intent.client_secret) throw new Error("STRIPE_NO_CLIENT_SECRET");

    return {
      mode: "fields",
      provider: "stripe",
      clientSecret: intent.client_secret,
      publicKey: publishableKey()!,
      ref: intent.id,
    };
  },

  /**
   * Stripe's hosted receipt for this payment.
   *
   * The receipt belongs to the *charge*, not to the intent, and the intent only
   * carries the charge's id — so this expands it in one call rather than making
   * two. Everything about it is Stripe's: they build the page, they host it,
   * and it stays valid, which is why the studio stores the address instead of
   * trying to render a receipt of its own.
   *
   * Never throws. It is called while confirming a payment that has already
   * succeeded and the sessions are already granted; a failure here means the
   * confirmation email has no receipt line in it, which is not worth turning
   * into an error anybody sees.
   */
  async receipt(purchase: PurchaseLike): Promise<string | null> {
    const stripe = getStripe();
    const ref = purchase.providerRef ?? purchase.stripeIntent;
    if (!stripe || !ref) return null;

    try {
      const intent = await stripe.paymentIntents.retrieve(ref, {
        expand: ["latest_charge"],
      });
      const charge = intent.latest_charge;
      /* Expanded it is the object; unexpanded, or on an intent with no charge
         yet, it is a string or null and there is nothing to link to. */
      if (!charge || typeof charge === "string") return null;
      return charge.receipt_url ?? null;
    } catch (err) {
      console.error("[pay] could not read the Stripe receipt", err);
      return null;
    }
  },

  async settle(purchase: PurchaseLike): Promise<Settlement> {
    const stripe = getStripe();
    const ref = purchase.providerRef ?? purchase.stripeIntent;
    if (!stripe || !ref) return { status: "PENDING", ref: ref ?? null };

    const intent = await stripe.paymentIntents.retrieve(ref);

    switch (intent.status) {
      case "succeeded":
        return {
          status: "PAID",
          ref: intent.id,
          amountCents: intent.amount_received || intent.amount,
        };
      /* Taken but not settled yet. Some methods sit here for hours, so the
         sessions are not granted until Stripe says succeeded. */
      case "processing":
      case "requires_capture":
      case "requires_action":
      case "requires_confirmation":
      case "requires_payment_method":
        return { status: "PENDING", ref: intent.id };
      case "canceled":
        return {
          status: "FAILED",
          ref: intent.id,
          reason: intent.cancellation_reason ?? "canceled",
        };
      default:
        return { status: "PENDING", ref: intent.id };
    }
  },
};

/** Safe in the browser; it is meant to be published. */
function publishableKey() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  return key && key.startsWith("pk_") && !/x{3,}/i.test(key) ? key : null;
}
