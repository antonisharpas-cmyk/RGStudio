"use client";

import { Faq } from "@/components/marketing/Faq";
import { PricingGrid, type PackageCard } from "@/components/marketing/PricingGrid";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHead } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * There used to be a "Find your level" section here, and it is gone.
 *
 * It showed six class types on cards with levels and intensities. The studio
 * teaches one class, Reformer Flow, so the section was asking a visitor to
 * choose between distinctions the room does not make, and the honest version of
 * it is one line in the timetable. Removing it also shortens the home page by a
 * full screen, which the page needed more than it needed the grid.
 */

export function PricingPreview({
  packages,
  signedIn,
}: {
  packages: PackageCard[];
  signedIn: boolean;
}) {
  const { t } = useI18n();
  return (
    <Section tone="sand">
      <div className="container-x">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <SectionHead
            eyebrow={t.home.pricing.eyebrow}
            title={t.home.pricing.title}
            body={t.home.pricing.body}
          />
          <Reveal delay={0.1}>
            <ButtonLink href="/pricing" variant="outline">
              {t.home.pricing.cta}
            </ButtonLink>
          </Reveal>
        </div>
        <div className="mt-16">
          <PricingGrid
            packages={packages}
            signedIn={signedIn}
            showIncludes={false}
          />
        </div>
      </div>
    </Section>
  );
}

export function FaqSection() {
  const { t } = useI18n();
  return (
    <Section>
      <div className="container-x grid gap-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
        <SectionHead eyebrow={t.home.faq.eyebrow} title={t.home.faq.title} />
        <Faq />
      </div>
    </Section>
  );
}
