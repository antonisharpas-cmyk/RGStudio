import type {
  PaymentProvider,
  PaymentRequest,
  PurchaseLike,
  Settlement,
  StartedPayment,
} from "./types";

/**
 * No provider configured yet: the checkout page shows a card form that charges
 * nothing.
 *
 * This exists so the studio can walk the whole journey today — pick a pack,
 * fill in a card, land on the success page, watch the sessions appear and the
 * count in the header change — before any provider has been chosen. It is the
 * same route, the same page, the same fulfilment path; only the adapter is
 * different. When the real credentials arrive this stops being selected and
 * nothing else changes.
 *
 * Two safeguards. It refuses to run in production unless somebody explicitly
 * sets ALLOW_TEST_PAYMENTS=true, and the card details typed into it are never
 * sent anywhere: the page checks them in the browser and posts only the
 * purchase id. There is no card data on this server, in test mode or otherwise.
 */
export const testProvider: PaymentProvider = {
  id: "test",
  label: "Test mode",

  /**
   * The one combination that must never happen is this free adapter taking a
   * member's press of Pay on a site that also holds a live Stripe key — a real
   * shop handing out sessions for nothing. `NODE_ENV` is the usual guard, but it
   * is a value the hosting panel sets and a value a hosting panel can get wrong,
   * so it is not the thing to stake real money on. A live secret key
   * (`sk_live_...`) present in the environment is unambiguous: it only exists on
   * the real thing. So whatever else is set — `ALLOW_TEST_PAYMENTS=true` left on
   * by accident, `NODE_ENV` not exactly "production" — the test adapter refuses
   * the moment a live key is in the room. In development there is no live key and
   * nothing below changes.
   */
  configured: () => {
    if (process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_")) {
      return false;
    }
    return (
      process.env.ALLOW_TEST_PAYMENTS === "true" ||
      process.env.NODE_ENV !== "production"
    );
  },

  async start(_req: PaymentRequest): Promise<StartedPayment> {
    return { mode: "test", provider: "test" };
  },

  /* Reaching settlement at all means the member pressed pay on a form that
     cannot take money. There is nothing to ask anybody about, so it is paid. */
  async settle(purchase: PurchaseLike): Promise<Settlement> {
    return {
      status: "PAID",
      ref: `test_${purchase.id.slice(0, 12)}`,
      amountCents: purchase.amountCents,
    };
  },
};
