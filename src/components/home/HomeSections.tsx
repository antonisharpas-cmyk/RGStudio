"use client";

import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { Parallax } from "@/components/ui/Parallax";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Section, SectionHead } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";
import { formatDayList, openingSummary } from "@/lib/rota";
import { STUDIO } from "@/lib/studio";

/* ------------------------------------------------------------------ marquee */

export function Marquee() {
  const { t } = useI18n();
  const words = [...t.home.marquee, ...t.home.marquee];

  return (
    <div className="relative overflow-hidden border-y border-mocha-200/60 bg-cream-200 py-5">
      <div className="flex w-max animate-marquee items-center gap-10 whitespace-nowrap">
        {words.map((w, i) => (
          <span key={`${w}-${i}`} className="flex items-center gap-10">
            <span className="text-[11px] uppercase tracking-brand text-clay">
              {w}
            </span>
            <Monogram className="h-4 w-4 shrink-0 text-clay/50" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- intro */

export function Intro() {
  const { t } = useI18n();

  /**
   * One row, two columns, and nothing floating in the middle of either.
   *
   * This section has been rebuilt twice and both earlier versions left a hole.
   * First the reformer shared a row with a ruled board of figures, which held a
   * photograph of the one object the whole studio is built around down to about
   * two hundred pixels. Then the arch took the full width and the figures went
   * underneath it as a caption, which fixed the picture and opened two new gaps:
   * empty cream to the left of the arch's curve, and empty cream under the
   * paragraph on the right.
   *
   * So the two halves each carry two things now. The left is the heading, the
   * way in, and the reformer directly beneath them. The right is the paragraph
   * and the three figures beneath that. Both columns run to about the same
   * depth, and there is no band of nothing anywhere in the section.
   */
  return (
    <Section className="pb-16 md:pb-24">
      <div className="container-x grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-24">
        {/* ------------------------------------------------------------ left */}
        <div>
          <Reveal>
            <p className="eyebrow mb-5">{t.home.intro.eyebrow}</p>
            <h2 className="h-display text-balance text-[2.4rem] leading-[1.08] sm:text-5xl">
              {t.home.intro.title}
            </h2>
            <ButtonLink href="/studio" variant="outline" className="mt-9">
              {t.home.intro.cta}
            </ButtonLink>
          </Reveal>

          {/* A photograph of the room, in a soft frame. The studio's own
              picture rather than a render: two members mid movement, the
              curtains lit behind them. */}
          <Reveal y={36} className="mt-8 lg:mt-10">
            <figure className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl border border-mocha-200/70 bg-cream-200">
              <Parallax strength={4} zoom={0.06}>
                <Image
                  src="/media/hero-2.jpg"
                  alt="Members on the reformers at RG Pilates Studio"
                  fill
                  sizes="(min-width: 1024px) 46vw, 92vw"
                  quality={86}
                  className="object-cover object-[50%_55%]"
                />
              </Parallax>
            </figure>
          </Reveal>
        </div>

        {/* ----------------------------------------------------------- right */}
        <div className="lg:pt-3">
          <Reveal delay={0.12}>
            <p className="text-[15px] leading-[1.9] text-mocha-500">
              {t.home.intro.body}
            </p>
          </Reveal>

          {/* The three figures, in the space under the paragraph that was
              otherwise empty. A ruled list rather than three columns: the
              labels are long, the numbers are short, and a rule between each
              pair reads as a specification instead of a graphic. */}
          <Reveal delay={0.18}>
            <dl className="mt-10 lg:mt-12">
              {[
                { v: String(STUDIO.capacity), k: t.home.hero.stat1 },
                {
                  v: `${STUDIO.classLengthMinutes}\u2009min`,
                  k: t.home.hero.stat2,
                },
                { v: `${STUDIO.openDays}`, k: t.home.intro.daysLabel },
              ].map((x) => (
                <div
                  key={x.k}
                  className="flex items-baseline justify-between gap-8 border-t border-mocha-200/70 py-5 last:border-b"
                >
                  <dd className="font-display text-3xl font-light text-mocha-600">
                    {x.v}
                  </dd>
                  <dt className="text-[11px] uppercase tracking-widest text-clay">
                    {x.k}
                  </dt>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- method */

export function Method() {
  const { t } = useI18n();

  return (
    <Section tone="sand">
      <div className="container-x">
        <SectionHead
          eyebrow={t.home.method.eyebrow}
          title={t.home.method.title}
        />

        <RevealGroup className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-mocha-200/70 bg-mocha-200/70 sm:grid-cols-2 lg:grid-cols-4">
          {t.home.method.items.map((m) => (
            <RevealItem
              key={m.k}
              className="group bg-cream p-8 transition-colors duration-700 hover:bg-white"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-display text-4xl font-light text-clay/60 transition-colors duration-700 group-hover:text-mocha-600">
                  {m.k}
                </span>
                <Monogram className="h-6 w-6 text-clay/30 transition-all duration-700 group-hover:rotate-45 group-hover:text-clay/70" />
              </div>
              <h3 className="mt-8 text-[13px] uppercase tracking-widest">
                {m.t}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-mocha-500">
                {m.d}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- equipment */

export function Equipment() {
  const { t } = useI18n();

  return (
    <Section tone="dark">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-0 h-[520px] w-[520px] rounded-full bg-cream/[0.06] blur-3xl"
      />
      <div className="container-x relative grid gap-16 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <p className="eyebrow mb-5 text-cream/50">
            {t.home.equipment.eyebrow}
          </p>
          <h2 className="h-display text-balance text-[2.4rem] leading-[1.08] text-cream sm:text-5xl">
            {t.home.equipment.title}
          </h2>
          <p className="mt-6 max-w-xl text-[15px] leading-[1.9] text-cream/65">
            {t.home.equipment.body}
          </p>

          <ul className="mt-10 space-y-4">
            {t.home.equipment.points.map((p) => (
              <li key={p} className="flex gap-4 text-sm text-cream/75">
                <span className="mt-2 h-1 w-6 shrink-0 bg-gold/80" />
                {p}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="relative rounded-3xl border border-cream/[0.12] bg-cream/[0.04] p-8 backdrop-blur-sm md:p-10">
            {/* The room itself, where a partner's logo used to sit. */}
            <figure className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
              <Parallax strength={3} zoom={0.05}>
                <Image
                  src="/media/hero-1.jpg"
                  alt="A Reformer class at RG Pilates Studio"
                  fill
                  sizes="(min-width: 1024px) 40vw, 90vw"
                  quality={84}
                  className="object-cover object-[50%_35%]"
                />
              </Parallax>
            </figure>

            <div className="mt-9 h-px w-full bg-cream/[0.12]" />

            <dl className="mt-8 grid grid-cols-2 gap-8">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-cream/40">
                  {t.home.equipment.specReformers}
                </dt>
                <dd className="mt-2 font-display text-2xl font-light text-cream">
                  {t.home.equipment.specReformersValue.replace(
                    "{n}",
                    String(STUDIO.capacity),
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-cream/40">
                  {t.home.equipment.specSession}
                </dt>
                <dd className="mt-2 font-display text-2xl font-light text-cream">
                  {t.home.equipment.specSessionValue.replace(
                    "{minutes}",
                    String(STUDIO.classLengthMinutes),
                  )}
                </dd>
              </div>
            </dl>

            <Monogram className="mt-10 h-10 w-10 text-cream/25" />
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------- timetable preview */

export function TimetablePreview() {
  const { t } = useI18n();

  /**
   * The studio's hours, including the three in the middle of the day.
   *
   * The weekday line reads 06:00 to 12:00 and 15:00 to 20:00, which leaves a
   * three-hour gap that looks like the studio is shut. It is not: those are the
   * Personal and Duet hours, and a card that lists opening times while omitting
   * the only part of the day somebody can have the room to themselves is a card
   * that hides the thing worth knowing. `note` marks the row that is by
   * appointment rather than on the timetable.
   */
  const summary = openingSummary();
  const rows = [
    /* The days that run classes, grouped by identical hours. */
    ...summary
      .filter((g) => g.blocks.length > 0)
      .map((g) => ({
        label: formatDayList(g.days, t.common.daysShort),
        blocks: g.blocks,
        note: null as string | null,
      })),
    /* The midday appointments, between the class rows and the closed days. */
    {
      label: t.home.timetable.personalLabel,
      blocks: [t.home.timetable.personalHours],
      note: t.home.timetable.personalNote,
    },
    /* The closed days, shown with no hours. */
    ...summary
      .filter((g) => g.blocks.length === 0)
      .map((g) => ({
        label: formatDayList(g.days, t.common.daysShort),
        blocks: [] as string[],
        note: null as string | null,
      })),
  ];

  return (
    <Section>
      <div className="container-x">
        {/* Heading and call to action share one line, then the photograph and
            the hours card sit side by side beneath, stretched to the same
            height so the pair reads as one plate. */}
        <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end md:gap-12">
          <SectionHead
            eyebrow={t.home.timetable.eyebrow}
            title={t.home.timetable.title}
            body={t.home.timetable.body}
          />
          <Reveal delay={0.1}>
            <ButtonLink href="/timetable">{t.home.timetable.cta}</ButtonLink>
          </Reveal>
        </div>

        <div className="mt-14 grid items-stretch gap-8 lg:mt-16 lg:grid-cols-[1fr_360px] lg:gap-12">
          <Reveal
            delay={0.15}
            className="relative min-h-[300px] overflow-hidden rounded-3xl border border-mocha-200/70 bg-cream-200"
          >
            <Parallax strength={5} zoom={0.08}>
              <Image
                src="/media/class.jpg"
                alt="RG Pilates Studio during a Reformer class"
                fill
                sizes="(min-width: 1024px) 58vw, 92vw"
                quality={82}
                className="object-cover object-[54%_46%]"
              />
            </Parallax>
            <span className="pointer-events-none absolute inset-0 bg-mocha-900/10" />
          </Reveal>

          <Reveal delay={0.22}>
            <div className="h-full rounded-3xl border border-mocha-200/70 bg-white/60 p-7 backdrop-blur-sm md:p-8">
              {rows.map((r, i) => (
                <div
                  key={r.label}
                  className={
                    i === 0
                      ? "pb-5"
                      : "border-t border-mocha-200/70 py-5 last:pb-0"
                  }
                >
                  <p className="text-[11px] uppercase tracking-widest text-clay">
                    {r.label}
                  </p>
                  {r.blocks.length ? (
                    <div className="mt-3 flex flex-col gap-1">
                      {r.blocks.map((b) => (
                        <p
                          key={b}
                          className="font-display text-2xl font-light lining-nums tabular-nums text-mocha-600"
                        >
                          {b}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 font-display text-xl font-light text-clay/70">
                      {t.home.timetable.closed}
                    </p>
                  )}
                  {r.note && (
                    <p className="mt-1.5 text-[11px] leading-snug text-clay">
                      {r.note}
                    </p>
                  )}
                </div>
              ))}
              <div className="mt-7 flex items-center gap-3 border-t border-mocha-200/70 pt-5 text-[10px] uppercase tracking-widest text-clay">
                <Monogram className="h-6 w-6" />
                {STUDIO.classLengthMinutes}&thinsp;min · max {STUDIO.capacity}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ how it works */

export function HowItWorks() {
  const { t } = useI18n();

  return (
    <Section tone="sand">
      <div className="container-x">
        <SectionHead
          eyebrow={t.home.how.eyebrow}
          title={t.home.how.title}
          align="center"
        />
        <RevealGroup className="mt-16 grid gap-8 md:grid-cols-3">
          {t.home.how.items.map((s, i) => (
            <RevealItem key={s.t} className="relative">
              <div className="h-full rounded-3xl border border-mocha-200/70 bg-cream p-8">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-mocha-300 text-[11px] lining-nums tabular-nums text-mocha-600">
                  {i + 1}
                </span>
                <h3 className="mt-7 text-[13px] uppercase tracking-widest">
                  {s.t}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-mocha-500">
                  {s.d}
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------- final call */

export function FinalCta() {
  const { t } = useI18n();

  return (
    <Section tone="dark" className="py-28 md:py-36">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[860px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(246,243,240,0.10),transparent_65%)] animate-breathe"
      />
      <div className="container-x relative text-center">
        <Reveal>
          <Monogram className="mx-auto h-12 w-12 text-cream/60" />
          <h2 className="h-display mx-auto mt-10 max-w-3xl text-balance text-[2.6rem] leading-[1.08] text-cream sm:text-5xl md:text-[3.6rem]">
            {t.home.cta.title}
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-cream/65">
            {t.home.cta.body}
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/register" variant="cream" size="lg">
              {t.home.cta.primary}
            </ButtonLink>
            <Link
              href="/contact"
              className="link-underline px-4 text-[12px] uppercase tracking-widest text-cream/70 hover:text-cream"
            >
              {t.home.cta.secondary}
            </Link>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
