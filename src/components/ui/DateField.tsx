"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * A date, picked from a calendar rather than typed.
 *
 * The browser's own date input was the wrong tool here. It renders as
 * `dd/mm/yyyy` on Windows and `mm/dd/yyyy` on a US machine — the same field
 * meaning two different days depending on whose computer is on the desk, which
 * is not a detail to be relaxed about when the button next to it cancels
 * everybody's classes. So the field shows the day in words ("Sunday 30 August
 * 2026"), and the only way to change it is to point at it on a calendar.
 *
 * Monday-first, because that is the week in Cyprus. Sundays are dimmed since
 * the studio is shut then, but still selectable: the desk may well want to look
 * at a Sunday, it just cannot teach on one.
 */

/** YYYY-MM-DD for a date, read in the browser's own reckoning of the day. */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** The reverse, anchored at midday so no timezone can nudge it onto the day either side. */
export function fromDayKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12);
}

export function DateField({
  id,
  value,
  onChange,
  placeholder,
  min,
  max,
  align = "left",
  className,
}: {
  id?: string;
  /** YYYY-MM-DD, or "" for nothing chosen yet. */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  align?: "left" | "right";
  className?: string;
}) {
  const { t, fmtFullDate, fmtMonthYear, fmtWeekdayShort } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const today = dayKey(new Date());
  const selected = value || "";
  /* The month on show. It follows the chosen day, and falls back to this month
     when nothing is chosen yet. */
  const [cursor, setCursor] = useState(() =>
    startOfMonth(selected ? fromDayKey(selected) : new Date()),
  );

  useEffect(() => {
    if (selected) setCursor(startOfMonth(fromDayKey(selected)));
  }, [selected]);

  /* Close on Escape or a press anywhere else. `pointerdown` rather than
     `click`, so the calendar is gone before the thing underneath reacts. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    /* 1 January 2024 was a Monday — a fixed anchor, so the header never depends
       on what today happens to be. */
    fmtWeekdayShort(new Date(2024, 0, 1 + i, 12)),
  );

  const cells = monthGrid(cursor);
  const blocked = (k: string) => Boolean((min && k < min) || (max && k > max));

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-2xl border bg-white/80 px-5 py-3.5 text-left text-[15px] transition-colors duration-300",
          open ? "border-mocha-500" : "border-mocha-200 hover:border-mocha-400",
          selected ? "text-mocha-600" : "text-clay",
        )}
      >
        <span className="lining-nums tabular-nums">
          {selected
            ? fmtFullDate(fromDayKey(selected))
            : (placeholder ?? t.desk.pickDay)}
        </span>
        <CalendarMark />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t.desk.pickDay}
          className={cn(
            "absolute z-40 mt-2 w-[19.5rem] rounded-3xl border border-mocha-200 bg-white p-5 shadow-[0_18px_50px_-20px_rgba(22,20,19,0.35)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="flex items-center justify-between">
            <Step
              onClick={() => setCursor(addMonths(cursor, -1))}
              label={t.desk.monthBefore}
              dir="prev"
            />
            <p className="font-display text-lg text-mocha-600 lining-nums tabular-nums">
              {fmtMonthYear(cursor)}
            </p>
            <Step
              onClick={() => setCursor(addMonths(cursor, 1))}
              label={t.desk.monthAfter}
              dir="next"
            />
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1">
            {weekdays.map((w, i) => (
              <span
                key={`${w}-${i}`}
                className="grid h-7 place-items-center text-[10px] uppercase tracking-widest text-clay"
              >
                {w.slice(0, 2)}
              </span>
            ))}

            {cells.map((cell) => {
              const k = dayKey(cell.date);
              const off = blocked(k);
              return (
                <button
                  key={k}
                  type="button"
                  disabled={off}
                  onClick={() => {
                    onChange(k);
                    setOpen(false);
                  }}
                  className={cn(
                    "grid h-9 place-items-center rounded-xl text-[13px] lining-nums tabular-nums transition-colors duration-200",
                    k === selected
                      ? "bg-mocha-600 text-cream"
                      : off
                        ? "text-mocha-200"
                        : cell.outside
                          ? "text-mocha-300 hover:bg-cream-200"
                          : cell.sunday
                            ? "text-clay hover:bg-cream-200"
                            : "text-mocha-600 hover:bg-cream-200",
                    k === today && k !== selected && "ring-1 ring-mocha-400",
                  )}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-mocha-200 pt-4">
            <button
              type="button"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
              disabled={blocked(today)}
              className="text-[10px] uppercase tracking-widest text-mocha-500 transition-colors hover:text-mocha-600 disabled:text-mocha-200"
            >
              {t.common.today}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[10px] uppercase tracking-widest text-clay transition-colors hover:text-mocha-600"
            >
              {t.nav.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({
  onClick,
  label,
  dir,
}: {
  onClick: () => void;
  label: string;
  dir: "prev" | "next";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full border border-mocha-200 text-mocha-500 transition-colors hover:border-mocha-500"
    >
      <svg
        viewBox="0 0 12 8"
        aria-hidden
        className={cn("h-2 w-2", dir === "prev" ? "rotate-90" : "-rotate-90")}
      >
        <path
          d="M1 1l5 5 5-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

function CalendarMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="h-4 w-4 shrink-0 text-clay">
      <rect
        x="1.5"
        y="3.5"
        width="15"
        height="13"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M1.5 7.5h15M5.5 1.5v3M12.5 1.5v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---- the small amount of calendar arithmetic this needs ---- */

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
}

/** Six weeks from the Monday on or before the 1st, so the grid never reflows. */
function monthGrid(month: Date) {
  const first = startOfMonth(month);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead, 12);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
      12,
    );
    return {
      date,
      outside: date.getMonth() !== first.getMonth(),
      sunday: date.getDay() === 0,
    };
  });
}
