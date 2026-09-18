import type { Metadata } from "next";
import { PricingPageBody } from "@/components/marketing/PricingPageBody";
import { readSession } from "@/lib/auth";
import { getPackages } from "@/lib/catalogue";
import { PLAN_GRACE_DAYS, planQuotes } from "@/lib/subscriptions";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Reformer Pilates credit packs at RG Pilates Studio. One session, one class. From a single class to unlimited plans, no contracts.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const [packages, session] = await Promise.all([getPackages(), readSession()]);

  const plans = planQuotes().map((q) => ({
    months: q.months,
    perWeek: q.perWeek,
    monthlyPriceCents: q.monthlyPriceCents,
    totalCredits: q.totalCredits,
  }));

  return (
    <PricingPageBody
      packages={packages}
      plans={plans}
      graceDays={PLAN_GRACE_DAYS}
      signedIn={Boolean(session)}
    />
  );
}
