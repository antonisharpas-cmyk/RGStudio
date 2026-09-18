import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { notVerified } from "@/lib/api-guard";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getPackageById, getPackageBySlug } from "@/lib/catalogue";
import { activeProvider } from "@/lib/payments";
import { siteUrl } from "@/lib/stripe";
import { checkoutSchema } from "@/lib/validation";
import { checkPromo } from "@/lib/promo-codes";
import {
  createPendingSubscription,
  planQuote,
  subscriptionById,
} from "@/lib/subscriptions";

/**
 * Opens a payment for one pack.
 *
 * The order of events matters. The purchase row is written *before* the
 * provider is called, with status PENDING, because its id is the reference the
 * provider carries and hands back. A payment we cannot match to a purchase is
 * a member charged with nothing to show for it, which is the one outcome this
 * whole design exists to prevent.
 *
 * Nothing here grants sessions. That happens once, in fulfilPurchase, after the
 * provider confirms — see src/lib/payments/fulfil.ts.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const stop = notVerified(user);
  if (stop) return stop;

  const parsed = checkoutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  /**
   * What is being paid for: a pack, the first month of a plan, or another
   * month of a plan the member already has. All three end in one purchase row
   * and one call to the provider; they differ in what fulfilment does with the
   * money. See lib/payments/fulfil.ts and lib/subscriptions.ts.
   */
  let line: {
    packageId: string | null;
    nameEn: string;
    credits: number;
    validityDays: number;
    priceCents: number;
    subscriptionId: string | null;
    /* A code may discount a pack or a plan's first month, never a renewal:
       the renewal price is the plan's own, fixed when it started. */
    codeAllowed: boolean;
    promoPackId: string | null;
  };

  if (parsed.data.subscriptionId) {
    const sub = subscriptionById(parsed.data.subscriptionId);
    if (!sub || sub.userId !== user.id) {
      return NextResponse.json({ error: "PACKAGE_NOT_FOUND" }, { status: 404 });
    }
    if (sub.status === "CANCELLED" || sub.status === "COMPLETED" || sub.monthsPaid >= sub.months) {
      return NextResponse.json({ error: "PLAN_NOT_PAYABLE" }, { status: 400 });
    }
    line = {
      packageId: null,
      nameEn: `Monthly plan, month ${sub.monthsPaid + 1} of ${sub.months}`,
      credits: 0,
      validityDays: 30,
      priceCents: sub.monthlyPriceCents,
      subscriptionId: sub.id,
      codeAllowed: false,
      promoPackId: null,
    };
  } else if (parsed.data.plan) {
    const quote = planQuote(parsed.data.plan.months, parsed.data.plan.perWeek);
    if (!quote) return NextResponse.json({ error: "PACKAGE_NOT_FOUND" }, { status: 404 });
    const started = createPendingSubscription({
      userId: user.id,
      months: quote.months,
      perWeek: quote.perWeek,
    });
    if (!started.ok) {
      return NextResponse.json({ error: started.code }, { status: 400 });
    }
    line = {
      packageId: quote.packId,
      nameEn: `Monthly plan, ${quote.months} months, ${quote.perWeek} a week`,
      credits: quote.totalCredits,
      validityDays: quote.months * 31,
      priceCents: quote.monthlyPriceCents,
      subscriptionId: started.subscription.id,
      codeAllowed: true,
      promoPackId: quote.packId,
    };
  } else {
    const pkg = parsed.data.packageId
      ? await getPackageById(parsed.data.packageId)
      : await getPackageBySlug(parsed.data.packSlug!);
    if (!pkg || !pkg.active) {
      return NextResponse.json({ error: "PACKAGE_NOT_FOUND" }, { status: 404 });
    }
    line = {
      packageId: pkg.id,
      nameEn: pkg.nameEn,
      credits: pkg.credits,
      validityDays: pkg.validityDays,
      priceCents: pkg.priceCents,
      subscriptionId: null,
      codeAllowed: true,
      promoPackId: pkg.id,
    };
  }

  /* A promo code, if one was typed. Refused outright rather than silently
     ignored: a member who typed a code and paid full price has a complaint,
     and one who is told before paying has a choice. */
  let amountCents = line.priceCents;
  let promo: { code: string; discountCents: number } | null = null;
  if (parsed.data.code) {
    const check = line.codeAllowed
      ? checkPromo(parsed.data.code, { id: line.promoPackId ?? "", priceCents: line.priceCents })
      : ({ ok: false } as const);
    if (!check.ok) {
      return NextResponse.json({ error: "PROMO_INVALID" }, { status: 400 });
    }
    amountCents = check.amountCents;
    promo = { code: check.code.code, discountCents: check.discountCents };
  }

  let provider;
  try {
    provider = activeProvider();
  } catch (err) {
    console.error("[pay] no usable provider", err);
    return NextResponse.json(
      { error: "PAYMENTS_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const purchase = db
    .insert(purchases)
    .values({
      userId: user.id,
      packageId: line.packageId,
      credits: line.credits,
      amountCents,
      currency: "eur",
      status: "PENDING",
      provider: provider.id,
      promoCode: promo?.code ?? null,
      promoDiscountCents: promo?.discountCents ?? null,
      subscriptionId: line.subscriptionId,
    })
    .returning()
    .get();

  try {
    const started = await provider.start({
      purchaseId: purchase.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      packName: line.nameEn,
      credits: line.credits,
      validityDays: line.validityDays,
      amountCents,
      currency: "eur",
      /* Both come back to our own pages, and both carry the purchase id so the
         result can be checked with the provider rather than trusted. */
      returnUrl: `${siteUrl()}/checkout/success?p=${purchase.id}`,
      cancelUrl: `${siteUrl()}/checkout/cancelled?p=${purchase.id}`,
    });

    if (started.mode === "fields") {
      db.update(purchases)
        .set({
          providerRef: started.ref,
          stripeIntent: started.provider === "stripe" ? started.ref : null,
        })
        .where(eq(purchases.id, purchase.id))
        .run();
    }

    return NextResponse.json({
      purchaseId: purchase.id,
      ...started,
      /* What is actually being charged, so the page can show the code's effect
         with the same number the provider was given. */
      amountCents,
      listCents: line.priceCents,
      promo,
    });
  } catch (err) {
    console.error("[pay] could not open a payment", err);
    db.update(purchases)
      .set({ status: "FAILED" })
      .where(eq(purchases.id, purchase.id))
      .run();
    return NextResponse.json(
      { error: "PAYMENT_PROVIDER_ERROR" },
      { status: 502 },
    );
  }
}
