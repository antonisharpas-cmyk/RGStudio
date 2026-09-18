"use client";

import { Faq } from "@/components/marketing/Faq";
import { MonthlyPlans, type PlanOffer } from "@/components/marketing/MonthlyPlans";
import { PricingGrid, type PackageCard } from "@/components/marketing/PricingGrid";
import { Section, SectionHead } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";

export function PricingPageBody({
  packages,
  plans,
  graceDays,
  signedIn,
}: {
  packages: PackageCard[];
  plans: PlanOffer[];
  graceDays: number;
  signedIn: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      <Section className="pt-12 md:pt-16">
        <div className="container-x">
          <SectionHead
            eyebrow={t.pricingPage.eyebrow}
            title={t.pricingPage.title}
            body={t.pricingPage.body}
          />
          <div className="mt-14">
            <PricingGrid packages={packages} signedIn={signedIn} />
          </div>
          <MonthlyPlans plans={plans} signedIn={signedIn} graceDays={graceDays} />
        </div>
      </Section>

      <Section tone="sand">
        <div className="container-x grid gap-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
          <SectionHead eyebrow={t.home.faq.eyebrow} title={t.home.faq.title} />
          <Faq />
        </div>
      </Section>
    </>
  );
}
