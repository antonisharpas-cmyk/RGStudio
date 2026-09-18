/**
 * The contract every payment provider is held to.
 *
 * Why an interface at all, rather than calling one provider's SDK from the
 * checkout page: the studio has not chosen a provider yet, and the realistic
 * candidates behave differently. Stripe hands back a client secret and the card
 * fields live in our own page. A bank gateway such as JCC hands back a URL and
 * takes the member to its own page. A third might do both. Every one of them
 * has to end in the same place — a purchase row marked PAID and sessions on the
 * member's account, exactly once.
 *
 * So the pages and the credit logic know only about this file. Swapping the
 * provider is one adapter plus a line in .env, and nothing else moves.
 */

export type ProviderId = "stripe" | "hosted" | "test";

/** Everything a provider needs to take a payment, and nothing more. */
export type PaymentRequest = {
  purchaseId: string;
  userId: string;
  email: string;
  name: string;
  /** For the provider's own records and statements. */
  packName: string;
  credits: number;
  validityDays: number;
  amountCents: number;
  /** ISO 4217, lower case, as Stripe wants it. "eur" throughout here. */
  currency: string;
  /** Where the provider should send the member when it is done. */
  returnUrl: string;
  cancelUrl: string;
};

/**
 * What the checkout page should do next.
 *
 * - `fields`   the provider's own card fields are mounted in our page. Nothing
 *              sensitive reaches our server: the browser talks to the provider
 *              directly using the one-time secret.
 * - `redirect` the member goes to the provider's page and comes back.
 * - `test`     no provider is configured. The page shows a card form that
 *              charges nothing, so the flow can be walked end to end in
 *              development. Refused in production unless deliberately allowed.
 */
export type StartedPayment =
  | {
      mode: "fields";
      provider: ProviderId;
      /** One-time secret for this payment, safe to send to the browser. */
      clientSecret: string;
      /** The provider's publishable key, also safe in the browser. */
      publicKey: string;
      /** The provider's own id for this payment. */
      ref: string;
    }
  | {
      mode: "redirect";
      provider: ProviderId;
      /** Where to send the member. Used directly for a GET gateway. */
      url: string;
      ref: string | null;
      /**
       * Some bank gateways only accept a form POST. When this is set the page
       * submits a hidden form to `action` instead of following `url` — same
       * journey for the member, and the parameters stay out of the address bar
       * and out of the referrer header.
       */
      post?: { action: string; fields: Record<string, string> };
    }
  | { mode: "test"; provider: ProviderId };

/** The answer to "did this actually get paid?", asked of the provider. */
export type Settlement =
  | { status: "PAID"; ref: string | null; amountCents: number | null }
  /** Taken, but not final yet — some cards and bank methods sit here briefly. */
  | { status: "PENDING"; ref: string | null }
  | { status: "FAILED"; ref: string | null; reason: string | null };

export type PurchaseLike = {
  id: string;
  userId: string;
  credits: number;
  amountCents: number;
  status: string;
  provider: string;
  providerRef: string | null;
  stripeIntent: string | null;
};

export interface PaymentProvider {
  readonly id: ProviderId;
  /** Shown to the member when the provider is named in the interface. */
  readonly label: string;
  /** True once real credentials are present. */
  configured(): boolean;
  /** Begin a payment. Never grants anything by itself. */
  start(req: PaymentRequest): Promise<StartedPayment>;
  /**
   * Ask the provider what happened. This is the only trusted answer — the
   * browser saying "it worked" is never enough, because the browser is not
   * where the money is.
   */
  settle(purchase: PurchaseLike): Promise<Settlement>;
  /**
   * A link to the provider's own receipt for a payment that has gone through.
   *
   * Optional, because not every provider has one. Stripe builds and hosts a
   * receipt page for every charge — amount, date, last four digits, the
   * studio's name, printable — and that page is the only document in this
   * system a member can hand to somebody else as proof of what they paid. A
   * bank gateway may offer nothing of the kind, and a cash sale at the desk
   * certainly does not.
   *
   * Returns null rather than throwing when there is no receipt to give. The
   * caller is in the middle of confirming a payment that has already succeeded,
   * and a missing link is a slightly plainer email, not a failure.
   */
  receipt?(purchase: PurchaseLike): Promise<string | null>;
}
