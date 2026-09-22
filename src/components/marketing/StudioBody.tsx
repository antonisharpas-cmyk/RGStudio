"use client";

import Image from "next/image";
import { Equipment } from "@/components/home/HomeSections";
import { ButtonLink } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Section, SectionHead } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";
import { STUDIO } from "@/lib/studio";

export type TeamMember = {
  id: string;
  name: string;
  bioEn: string;
  bioEl: string;
  bioRu: string;
  photoUrl: string | null;
};

/**
 * The studio page, and now the only page that introduces the people.
 *
 * The team cards used to live on a Classes page alongside a grid of six class
 * types. Both are gone: the studio teaches one class, so a page whose job was to
 * tell six of them apart was answering a question nobody had, and the
 * instructors were the only thing on it worth keeping. They belong here anyway —
 * somebody reading about the room is already reading about who is in it — and
 * they sit directly after the equipment section, so the page runs equipment, then people,
 * then what the studio holds itself to.
 */
export function StudioBody({ team = [] }: { team?: TeamMember[] }) {
  const { t, locale } = useI18n();
  const el = locale === "el";

  return (
    <>
      <Section className="pt-12 md:pt-16">
        <div className="container-x">
          <SectionHead
            eyebrow={t.studio.hero.eyebrow}
            title={t.studio.hero.title}
            body={t.studio.hero.body}
          />

          <Reveal delay={0.15} className="mt-16">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="relative aspect-[4/5] overflow-hidden rounded-3xl sm:col-span-2">
                <Image
                  src="/media/reformer.jpg"
                  alt="The reformers at RG Pilates Studio"
                  fill
                  sizes="(max-width: 640px) 100vw, 60vw"
                  className="object-cover"
                />
              </div>
              <div className="grid gap-4">
                <div className="relative aspect-[4/5] overflow-hidden rounded-3xl sm:aspect-auto sm:h-full">
                  <Image
                    src="/media/detail-footbar.jpg"
                    alt="A member mid movement on the reformer"
                    fill
                    sizes="(max-width: 640px) 100vw, 32vw"
                    className="object-cover"
                  />
                </div>
                <div className="relative hidden aspect-square overflow-hidden rounded-3xl sm:block">
                  <Image
                    src="/media/detail-wood.jpg"
                    alt="Detail of a class at RG Pilates Studio"
                    fill
                    sizes="32vw"
                    className="object-cover"
                  />
                </div>
              </div>
            </div>
            {/* Was written straight into the page, so "per class · minutes"
                stayed English on the Greek site. */}
            <p className="mt-6 text-center text-[10px] uppercase tracking-brand text-clay">
              {t.studio.equipmentLine
                .replace("{n}", String(STUDIO.capacity))
                .replace("{minutes}", String(STUDIO.classLengthMinutes))}
            </p>
          </Reveal>

          {/* A heading over the four points.

              Without one, the photographs simply stopped and a two-by-two grid
              of headed paragraphs began, so the reader had no idea whether they
              were still reading about the room or had moved on to something
              else. One line of eyebrow and one of title is enough to say which. */}
          <div className="mt-20">
            <SectionHead
              eyebrow={t.studio.room.eyebrow}
              title={t.studio.room.title}
              body={t.studio.room.body}
            />
          </div>

          <RevealGroup className="mt-14 grid gap-10 md:grid-cols-2">
            {t.studio.sections.map((s) => (
              <RevealItem key={s.t}>
                <div className="flex gap-6 border-t border-mocha-200/70 pt-8">
                  <Monogram className="mt-1 h-7 w-7 shrink-0 text-clay/60" />
                  <div>
                    <h3 className="text-[13px] uppercase tracking-widest">{s.t}</h3>
                    <p className="mt-3 text-sm leading-[1.9] text-mocha-500">{s.d}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </Section>

      <Equipment />

      {team.length > 0 && (
        <Section>
          <div className="container-x">
            <SectionHead
              eyebrow={t.studio.team.eyebrow}
              title={t.studio.team.title}
            />
            <RevealGroup className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {team.map((m) => (
                <RevealItem key={m.id}>
                  <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-mocha-200/70 bg-cream">
                    {/* Portrait fills the top of the card; the monogram stands
                        in for anyone whose photograph is not in yet. */}
                    {m.photoUrl ? (
                      <div className="relative aspect-square w-full overflow-hidden bg-cream-200">
                        <Image
                          src={m.photoUrl}
                          alt={m.name}
                          fill
                          sizes="(min-width: 1024px) 24vw, (min-width: 640px) 45vw, 90vw"
                          quality={84}
                          className="object-cover object-[50%_28%] transition-transform duration-[1400ms] ease-out hover:scale-[1.04]"
                        />
                      </div>
                    ) : (
                      <div className="grid aspect-square w-full place-items-center bg-cream-200">
                        <Monogram className="h-10 w-10 text-clay/40" />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-7">
                      <h3 className="h-display text-2xl">{m.name}</h3>
                      <p className="mt-3 text-sm leading-relaxed text-mocha-500">
                        {locale === "ru" && m.bioRu ? m.bioRu : el && m.bioEl ? m.bioEl : m.bioEn}
                      </p>
                      {/* Sits in the bottom corner, pushed down by mt-auto so
                          it lands on the same line across the row however long
                          each bio runs. */}
                      <div className="mt-auto flex justify-end pt-6">
                        <Monogram className="h-7 w-7 text-clay/40" />
                      </div>
                    </div>
                  </article>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </Section>
      )}

      <Section tone="sand">
        <div className="container-x">
          <SectionHead
            eyebrow={t.studio.values.eyebrow}
            title={t.studio.values.title}
            align="center"
          />
          <RevealGroup className="mt-14 grid gap-6 md:grid-cols-3">
            {t.studio.values.items.map((v) => (
              <RevealItem key={v.t}>
                <div className="h-full rounded-3xl border border-mocha-200/70 bg-cream p-10 text-center">
                  <h3 className="h-display text-3xl">{v.t}</h3>
                  <p className="mt-4 text-sm text-mocha-500">{v.d}</p>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>

          <Reveal delay={0.1}>
            <div className="mt-14 flex flex-wrap items-center justify-center gap-4">
              <ButtonLink href="/timetable">{t.nav.book}</ButtonLink>
              <ButtonLink href="/contact" variant="outline">
                {t.nav.contact}
              </ButtonLink>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
