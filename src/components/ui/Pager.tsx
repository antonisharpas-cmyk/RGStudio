"use client";

import { cn } from "@/lib/utils";

/**
 * Newer ← page 3 of 12 → older.
 *
 * Deliberately not numbered buttons. Page 7 of a list of notices means nothing
 * to anybody — nobody remembers that the closure notice was on page 7 — whereas
 * "older" and "newer" are the two things a person actually wants, and they take
 * the same two taps on a phone as on a desktop. The count is there so the reader
 * knows how much is behind them, not to be clicked.
 *
 * Hidden entirely at one page, because a control that can only be disabled is
 * furniture.
 */
export function Pager({
  page,
  pages,
  total,
  onPage,
  busy,
  labels,
  className,
}: {
  page: number;
  pages: number;
  total?: number;
  onPage: (page: number) => void;
  busy?: boolean;
  labels: { newer: string; older: string; of: string };
  className?: string;
}) {
  if (pages <= 1) return null;

  const step = (to: number) => {
    if (to < 1 || to > pages || busy) return;
    onPage(to);
  };

  return (
    <nav
      data-pager
      aria-label={labels.of}
      className={cn("mt-5 flex items-center justify-between gap-4", className)}
    >
      <button
        type="button"
        data-pager-newer
        disabled={page <= 1 || busy}
        onClick={() => step(page - 1)}
        className={cn(
          "rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest transition-colors duration-300",
          page <= 1 || busy
            ? "cursor-not-allowed border-mocha-200/60 text-mocha-300"
            : "border-mocha-200 text-mocha-500 hover:border-mocha-400",
        )}
      >
        ← {labels.newer}
      </button>

      <p className="text-[10px] uppercase tracking-widest text-clay lining-nums tabular-nums">
        {labels.of
          .replace("{page}", String(page))
          .replace("{pages}", String(pages))
          .replace("{total}", String(total ?? ""))}
      </p>

      <button
        type="button"
        data-pager-older
        disabled={page >= pages || busy}
        onClick={() => step(page + 1)}
        className={cn(
          "rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest transition-colors duration-300",
          page >= pages || busy
            ? "cursor-not-allowed border-mocha-200/60 text-mocha-300"
            : "border-mocha-200 text-mocha-500 hover:border-mocha-400",
        )}
      >
        {labels.older} →
      </button>
    </nav>
  );
}
