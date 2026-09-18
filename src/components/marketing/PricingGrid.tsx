"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { BUILDER_AFTER, CARD_GROUPS, type PackGroup } from "@/lib/packs";
import { PlanBuilder } from "@/components/marketing/PlanBuilder";

export type PackageCard = {
  id: string;
  slug: string;
  nameEn: string;
  nameEl: string;
  credits: number;
  /** What it costs today, offer included. */
  priceCents: number;
  /** The normal price, when an offer is running. */
  listPriceCents?: number | null;
  discountLabelEn?: string | null;
  discountLabelEl?: string | null;
  validityDays: number;
  badge: string | null;
  /** Which commitment it belongs to, so the page can group the cards. */
  /* Taken from `PackGroup` rather than written out again. The second copy
     lived here and went stale the moment the 6, 9 and 12 month terms were
     added: the build failed on `"half" is not assignable`, which is the good
     outcome, but a union that has to be edited in two places will eventually
     be edited in one. */
  group?: PackGroup | null;
  /** How many people one session admits. 2 on a duet, 1 on everything else. */
  seats?: number;
  /** Set when the plan allows only so many classes a day. */
  perDayLimit?: number | null;
};

/**
 * The grid a row of cards sits in.
 *
 * Four across only when the row divides by four, so the monthly and three-month
 * rows land as one clean line of four and a row of two or one is not left with
 * three empty columns beside it. Asked for by a function rather than written at
 * each call site because the builder section needs the same answer, and a lone
 * builder card 272px wide under a lone day pass card 370px wide read as two
 * different kinds of card.
 */
function gridFor(count: number) {
  return cn(
    "grid gap-6 sm:grid-cols-2",
    count % 4 === 0 ? "xl:grid-cols-4" : "xl:grid-cols-3",
  );
}

export function PricingGrid({
  packages,
  signedIn,
  showIncludes = true,
}: {
  packages: PackageCard[];
  signedIn: boolean;
  showIncludes?: boolean;
}) {
  const { t, locale, fmtMoney } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const el = locale === "el";

  /* The pack card no longer takes the payment. It sends the member to the
     checkout page, which is where the order and the card sit side by side —
     the same shape as any shop, and it means the buy button never has to
     explain a provider error to somebody who has not decided to pay yet. */
  function buy(pkg: PackageCard) {
    const next = `/checkout?pack=${pkg.slug}`;
    setBusy(pkg.id);
    router.push(
      signedIn
        ? next
        : `/login?next=${encodeURIComponent(next)}&pkg=${pkg.slug}`,
    );
  }

  /* Grouped by commitment rather than shown as one wall of nine cards.
     "Monthly · 3 a week" and "3 months · 1 a week" are both twelve classes; side
     by side in a plain grid nobody can tell what separates them. Under a heading
     that says how long you are committing and how long you have to use them, the
     choice reads as two questions — how often, and for how long. */
  /* Which groups get a row of cards, and in what order, from lib/packs.ts.
     The long terms are chosen in the builder card instead, which is dropped in
     after the section named by BUILDER_AFTER. */
  const grouped = CARD_GROUPS.map((g) => ({
    key: g,
    heading: t.pricingPage.groups[g],
    packs: packages.filter((p) => (p.group ?? "month") === g),
  })).filter((g) => g.packs.length > 0);

  /**
   * The builder's own section, rendered inline between two card sections.
   *
   * It sits after three months and before the appointments because that is
   * where it belongs in the argument the page is making: a month, a term, a
   * longer term, and then the thing that is not a class at all. Its position is
   * a fact about the catalogue rather than about this component, which is why
   * `BUILDER_AFTER` lives beside the groups it orders.
   */
  const builderSection = (
    <section key="builder">
      <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-mocha-200/70 pb-4">
        <h3 className="h-display text-[1.6rem] text-mocha-600">
          {t.pricingPage.builder.title}
        </h3>
      </div>
      {/* The same grid a card row gets, asked for with the same function, so a
          lone builder card is exactly as wide as the lone day pass card above
          it rather than the narrower width a four-across row would give it. */}
      <div className={gridFor(1)}>
        <PlanBuilder packages={packages} signedIn={signedIn} />
      </div>
    </section>
  );

  return (
    <div className="space-y-14">
      {grouped.flatMap((section) => [
        <section key={section.key}>
          <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-mocha-200/70 pb-4">
            <h3 className="h-display text-[1.6rem] text-mocha-600">
              {section.heading.title}
            </h3>
            {section.heading.note && (
              <p className="text-[13px] text-clay">{section.heading.note}</p>
            )}
          </div>
          <RevealGroup className={gridFor(section.packs.length)}>
            {section.packs.map((p) => {
              const seats = p.seats ?? 1;
              /* Per class on a plan; per person on a duet, where "€45 a class" is
             true and useless and "€22.50 each" is the number the two people
             standing there are actually working out. Hidden altogether when a
             pack is one session for one person, because repeating the price
             underneath itself tells nobody anything. */
              const unitCents =
                seats > 1
                  ? Math.round(p.priceCents / seats)
                  : Math.round(p.priceCents / p.credits);
              /* The per-class figure is hidden on the monthly plans and on the
                 fixed three-month plans, and kept only where it is the point:
                 the Unlimited plans, whose whole appeal is the price per class,
                 and the Duet, where "each" is the number two people are working
                 out. The long terms in the builder keep theirs too. */
              const hidePerClass =
                p.group === "month" ||
                (p.group === "quarter" && !p.perDayLimit);
              const showUnit = (p.credits > 1 || seats > 1) && !hidePerClass;
              const highlight = p.badge === "POPULAR";
              return (
                <RevealItem key={p.id}>
                  <article
                    className={cn(
                      "relative flex h-full flex-col rounded-3xl border p-8 transition-all duration-700 ease-silk hover:-translate-y-1",
                      highlight
                        ? "border-mocha-600 bg-mocha-600 text-cream shadow-lift"
                        : "border-mocha-200/70 bg-white/60 hover:border-mocha-300 hover:bg-white hover:shadow-soft",
                    )}
                  >
                    {p.badge && (
                      <span
                        className={cn(
                          "absolute -top-3 left-8 rounded-full px-3 py-1 text-[9px] uppercase tracking-widest",
                          highlight
                            ? "bg-cream text-mocha-700"
                            : "bg-mocha-600 text-cream",
                        )}
                      >
                        {p.badge === "POPULAR"
                          ? t.pricingPage.popular
                          : t.pricingPage.bestValue}
                      </span>
                    )}

                    <p
                      className={cn(
                        "text-[11px] uppercase tracking-widest",
                        highlight ? "text-cream/60" : "text-clay",
                      )}
                    >
                      {el ? p.nameEl : p.nameEn}
                    </p>

                    {/* When an offer is running the old price stays on the card,
                    struck through. A discount nobody can see the size of is
                    not much of a discount. */}
                    <p
                      className={cn(
                        "h-display mt-5 flex items-baseline gap-3 text-5xl",
                        highlight ? "text-cream" : "text-mocha-600",
                      )}
                    >
                      {fmtMoney(p.priceCents)}
                      {p.listPriceCents ? (
                        <span
                          className={cn(
                            "text-2xl line-through",
                            highlight ? "text-cream/45" : "text-clay/70",
                          )}
                        >
                          {fmtMoney(p.listPriceCents)}
                        </span>
                      ) : null}
                    </p>

                    {p.listPriceCents ? (
                      <p
                        className={cn(
                          "mt-3 inline-flex rounded-full px-3 py-1 text-[10px] uppercase tracking-widest",
                          highlight
                            ? "bg-cream/15 text-cream"
                            : "bg-gold/15 text-[#8a6f1a]",
                        )}
                      >
                        {(el ? p.discountLabelEl : p.discountLabelEn) ||
                          t.pricingPage.offer}
                      </p>
                    ) : null}

                    {showUnit && (
                      <p
                        className={cn(
                          "mt-2 text-[12px]",
                          highlight ? "text-cream/60" : "text-mocha-500",
                        )}
                      >
                        {fmtMoney(unitCents)}{" "}
                        {seats > 1
                          ? t.pricingPage.perPersonLabel
                          : t.pricingPage.perClassLabel}
                      </p>
                    )}

                    <div
                      className={cn(
                        "mt-8 space-y-3 border-t pt-6 text-[13px]",
                        highlight
                          ? "border-cream/15 text-cream/75"
                          : "border-mocha-200/70 text-mocha-500",
                      )}
                    >
                      <p className="flex items-center justify-between">
                        <span>{t.common.credits}</span>
                        <span
                          className={cn(
                            "font-display text-xl",
                            highlight ? "text-cream" : "text-mocha-600",
                          )}
                        >
                          {p.credits}
                        </span>
                      </p>
                      <p className="flex items-center justify-between">
                        <span>{t.pricingPage.validity}</span>
                        <span>
                          {p.validityDays} {t.pricingPage.days}
                        </span>
                      </p>
                      {seats > 1 && (
                        <p className="flex items-center justify-between">
                          <span>{t.pricingPage.peopleLabel}</span>
                          <span
                            className={cn(
                              "font-display text-xl",
                              highlight ? "text-cream" : "text-mocha-600",
                            )}
                          >
                            {seats}
                          </span>
                        </p>
                      )}
                      {p.perDayLimit ? (
                        <p className="flex items-center justify-between gap-4">
                          <span>{t.pricingPage.paceLabel}</span>
                          <span className="text-right">
                            {t.pricingPage.onePerDay}
                          </span>
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-auto pt-8">
                      <Button
                        onClick={() => buy(p)}
                        disabled={busy === p.id}
                        variant={highlight ? "cream" : "solid"}
                        className="w-full"
                      >
                        {/* The same words whether or not they are signed in. A
                        card that says "sign in to buy" asks for a decision
                        about accounts before the decision about buying; if
                        they are not signed in, the login page comes and goes
                        and drops them on the checkout anyway. */}
                        {busy === p.id ? t.common.loading : t.pricingPage.buy}
                      </Button>
                    </div>
                  </article>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </section>,
        section.key === BUILDER_AFTER ? builderSection : null,
      ])}

      {showIncludes && (
        <div className="mt-16 grid gap-10 rounded-3xl border border-mocha-200/70 bg-cream-200/60 p-8 md:grid-cols-[1fr_1.2fr] md:p-10">
          <div>
            <p className="eyebrow mb-4">{t.pricingPage.included}</p>
            <ul className="space-y-3">
              {t.pricingPage.includes.map((i) => (
                <li key={i} className="flex gap-3 text-sm text-mocha-500">
                  <span className="mt-2 h-1 w-4 shrink-0 bg-clay/60" />
                  {i}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="text-[13px] uppercase tracking-widest">
                {t.pricingPage.privateTitle}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-mocha-500">
                {t.pricingPage.privateBody}
              </p>
              {/* Sends them to the timetable rather than the contact form: the
                  studio sells these now, so the answer to "is noon free on
                  Thursday" is a page and not an email. */}
              <ButtonLink
                href="/timetable"
                variant="outline"
                size="sm"
                className="mt-5"
              >
                {t.pricingPage.privateCta}
              </ButtonLink>
            </div>
            <div>
              <h3 className="text-[13px] uppercase tracking-widest">
                {t.pricingPage.corporateTitle}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-mocha-500">
                {t.pricingPage.corporateBody}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
