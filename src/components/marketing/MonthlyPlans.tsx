"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * The monthly plans: a long term at a cadence, paid one month at a time.
 *
 * The same two questions as the plan builder above it (how long, how often)
 * with a different answer at the end: a price per month rather than one
 * figure, every session on the account from day one, and the rule about an
 * unpaid month said plainly before anybody presses anything.
 */

export type PlanOffer = {
  months: number;
  perWeek: number;
  monthlyPriceCents: number;
  totalCredits: number;
};

export function MonthlyPlans({
  plans,
  signedIn,
  graceDays,
}: {
  plans: PlanOffer[];
  signedIn: boolean;
  graceDays: number;
}) {
  const { t, fmtMoney } = useI18n();
  const d = t.plans;
  const router = useRouter();

  const months = [...new Set(plans.map((p) => p.months))].sort((a, b) => a - b);
  const cadences = [...new Set(plans.map((p) => p.perWeek))].sort((a, b) => a - b);

  const [m, setM] = useState(months.includes(9) ? 9 : months[0] ?? 6);
  const [w, setW] = useState(cadences.includes(2) ? 2 : cadences[0] ?? 1);
  const plan = plans.find((p) => p.months === m && p.perWeek === w);

  if (plans.length === 0) return null;

  function start() {
    if (!plan) return;
    const next = `/checkout?plan=${plan.months}x${plan.perWeek}`;
    router.push(signedIn ? next : `/login?next=${encodeURIComponent(next)}`);
  }

  const chip = (on: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-widest transition-all duration-500",
      on
        ? "border-mocha-600 bg-mocha-600 text-cream"
        : "border-mocha-200 text-mocha-500 hover:border-mocha-400 hover:bg-white",
    );

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-mocha-200/70 pb-4">
        <h3 className="h-display text-[1.6rem] text-mocha-600">{d.eyebrow}</h3>
        <p className="text-[13px] text-clay">{d.title}</p>
      </div>
      <Reveal>
        <div className="grid gap-8 rounded-4xl border border-mocha-200/70 bg-white/70 p-8 backdrop-blur-sm md:grid-cols-[1fr_1fr] md:p-10">
          <div className="space-y-6">
            <p className="text-[13px] leading-relaxed text-mocha-500">{d.body}</p>
            <div className="space-y-2">
              <p className="text-[9px] uppercase tracking-widest text-clay/70">{d.months}</p>
              <div className="flex flex-wrap gap-2">
                {months.map((n) => (
                  <button key={n} type="button" aria-pressed={m === n} className={chip(m === n)} onClick={() => setM(n)}>
                    {d.monthsN.replace("{n}", String(n))}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[9px] uppercase tracking-widest text-clay/70">{d.perWeek}</p>
              <div className="flex flex-col items-start gap-2">
                {cadences.map((n) => (
                  <button key={n} type="button" aria-pressed={w === n} className={chip(w === n)} onClick={() => setW(n)}>
                    {n === 1 ? d.perWeekOne : d.perWeekMany.replace("{n}", String(n))}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            {plan ? (
              <>
                <p className="h-display text-5xl text-mocha-600">
                  {fmtMoney(plan.monthlyPriceCents)}
                  <span className="ml-2 text-lg text-clay">
                    {d.perMonth.replace("{amount}", "").trim()}
                  </span>
                </p>
                <p className="mt-3 text-[13px] text-mocha-500">
                  {d.total.replace("{n}", String(plan.totalCredits))}
                </p>
                <p className="mt-5 text-[12px] leading-relaxed text-clay">{d.firstMonth}</p>
                <p className="mt-2 text-[12px] leading-relaxed text-clay">
                  {d.rule.replace("{days}", String(graceDays))}
                </p>
                <Button className="mt-8 w-full" onClick={start}>
                  {signedIn ? d.cta : d.signIn}
                </Button>
              </>
            ) : (
              <p className="text-sm text-clay">{d.unavailable}</p>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
