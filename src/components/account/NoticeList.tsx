"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Pager } from "@/components/ui/Pager";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

export type NoticeRow = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  important: boolean;
  read: boolean;
};

export type NoticeFilter = "all" | "unread" | "read";

export type NoticePageProps = {
  rows: NoticeRow[];
  total: number;
  page: number;
  pages: number;
  counts: { all: number; unread: number; read: number };
};

/**
 * Notices from the studio, in the member's own account.
 *
 * Unread ones are marked and carry the count that appears on the member's face
 * in the corner of every page. Opening one marks it read; there is also a
 * "mark all read" for somebody coming back after a fortnight away.
 *
 * Read state is per member and stored server side, so it follows them from
 * their phone to their laptop — which is the whole point of a notice in an
 * account rather than a browser notification.
 *
 * The list is bounded and scrolls inside itself rather than growing the page.
 * A member who has been with the studio a year will have a hundred of these,
 * and a hundred stacked cards would push their own settings so far down the page
 * that they would never find them. Bounded, the screen looks the same on day one
 * and in year three. The filter is there for the same reason: "unread" is the
 * question somebody actually arrives with.
 */
export function NoticeList({ notices }: { notices: NoticePageProps }) {
  const { t, fmtFullDate, locale } = useI18n();
  const n = t.notices;
  const router = useRouter();

  const [data, setData] = useState<NoticePageProps>(notices);
  const [filter, setFilter] = useState<NoticeFilter>("all");
  const [open, setOpen] = useState<string | null>(
    /* The newest unread one starts open: it is why they came. */
    notices.rows.find((x) => !x.read)?.id ?? null,
  );
  const [busy, setBusy] = useState(false);

  /**
   * Fetch one page.
   *
   * The server owns the filtering and the counting, which is the fix for a bug
   * that was not obvious: the list used to receive the most recent thirty
   * notices and filter them in the browser, so "3 unread" meant three unread
   * *within those thirty*, and a member with forty unread was told three. It
   * also meant the thirty-first message could never be reached at all.
   */
  const load = useCallback(
    async (next: { filter?: NoticeFilter; page?: number }) => {
      const f = next.filter ?? filter;
      const p = next.page ?? 1;
      setBusy(true);
      try {
        /* The language has to travel with the request. Both halves of every
           notice are stored; asking without saying which one you want gets you
           English, which is how a desk announcement written carefully in Greek
           came out in English for a member reading the site in Greek. */
        const res = await fetch(
          `/api/notices?filter=${f}&page=${p}&locale=${locale}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as NoticePageProps;
        setData(json);
        setFilter(f);
        setOpen(null);
      } finally {
        setBusy(false);
      }
    },
    [filter, locale],
  );

  /* Switching language re-reads the list. The server rendered the first page in
     whatever language the cookie said at the time, so without this the notices
     would stay in the old language until the next full navigation — which looks
     exactly like the Greek version never having been written. */
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load({ page: 1 });
    /* `load` is deliberately not a dependency: it changes with `filter` too, and
       a filter change already reloads on its own. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  async function mark(noticeId?: string) {
    setBusy(true);
    try {
      await fetch("/api/notices/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noticeId ? { noticeId } : {}),
      });
      /* Re-read rather than patch in place. Marking one read can move it out of
         the "unread" filter, change every count, and shrink the number of
         pages — guessing at all of that in the browser is how a list ends up
         disagreeing with itself. */
      await load({ page: noticeId ? data.page : 1 });
      /* Refreshes the layout, which is what takes the number off their face. */
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function toggle(row: NoticeRow) {
    const next = open === row.id ? null : row.id;
    setOpen(next);
    if (next && !row.read) void mark(row.id);
  }

  if (data.counts.all === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-mocha-200 px-6 py-10 text-center">
        <p className="text-sm text-clay">{n.empty}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h3 className="text-[13px] uppercase tracking-widest">
          {n.title}
          {data.counts.unread > 0 && (
            <span className="ml-3 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] text-[#8a6f1a] lining-nums tabular-nums">
              {data.counts.unread} {n.unread}
            </span>
          )}
        </h3>
        {/* Outlined, not ghost.

            It was text with a hover state, which on a phone is text: there is no
            hover, so nothing ever told anybody it could be pressed. It also sits
            beside a heading at almost the same size, which is the worst possible
            neighbour for a control. The border is the cheapest thing that says
            "button" without shouting, and it is the same outline the rest of the
            site uses for a secondary action. */}
        {data.counts.unread > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void mark()}
          >
            {n.markAll}
          </Button>
        )}
      </div>

      {/* Unread first, because that is the question people arrive with. */}
      <div className="mt-5 flex flex-wrap gap-2">
        {(
          [
            ["unread", n.filterUnread, data.counts.unread],
            ["all", n.filterAll, data.counts.all],
            ["read", n.filterRead, data.counts.read],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            data-notice-filter={key}
            aria-pressed={filter === key}
            disabled={busy}
            onClick={() => void load({ filter: key, page: 1 })}
            className={cn(
              "rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest transition-colors duration-300",
              filter === key
                ? "border-mocha-600 bg-mocha-600 text-cream"
                : "border-mocha-200 text-mocha-500 hover:border-mocha-400",
            )}
          >
            {label}
            <span className="ml-2 lining-nums tabular-nums opacity-70">
              {count}
            </span>
          </button>
        ))}
      </div>

      {data.rows.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-mocha-200 px-6 py-8 text-center text-sm text-clay">
          {filter === "unread" ? n.noneUnread : n.noneRead}
        </p>
      )}

      {/* Five at a time, so the page is the same height on day one and in year
          three, and no message is ever out of reach behind a scroll limit. */}
      <ul className="mt-5 space-y-3">
        {data.rows.map((row) => {
          const isOpen = open === row.id;
          return (
            <li
              key={row.id}
              className={cn(
                "overflow-hidden rounded-3xl border transition-colors",
                row.read
                  ? "border-mocha-200/70 bg-white/50"
                  : "border-gold/40 bg-gold/[0.05]",
              )}
            >
              <button
                onClick={() => toggle(row)}
                aria-expanded={isOpen}
                className="flex w-full items-start justify-between gap-4 px-6 py-5 text-left"
              >
                {/* min-w-0 lets this side shrink inside the flex row; without it
                    an unbroken 60-character word makes the whole card wider than
                    the phone and the page scrolls sideways. */}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2.5">
                    {!row.read && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                      />
                    )}
                    <span
                      className={cn(
                        "text-[15px] [overflow-wrap:anywhere]",
                        row.read ? "text-mocha-500" : "text-mocha-700",
                      )}
                    >
                      {row.title}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-[11px] uppercase tracking-widest text-clay">
                    {fmtFullDate(row.createdAt)}
                    {row.important ? ` · ${n.important}` : ""}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 shrink-0 text-clay transition-transform duration-300",
                    isOpen && "rotate-180",
                  )}
                >
                  <svg viewBox="0 0 12 8" className="h-2.5 w-2.5" fill="none">
                    <path
                      d="M1 1l5 5 5-5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </button>

              {isOpen && (
                <p className="whitespace-pre-line px-6 pb-6 text-[14px] leading-relaxed text-mocha-500 [overflow-wrap:anywhere]">
                  {row.body}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Pager
        page={data.page}
        pages={data.pages}
        total={data.total}
        busy={busy}
        onPage={(p) => void load({ page: p })}
        labels={{ newer: n.pagerNewer, older: n.pagerOlder, of: n.pagerOf }}
      />
    </div>
  );
}
