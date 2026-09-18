"use client";

import { useState } from "react";
import { DateField, dayKey } from "@/components/ui/DateField";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * The accountant's screen: pick a period, pick a till, download the sales.
 *
 * Deliberately not a table on the page. The studio does not read its takings
 * here line by line — it hands the file to whoever keeps the books, and they
 * open it in a spreadsheet. So this is the smallest thing that produces that
 * file: a range, a filter, and a button. The takings *totals* live on the
 * Analytics screen; this is the detail behind them.
 *
 * The till filter is here because the accountant often wants one at a time: the
 * online rows to set against a Stripe fee report, or the cash to set against the
 * drawer. "All" is every till in one sheet.
 */

type Range = { from: string; to: string };
type Method = "all" | "online" | "cash" | "card_at_desk";

const ALL: Range = { from: "", to: "" };

function monthRange(monthsBack: number): Range {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  return { from: dayKey(first), to: dayKey(last) };
}

export function LogisticsPanel() {
  const { t } = useI18n();
  const d = t.desk;

  /* Opens on this month, because "what did we take this month" is the question
     asked far more often than any other. The range and the filter are still
     free for everything else. */
  const [range, setRange] = useState<Range>(monthRange(0));
  const [method, setMethod] = useState<Method>("all");

  const thisMonth = monthRange(0);
  const lastMonth = monthRange(1);
  const same = (a: Range, b: Range) => a.from === b.from && a.to === b.to;
  const backwards = Boolean(range.from && range.to && range.from > range.to);

  function download() {
    const q = new URLSearchParams();
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
    q.set("method", method);
    /* A navigation, not a fetch: only a real navigation lets the browser act on
       Content-Disposition and save the file. */
    window.location.href = `/api/admin/logistics/export?${q.toString()}`;
  }

  return (
    <div className="mt-10">
      <p className="max-w-2xl text-sm text-clay">{d.logisticsIntro}</p>

      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-3xl border border-mocha-200/70 bg-white/60 p-5">
        <div className="min-w-[13.5rem] flex-1">
          <label className="label" htmlFor="logi-from">
            {d.rangeFrom}
          </label>
          <DateField
            id="logi-from"
            value={range.from}
            max={range.to || undefined}
            onChange={(from) => setRange((r) => ({ ...r, from }))}
            placeholder={d.rangeAll}
          />
        </div>

        <div className="min-w-[13.5rem] flex-1">
          <label className="label" htmlFor="logi-to">
            {d.rangeTo}
          </label>
          <DateField
            id="logi-to"
            value={range.to}
            min={range.from || undefined}
            onChange={(to) => setRange((r) => ({ ...r, to }))}
            placeholder={t.common.today}
          />
        </div>

        <div className="min-w-[12rem] flex-1">
          <label className="label" htmlFor="logi-method">
            {d.logisticsMethod}
          </label>
          <select
            id="logi-method"
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
          >
            <option value="all">{d.logisticsAll}</option>
            <option value="online">{d.logisticsOnline}</option>
            <option value="cash">{d.methodCash}</option>
            <option value="card_at_desk">{d.methodCard}</option>
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
      </div>

      {backwards && (
        <p role="alert" className="mt-3 text-[12px] text-clay">
          {d.rangeBackwards}
        </p>
      )}

      <button
        type="button"
        onClick={download}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-mocha-600 px-6 py-3 text-[12px] uppercase tracking-widest text-cream transition-colors duration-400 hover:bg-mocha-700"
      >
        {d.logisticsDownload}
      </button>
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
