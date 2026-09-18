"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { BUILDER_TERMS } from "@/lib/packs";
import type { PackageCard } from "@/components/marketing/PricingGrid";

/**
 * The long terms, as one card with two choices in it.
 *
 * ---
 *
 * **Why these three and not all five.**
 *
 * A month and three months are cards on the page above, because those are the
 * plans somebody weighs up: they want to see the two prices next to each other
 * and decide. Six, nine and twelve months are not browsed that way. Nobody
 * arrives undecided between nine and twelve; they arrive having decided to
 * commit, and the useful thing then is to say how long and how often and be
 * told the price. Twelve cards to express that is twelve cards nobody reads.
 *
 * The first version of this card carried all five terms and replaced every
 * pricing card on the page, which went too far: it hid the two ordinary
 * choices behind a control. This is the same idea applied only where it helps.
 *
 * ---
 *
 * **It looks like a pricing card because it is one.**
 *
 * An earlier version was a wide two-column panel with the choices on the left
 * and the price on the right, and it read as a different kind of thing from
 * everything around it — a configurator bolted onto a price list. The studio
 * said so. So the card is the same card: same border, same radius, same
 * padding, same price size, same rows across the bottom, same button. The only
 * difference is that two of the lines in it are chips you can press.
 *
 * ---
 *
 * **It resolves to a pack rather than computing a price.**
 *
 * `slugFor` builds the slug — `half-2`, `year-4` — and looks it up in the
 * catalogue the server sent. Nothing here multiplies or discounts anything.
 *
 * That matters more than it looks. A builder doing its own arithmetic would be
 * a second pricing engine, and the moment the studio ran an offer through the
 * desk the card and the checkout would disagree about what something costs. The
 * price shown here is the priced pack, offer included, because it *is* the
 * pack. A combination with no pack behind it does not offer itself.
 */

/**
 * The three long terms, read from the catalogue rather than written again.
 *
 * They were a list in this file, which is one of two places the same fact would
 * then live: give `half` a row of cards on the page and forget to remove it
 * here, and the studio has a term sold twice with nothing complaining. Now
 * there is one list, in `packs.ts`, next to the one that decides which groups
 * get cards.
 */
const TERMS = BUILDER_TERMS;

/**
 * The four cadences — and the fourth one is not called the same thing in every
 * term, which is a trap worth spelling out.
 *
 * `half-4` is "6 months · Unlimited", with a one-a-day cap. `month-4` is
 * "Monthly · 4 a week", with no cap. Same `-4`, two different products. This
 * card only offers the long terms, where all four `-4` packs happen to be the
 * unlimited kind — but the label is still read off the pack rather than
 * assumed, because the first version of this card assumed and was wrong.
 */
const CADENCES = [1, 2, 3, 4] as const;

function slugFor(months: number, cadence: number) {
  const term = TERMS.find((x) => x.months === months);
  return term ? `${term.group}-${cadence}` : null;
}

export function PlanBuilder({
  packages,
  signedIn,
}: {
  packages: PackageCard[];
  signedIn: boolean;
}) {
  const { t, locale, fmtMoney } = useI18n();
  const router = useRouter();
  const el = locale === "el";
  const d = t.pricingPage.builder;

  /**
   * Opens on six months, twice a week.
   *
   * The shortest of the three and the cadence the studio sells most, so the
   * first price anybody sees on this card is its lowest. A card that opened on
   * "12 months, unlimited" would lead with EUR 1,655, which is the right plan
   * for very few people and the wrong first impression for everybody else.
   */
  const [months, setMonths] = useState(6);
  const [cadence, setCadence] = useState(2);
  const [busy, setBusy] = useState(false);

  const slug = slugFor(months, cadence);
  const pack = slug ? packages.find((p) => p.slug === slug) : undefined;

  function buy() {
    if (!pack) return;
    const next = `/checkout?pack=${pack.slug}`;
    setBusy(true);
    router.push(
      signedIn
        ? next
        : `/login?next=${encodeURIComponent(next)}&pkg=${pack.slug}`,
    );
  }

  const unitCents = pack ? Math.round(pack.priceCents / pack.credits) : 0;
  const badge =
    pack?.badge === "POPULAR"
      ? t.pricingPage.popular
      : pack?.badge === "BEST_VALUE"
        ? t.pricingPage.bestValue
        : null;

  function Chip({
    on,
    onClick,
    children,
  }: {
    on: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={cn(
          "rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-widest transition-all duration-500",
          on
            ? "border-mocha-600 bg-mocha-600 text-cream"
            : "border-mocha-200 text-mocha-500 hover:border-mocha-400 hover:bg-white",
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <article className="relative flex h-full flex-col rounded-3xl border border-mocha-200/70 bg-white/60 p-8 transition-all duration-700 ease-silk hover:border-mocha-300 hover:bg-white hover:shadow-soft">
      {badge && (
        <span className="absolute -top-3 left-8 rounded-full bg-mocha-600 px-3 py-1 text-[9px] uppercase tracking-widest text-cream">
          {badge}
        </span>
      )}

      {/* The eyebrow is the plan they have built, in the same slot where every
          other card names itself. It changes as the chips change, which is the
          quickest confirmation that the chips did something. */}
      <p className="text-[11px] uppercase tracking-widest text-clay">
        {pack ? (el ? pack.nameEl : pack.nameEn) : d.title}
      </p>

      {/**
       * Both rows are labelled, and they have to be.
       *
       * Without labels the card showed seven chips in a stack that wrapped
       * "12 MONTHS" onto its own line directly above "1 A WEEK", and nothing
       * said where one question ended and the next began. Read cold it looked
       * like one list of seven options, three of which were months and four of
       * which were something else. Two words above each row costs a line and
       * removes the guessing.
       */}
      <div className="mt-5 space-y-4">
        <div className="space-y-2">
          <p className="text-[9px] uppercase tracking-widest text-clay/70">
            {d.howLong}
          </p>
          <div className="flex flex-wrap gap-2">
            {TERMS.map((term) => (
              <Chip
                key={term.months}
                on={months === term.months}
                onClick={() => setMonths(term.months)}
              >
                {d.months.replace("{n}", String(term.months))}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[9px] uppercase tracking-widest text-clay/70">
            {d.howOften}
          </p>
          {/* Stacked, one per line, so the longer "sessions per week" labels do
              not wrap two-and-two — and so Unlimited sits on its own line under
              "3 sessions per week" rather than beside it. */}
          <div className="flex flex-col items-start gap-2">
            {CADENCES.map((n) => {
              /* What this chip would actually buy at the selected term, so the
                 fourth one is named by the pack and not by this card. */
              const forThisTerm = packages.find(
                (x) => x.slug === slugFor(months, n),
              );
              return (
                <Chip key={n} on={cadence === n} onClick={() => setCadence(n)}>
                  {forThisTerm?.perDayLimit
                    ? d.unlimited
                    : n === 1
                      ? d.perWeekOne
                      : d.perWeekMany.replace("{n}", String(n))}
                </Chip>
              );
            })}
          </div>
        </div>
      </div>

      {pack ? (
        <>
          <p className="h-display mt-6 flex items-baseline gap-3 text-5xl text-mocha-600">
            {fmtMoney(pack.priceCents)}
            {pack.listPriceCents ? (
              <span className="text-2xl line-through text-clay/70">
                {fmtMoney(pack.listPriceCents)}
              </span>
            ) : null}
          </p>

          {pack.listPriceCents ? (
            <p className="mt-3 inline-flex rounded-full bg-gold/15 px-3 py-1 text-[10px] uppercase tracking-widest text-[#8a6f1a]">
              {(el ? pack.discountLabelEl : pack.discountLabelEn) ||
                t.pricingPage.offer}
            </p>
          ) : null}

          <p className="mt-2 text-[12px] text-mocha-500">
            {fmtMoney(unitCents)} {t.pricingPage.perClassLabel}
          </p>

          <div className="mt-8 space-y-3 border-t border-mocha-200/70 pt-6 text-[13px] text-mocha-500">
            <p className="flex items-center justify-between">
              <span>{t.common.credits}</span>
              <span className="font-display text-xl text-mocha-600">
                {pack.credits}
              </span>
            </p>
            <p className="flex items-center justify-between">
              <span>{t.pricingPage.validity}</span>
              <span>
                {pack.validityDays} {t.pricingPage.days}
              </span>
            </p>
            {pack.perDayLimit ? (
              <p className="flex items-center justify-between gap-4">
                <span>{t.pricingPage.paceLabel}</span>
                <span className="text-right">{t.pricingPage.onePerDay}</span>
              </p>
            ) : null}
          </div>

          <div className="mt-auto pt-8">
            <Button
              onClick={buy}
              disabled={busy}
              className="w-full"
              aria-label={`${t.pricingPage.buy} — ${el ? pack.nameEl : pack.nameEn}`}
            >
              {busy ? t.common.loading : t.pricingPage.buy}
            </Button>
          </div>
        </>
      ) : (
        /* No pack for this pair. Should not happen with the catalogue as it
           stands, and says so plainly rather than rendering an empty card if a
           pack is ever withdrawn. */
        <p className="mt-6 text-[13px] text-clay">{d.unavailable}</p>
      )}
    </article>
  );
}

