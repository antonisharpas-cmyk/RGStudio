"use client";

import type { ReactNode } from "react";
import { Section, SectionHead } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";

export function TimetableIntro({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <Section className="pt-12 md:pt-16">
      <div className="container-x">
        <SectionHead
          eyebrow={t.timetablePage.eyebrow}
          title={t.timetablePage.title}
          body={t.timetablePage.body}
        />
        <div className="mt-14">{children}</div>
      </div>
    </Section>
  );
}
