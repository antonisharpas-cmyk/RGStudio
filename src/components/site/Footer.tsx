"use client";

import Image from "next/image";
import { formatDayList, openingSummary } from "@/lib/rota";
import Link from "next/link";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { Monogram } from "@/components/ui/Monogram";
import { Wordmark } from "@/components/ui/Wordmark";
import { useI18n } from "@/i18n/LanguageProvider";
import { SocialLinks } from "@/components/ui/SocialLinks";
import { StudioEmail } from "@/components/site/StudioEmail";
import { STUDIO } from "@/lib/studio";

/**
 * One grid, three rows, four columns.
 *
 * The footer used to be three separate layouts stacked on top of each other: a
 * four-column grid for the link lists, a three-column grid for the address, and
 * a flex row with the credit pushed to the middle and the language toggle to the
 * far right. Nothing lined up with anything below it, which is the sort of thing
 * that reads as sloppiness without anybody being able to say why.
 *
 * So every row now sits on the same columns and the alignment is a fact of the
 * layout rather than a coincidence:
 *
 *   column 1   the wordmark      the address        the copyright line
 *   column 2   Explore           Studio hours       Developed & designed by
 *   column 3   Account
 *   column 4   Legal             Follow             the language toggle
 *
 * Column 3 is empty on the second and third rows on purpose. Filling it would
 * mean moving Follow and the toggle off the edge Legal sets, and that edge is
 * the point.
 */
const GRID = "grid gap-x-8 gap-y-14 md:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]";

export function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  const groups = [
    {
      title: t.footer.explore,
      links: [
        { href: "/studio", label: t.nav.studio },
        { href: "/timetable", label: t.nav.timetable },
        { href: "/pricing", label: t.nav.pricing },
        { href: "/faq", label: t.nav.faq },
      ],
    },
    {
      title: t.footer.account,
      links: [
        { href: "/account", label: t.nav.account },
        { href: "/login", label: t.nav.login },
        { href: "/register", label: t.nav.register },
        { href: "/contact", label: t.nav.contact },
      ],
    },
    {
      title: t.footer.legal,
      links: [
        { href: "/privacy", label: t.footer.privacy },
        { href: "/terms", label: t.footer.terms },
        { href: "/cookies", label: t.legal.cookiesTitle },
      ],
    },
  ];

  return (
    <footer className="relative overflow-hidden bg-mocha-600 text-cream/80 grain">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-cream/[0.05] blur-3xl"
      />
      <div className="container-x relative py-20">
        <div className={GRID}>
          <div>
            <Wordmark tone="cream" className="w-[196px]" />
            <p className="mt-6 max-w-xs text-sm leading-relaxed text-cream/65">
              {t.footer.tagline}
            </p>
            <div className="mt-8 flex items-center gap-3 text-[10px] uppercase tracking-widest text-cream/50">
              <Monogram className="h-7 w-7 text-cream/70" />
              {t.footer.partner}
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-5 text-[10px] uppercase tracking-brand text-cream/45">
                {g.title}
              </p>
              <ul className="space-y-3">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="link-underline text-sm text-cream/80 hover:text-cream"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={`${GRID} mt-16 gap-y-10 border-t border-cream/[0.12] pt-10`}>
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-brand text-cream/45">
              {t.footer.visit}
            </p>
            <p className="text-sm leading-relaxed text-cream/75">
              {STUDIO.addressLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          </div>
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-brand text-cream/45">
              {t.contactPage.hoursTitle}
            </p>
            {/* Day above hours rather than beside them.
                
                The column is a quarter of the footer now that all three rows
                share one grid, and "Monday – Friday: 06:00 – 12:00 · 15:00 –
                20:00" on one line wrapped in the middle of a time range, which
                is the one place a line of times must not break. */}
            {/* Built from the rota so the footer can never disagree with the
                timetable. Days with the same hours share a line; the closed
                days are shown as closed rather than dropped. The midday
                appointment line sits in the middle, for the same reason it is
                on the home page: without it the day has a three-hour hole that
                reads as the studio being shut. */}
            <div className="space-y-2 text-sm leading-relaxed text-cream/75">
              {openingSummary()
                .filter((g) => g.blocks.length > 0)
                .map((g) => (
                  <p key={g.days.join(",")}>
                    {formatDayList(g.days, t.common.daysShort)}
                    <span className="block lining-nums tabular-nums">
                      {g.blocks.join(" · ")}
                    </span>
                  </p>
                ))}
              <p>
                {t.home.timetable.personalLabel}
                <span className="block lining-nums tabular-nums">
                  {t.home.timetable.personalHours}
                </span>
              </p>
              {openingSummary()
                .filter((g) => g.blocks.length === 0)
                .map((g) => (
                  <p key={g.days.join(",")} className="text-cream/45">
                    {formatDayList(g.days, t.common.daysShort)}:{" "}
                    {t.home.timetable.closed}
                  </p>
                ))}
            </div>
          </div>
          {/* Column 4, under Legal. */}
          <div className="lg:col-start-4">
            <p className="mb-3 text-[10px] uppercase tracking-brand text-cream/45">
              {t.contactPage.followTitle}
            </p>
            <SocialLinks
              className="gap-3"
              itemClassName="text-cream/80 hover:text-cream"
            />
            <StudioEmail className="mt-4 link-underline text-sm text-cream/80 hover:text-cream" />
            <a
              href={`tel:${STUDIO.phone.replace(/\s/g, "")}`}
              className="mt-2 block link-underline text-sm text-cream/80 hover:text-cream"
            >
              {STUDIO.phone}
            </a>
          </div>
        </div>

        <div className={`${GRID} mt-12 items-center gap-y-6 border-t border-cream/[0.12] pt-8`}>
          <p className="text-[11px] text-cream/45">
            © {year} RG Pilates Studio. {t.footer.rights}
          </p>

          {/* The studio's own line comes first and the credit sits quietly
              beside it — legible, not loud. The wordmark rather than the name in
              text, because it is a logo and it should look like one. */}
          <a
            href="https://www.ergonsite.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t.footer.builtBy} ErgonSite`}
            /* Column 2, under Explore and Studio hours. */
            className="group flex flex-wrap items-center gap-x-2.5 gap-y-1 transition-opacity duration-500 hover:opacity-100 sm:opacity-70"
          >
            {/* Never wrapped: it is four short words and a logo, and the two
                halves of a credit line broken across a line read as a mistake. */}
            <span className="whitespace-nowrap text-[11px] text-cream/45 transition-colors duration-500 group-hover:text-cream/70">
              {t.footer.builtBy}
            </span>
            <Image
              src="/brand/ergonsite.png"
              alt="ErgonSite"
              width={480}
              height={104}
              /* Rendered at ~84px wide; without `sizes` next/image would ship
                 the 1080w variant of a small logo. 84 rather than 96 so the
                 credit and the mark stay on one line inside the column the
                 shared footer grid gives them. */
              sizes="100px"
              className="h-auto w-[84px]"
            />
          </a>

          {/* Column 4, under Legal and Follow. `justify-start` because the
              toggle is a flex row that would otherwise stretch across the
              column and put its right edge somewhere arbitrary. */}
          <div className="flex justify-start lg:col-start-4">
            <LanguageToggle tone="dark" />
          </div>
        </div>
      </div>
    </footer>
  );
}
