import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * True only when a real key is present. The placeholder values shipped in
 * .env.example (sk_test_xxx) deliberately count as "not configured" so the app
 * falls back to the local test-payment path instead of calling Stripe with a
 * key that cannot work.
 */
export function stripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return Boolean(
    key && key.startsWith("sk_") && key.length > 24 && !/x{3,}/i.test(key),
  );
}

/** Local testing without Stripe: credits are granted straight away. */
export function testPaymentsAllowed() {
  return (
    process.env.ALLOW_TEST_PAYMENTS === "true" ||
    process.env.NODE_ENV !== "production"
  );
}

/** Returns the Stripe client, or null when keys are not configured yet. */
export function getStripe(): Stripe | null {
  if (!stripeConfigured()) return null;
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }
  return cached;
}

export function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
