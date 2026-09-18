import { hostedProvider } from "./hosted-provider";
import { stripeProvider } from "./stripe-provider";
import { testProvider } from "./test-provider";
import type { PaymentProvider, ProviderId } from "./types";

/**
 * Which provider is taking money, and nothing else.
 *
 * Its own file rather than part of index.ts, and for a dull but real reason:
 * index.ts re-exports `fulfilPurchase`, and fulfil.ts needs to ask which
 * provider is active so it can fetch that provider's receipt. Importing the
 * barrel from a module the barrel already exports is a cycle — it happens to
 * work here, because nothing is read at module-evaluation time, but "happens to
 * work" is not a property worth relying on in the file that grants people the
 * sessions they paid for.
 *
 * index.ts still re-exports both of these, so every existing import is
 * unchanged.
 */
const ALL: Record<ProviderId, PaymentProvider> = {
  stripe: stripeProvider,
  hosted: hostedProvider,
  test: testProvider,
};

/**
 * Which provider is taking payments right now.
 *
 * PAYMENT_PROVIDER in .env names one outright, which is what production should
 * do — being explicit means a missing key shows up as a loud error rather than
 * as a live site quietly handing out free sessions through the test adapter.
 *
 * Left unset it picks the first one that is actually configured, so a developer
 * cloning the repo gets a working checkout with no setup at all.
 */
export function activeProvider(): PaymentProvider {
  const named = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();

  if (named && named in ALL) {
    const chosen = ALL[named as ProviderId];
    if (!chosen.configured()) {
      throw new Error(
        `PAYMENT_PROVIDER is set to "${named}" but that provider is not configured. Check .env against docs/payments.md.`,
      );
    }
    return chosen;
  }

  for (const p of [stripeProvider, hostedProvider, testProvider]) {
    if (p.configured()) return p;
  }

  /* Not even the test provider, which means this is production with nothing
     set up. The checkout route turns this into a plain "not switched on yet"
     message rather than an error page. */
  throw new Error("PAYMENTS_NOT_CONFIGURED");
}

/** For the interface: what to tell the member before they commit. */
export function paymentModeSummary() {
  try {
    const p = activeProvider();
    return { id: p.id, label: p.label, configured: true };
  } catch {
    return { id: null, label: null, configured: false };
  }
}
