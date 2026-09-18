"use client";

import { ButtonLink } from "@/components/ui/Button";
import { Faq } from "@/components/marketing/Faq";
import { Monogram } from "@/components/ui/Monogram";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * The questions page.
 *
 * Wider than the home-page version — one column instead of two — because here
 * the questions are the whole point rather than a closing section, and a reader
 * who arrived deliberately is going to open several of them.
 *
 * Ends with a way out. Somebody who read six answers and did not find theirs
 * needs a person, and the worst end to a FAQ is a full stop.
 */
export function FaqPageBody() {
  const { t } = useI18n();

  return (
    <Section className="pt-12 md:pt-16">
      <div className="container-x">
        <Reveal className="max-w-2xl">
          <p className="eyebrow mb-4">{t.home.faq.eyebrow}</p>
          <h1 className="h-display text-[2.6rem] leading-[1.05] sm:text-5xl">
            {t.home.faq.title}
          </h1>
        </Reveal>

        <Reveal delay={0.08} className="mt-12 max-w-3xl">
          <Faq />
        </Reveal>

        <Reveal
          delay={0.12}
          className="mt-16 flex flex-wrap items-center gap-6 rounded-3xl border border-mocha-200/70 bg-cream-200/60 px-8 py-7"
        >
          <Monogram className="h-9 w-9 shrink-0 text-clay/70" />
          <p className="flex-1 text-[15px] text-mocha-600">
            {t.faqPage.stillStuck}
          </p>
          <ButtonLink href="/contact" size="sm">
            {t.home.cta.secondary}
          </ButtonLink>
        </Reveal>
      </div>
    </Section>
  );
}
