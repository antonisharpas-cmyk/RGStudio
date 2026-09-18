"use client";

import { useCallback, useEffect, useState } from "react";
import { DateField, dayKey, fromDayKey } from "@/components/ui/DateField";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * The six numbers the studio runs on, over a period the desk picks.
 *
 * The period is a real range — From and To — rather than a set of fixed windows,
 * because the questions a studio actually asks are "how did August go" and "what
 * did we take last month", not "what happened in the last thirty days". The three
 * buttons are the shortcuts to the answers that get asked for weekly; the two
 * dates are there for everything else.
 *
 * The range applies to the *flows* — bookings taken, money banked, members who
 * joined — and deliberately not to the *stocks*. "How many sessions are members
 * holding" has no period: it is true now or it is not. A dashboard that quietly
 * applies a date filter to a stock is a dashboard that lies, so the two are kept
 * apart and each card says which it is.
 */

type Stats = {
  members: number;
  newMembers: number;
  membersWithSessions: number;
  bookings: number;
  bookingPeople: number;
  cancellations: number;
  sessionsOutstanding: number;
  sessionsBooked: number;
  revenueOnlineCents: number;
  revenueCashCents: number;
  revenueCardDeskCents: number;
  revenueCents: number;
  upcomingSessions: number;
};

type Range = { from: string; to: string };

const ALL: Range = { from: "", to: "" };

function monthRange(monthsBack: number): Range {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  return { from: dayKey(first), to: dayKey(last) };
}

export function StatsRow({ initial }: { initial: Stats }) {
  const { t, fmtMoney, fmtDayMonth } = useI18n();
  const d = t.desk;

  const [range, setRange] = useState<Range>(ALL);
  const [stats, setStats] = useState<Stats>(initial);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setBusy(true);
    try {
      const q = new URLSearchParams();
      if (r.from) q.set("from", r.from);
      if (r.to) q.set("to", r.to);
      const res = await fetch(`/api/admin/stats?${q.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { stats: Stats };
      setStats(data.stats);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    /* The first render already holds the server's all-time numbers, so an
       untouched screen does not fetch them a second time. */
    if (range.from || range.to) void load(range);
    else setStats(initial);
  }, [range, load, initial]);

  const thisMonth = monthRange(0);
  const lastMonth = monthRange(1);
  const same = (a: Range, b: Range) => a.from === b.from && a.to === b.to;

  /* What the cards say underneath a flow: the period in words. */
  const periodLabel =
    !range.from && !range.to
      ? d.rangeAll
      : same(range, thisMonth)
        ? d.thisMonth
        : same(range, lastMonth)
          ? d.lastMonth
          : [
              range.from ? fmtDayMonth(fromDayKey(range.from)) : "…",
              range.to ? fmtDayMonth(fromDayKey(range.to)) : "…",
            ].join(" – ");

  const backwards = Boolean(range.from && range.to && range.from > range.to);

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-end gap-4 rounded-3xl border border-mocha-200/70 bg-white/60 p-5">
        <div className="min-w-[13.5rem] flex-1">
          <label className="label" htmlFor="stats-from">
            {d.rangeFrom}
          </label>
          <DateField
            id="stats-from"
            value={range.from}
            max={range.to || undefined}
            onChange={(from) => setRange((r) => ({ ...r, from }))}
            placeholder={d.rangeAll}
          />
        </div>

        <div className="min-w-[13.5rem] flex-1">
          <label className="label" htmlFor="stats-to">
            {d.rangeTo}
          </label>
          <DateField
            id="stats-to"
            value={range.to}
            min={range.from || undefined}
            onChange={(to) => setRange((r) => ({ ...r, to }))}
            placeholder={t.common.today}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-1">
          <Quick
            on={same(range, thisMonth)}
            onClick={() => setRange(thisMonth)}
            label={d.thisMonth}
          />
          <Quick
            on={same(range, lastMonth)}
            onClick={() => setRange(lastMonth)}
            label={d.lastMonth}
          />
          <Quick
            on={!range.from && !range.to}
            onClick={() => setRange(ALL)}
            label={d.rangeAll}
          />
          {busy && (
            <span className="ml-1 text-[11px] text-clay">
              {t.common.loading}
            </span>
          )}
        </div>
      </div>

      {backwards && (
        <p role="alert" className="mt-3 text-[12px] text-clay">
          {d.rangeBackwards}
        </p>
      )}

      {/**
        * Four rows, each answering one kind of question.
        *
        * Written as four grids rather than one flowing grid on purpose. A single
        * `grid-cols-3` reflowed the tiles by screen width, so "Cash" could end
        * up beside "Members" on one monitor and under "Bookings" on another, and
        * a figure's neighbours are half of what it means. These rows hold their
        * shape: who the members are, how busy the studio was, what it owes in
        * sessions, and what it took in money.
        */}
      <div className={cn("mt-6 space-y-4", busy && "opacity-60 transition-opacity")}>
        {/* 1. The membership. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Kpi
            label={d.kMembers}
            value={String(stats.members)}
            sub={
              range.from || range.to
                ? `+${stats.newMembers} ${d.kNew} · ${periodLabel}`
                : undefined
            }
          />
          <Kpi
            label={d.kActive}
            value={String(stats.membersWithSessions)}
            sub={d.kActiveSub}
          />
        </div>

        {/* 2. How busy the studio was, over the chosen period. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Kpi
            label={d.kBookings}
            value={String(stats.bookings)}
            /* Cancellations sit beside the total rather than being netted off
               it. A quiet week and a week nine people pulled out of look the
               same in one number, and they are not the same week. */
            sub={
              stats.cancellations > 0
                ? `${d.kBookingsSub} · ${periodLabel} · ${d.kCancelled.replace("{n}", String(stats.cancellations))}`
                : `${d.kBookingsSub} · ${periodLabel}`
            }
          />
          <Kpi
            label={d.kBookingPeople}
            value={String(stats.bookingPeople)}
            sub={`${d.kBookingPeopleSub} · ${periodLabel}`}
          />
        </div>

        {/* 3. What the studio owes in teaching, which the period does not
               change: both of these are a position today, not a flow. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Kpi
            label={d.kOutstanding}
            value={String(stats.sessionsOutstanding)}
            sub={d.kOutstandingSub}
          />
          <Kpi
            label={d.kBooked}
            value={String(stats.sessionsBooked)}
            sub={d.kBookedSub}
          />
        </div>

        {/* 4. The money, split by where it physically went, then the total. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label={d.kRevenueOnline}
            value={fmtMoney(stats.revenueOnlineCents)}
            sub={periodLabel}
          />
          <Kpi
            label={d.kRevenueCash}
            value={fmtMoney(stats.revenueCashCents)}
            sub={periodLabel}
          />
          <Kpi
            label={d.kRevenueCard}
            value={fmtMoney(stats.revenueCardDeskCents)}
            sub={periodLabel}
          />
          <Kpi
            label={d.kRevenue}
            value={fmtMoney(stats.revenueCents)}
            sub={periodLabel}
            accent
          />
        </div>
      </div>
    </div>
  );
}

function Quick({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-4 py-2.5 text-[10px] uppercase tracking-widest transition-all duration-400",
        on
          ? "border-mocha-600 bg-mocha-600 text-cream"
          : "border-mocha-200 text-mocha-500 hover:border-mocha-400",
      )}
    >
      {label}
    </button>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border p-6",
        accent
          ? "border-mocha-600 bg-mocha-600 text-cream"
          : "border-mocha-200/70 bg-white/60",
      )}
    >
      <p
        className={cn(
          "text-[10px] uppercase tracking-brand",
          accent ? "text-cream/60" : "text-clay",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-4 font-display text-3xl lining-nums tabular-nums",
          accent ? "text-cream" : "text-mocha-600",
        )}
      >
        {value}
      </p>
      {sub && (
        <p
          className={cn(
            "mt-2 text-[11px]",
            accent ? "text-cream/55" : "text-clay",
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
