import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutBody } from "@/components/checkout/CheckoutBody";
import { currentUser, isVerified } from "@/lib/auth";
import { getPackageBySlug } from "@/lib/catalogue";
import { getCreditSummary } from "@/lib/credits";
import { paymentModeSummary } from "@/lib/payments";
import { planQuote, subscriptionById } from "@/lib/subscriptions";

export const metadata: Metadata = {
  title: "Checkout",
  /* A payment page has no business in anybody's search results. */
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string; plan?: string; renew?: string }>;
}) {
  const { pack, plan, renew } = await searchParams;
  if (!pack && !plan && !renew) redirect("/pricing");

  /* Whatever was asked for, carried through sign in and verification so the
     member lands back on this exact checkout. */
  const here = pack
    ? `/checkout?pack=${pack}`
    : plan
      ? `/checkout?plan=${plan}`
      : `/checkout?renew=${renew}`;

  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(here)}`);
  /* Nobody pays for sessions on an account that has never confirmed its email:
     the receipt, and every reminder afterwards, goes to an address we have no
     reason to believe exists. */
  if (!isVerified(user)) redirect(`/verify?next=${encodeURIComponent(here)}`);

  const wallet = await getCreditSummary(user.id);
  const payment = paymentModeSummary();

  /* Another month of a plan the member already has. */
  if (renew) {
    const sub = subscriptionById(renew);
    if (
      !sub ||
      sub.userId !== user.id ||
      sub.status === "CANCELLED" ||
      sub.status === "COMPLETED" ||
      sub.monthsPaid >= sub.months
    ) {
      redirect("/account");
    }
    return (
      <CheckoutBody
        pack={{
          id: sub.id,
          slug: `renew-${sub.id}`,
          nameEn: `${sub.months} months · ${sub.perWeek} a week`,
          nameEl: `${sub.months} μήνες · ${sub.perWeek} την εβδομάδα`,
          credits: sub.totalCredits,
          priceCents: sub.monthlyPriceCents,
          validityDays: sub.months * 31,
        }}
        order={{ kind: "renew", subscriptionId: sub.id, monthNumber: sub.monthsPaid + 1, months: sub.months, perWeek: sub.perWeek }}
        member={{ name: user.name, email: user.email }}
        balance={wallet.available}
        payment={payment}
      />
    );
  }

  /* The first month of a new plan: `plan=9x2` is nine months, twice a week. */
  if (plan) {
    const m = /^(\d{1,2})x(\d)$/.exec(plan);
    const quote = m ? planQuote(Number(m[1]), Number(m[2])) : null;
    if (!quote) redirect("/pricing");
    return (
      <CheckoutBody
        pack={{
          id: quote.packId ?? "plan",
          slug: `plan-${plan}`,
          nameEn: `${quote.months} months · ${quote.perWeek} a week`,
          nameEl: `${quote.months} μήνες · ${quote.perWeek} την εβδομάδα`,
          credits: quote.totalCredits,
          priceCents: quote.monthlyPriceCents,
          validityDays: quote.months * 31,
        }}
        order={{ kind: "plan", months: quote.months, perWeek: quote.perWeek }}
        member={{ name: user.name, email: user.email }}
        balance={wallet.available}
        payment={payment}
      />
    );
  }

  const pkg = await getPackageBySlug(pack!);
  if (!pkg || !pkg.active) redirect("/pricing");

  return (
    <CheckoutBody
      pack={{
        id: pkg.id,
        slug: pkg.slug,
        nameEn: pkg.nameEn,
        nameEl: pkg.nameEl,
        credits: pkg.credits,
        priceCents: pkg.priceCents,
        validityDays: pkg.validityDays,
      }}
      order={{ kind: "pack" }}
      member={{ name: user.name, email: user.email }}
      balance={wallet.available}
      payment={payment}
    />
  );
}
