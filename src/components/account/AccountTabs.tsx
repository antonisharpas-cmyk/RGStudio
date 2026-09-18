"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

export type AccountTab =
  | "profile"
  | "notifications"
  | "upcoming"
  | "password"
  | "classes"
  | "payments"
  | "activity";

/**
 * The order they appear in, here and in the header menu. One list so the two
 * can never drift apart.
 */
/**
 * The order the studio asked for: what a member looks at most, first.
 *
 * Password sits at the end because it is the one thing here nobody opens on
 * purpose — they open it once, when something is wrong.
 *
 * The three that are about classes run in time order: what is coming, what has
 * been, and then the sessions ledger that explains both. Upcoming sits third,
 * straight after Notifications, where the studio asked for it. It used to be a permanently open list above
 * this bar, which is fine for the member with two bookings and not for the one
 * with sixteen: a member opening their account to change a password scrolled
 * past every class they had booked to get to the pills. It is a panel like the
 * rest now, and the count on the pill is what it left behind — you can see how
 * many are coming without opening it.
 */
export const ACCOUNT_TABS: AccountTab[] = [
  "profile",
  "notifications",
  "upcoming",
  "classes",
  "activity",
  "payments",
  "password",
];

/** Guards `?tab=` from the address bar, which anyone can type. */
export function isAccountTab(value: unknown): value is AccountTab {
  return (
    typeof value === "string" && ACCOUNT_TABS.includes(value as AccountTab)
  );
}

/**
 * The sub-sections of a member's account.
 *
 * A scrolling row of pills rather than a sidebar: there are seven of them, the
 * page is already narrow on a phone, and a member arrives wanting one thing —
 * usually their balance, which stays above this. The count badge on Classes
 * and Payments is there so nobody has to open an empty tab to find out it is
 * empty.
 */
export function AccountTabs({
  active,
  onChange,
  counts,
  unread = 0,
  needsAttention,
}: {
  active: AccountTab;
  onChange: (t: AccountTab) => void;
  counts: {
    classes: number;
    payments: number;
    activity: number;
    upcoming: number;
  };
  /** Unread studio notices, shown on the Notifications pill. */
  unread?: number;
  /** Marks Profile when there is something worth the member's attention. */
  needsAttention?: boolean;
}) {
  const { t } = useI18n();
  const a = t.accountTabs;
  const row = useRef<HTMLDivElement>(null);
  /* Whether there is anything further along to scroll to — the fade at the
     edge is drawn only then, so it never sits as a smudge over the last pill. */
  const [more, setMore] = useState(false);

  /**
   * Six pills do not fit across a phone, so the row scrolls. That is fine for a
   * thumb, but not for a section chosen somewhere else — the header menu links
   * straight to Payments, and the pill for it starts off-screen. Centre whichever
   * one is live.
   *
   * The row is scrolled directly rather than by asking the browser to bring the
   * pill into view, and that is the entire point of this code. `scrollIntoView`
   * moves whatever ancestor it has to, including the page: on a desktop, where
   * the pills sit nine hundred pixels down, it dragged the whole account page
   * down 249 pixels the moment it loaded — cutting the member's own name off
   * behind the header, on the one screen that opens with a greeting. `block:
   * "nearest"` does not prevent that; it only makes it the smallest possible
   * amount, and the smallest possible amount was still 249 pixels.
   *
   * Setting `scrollLeft` on the row can only ever move the row.
   */
  useEffect(() => {
    const el = row.current;
    const pill = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !pill) return;

    /* Already comfortably in view: leave it alone rather than nudging the row
       under somebody's thumb. */
    const left = pill.offsetLeft;
    const right = left + pill.offsetWidth;
    if (left >= el.scrollLeft && right <= el.scrollLeft + el.clientWidth) return;

    el.scrollTo({
      left: Math.max(0, left - (el.clientWidth - pill.offsetWidth) / 2),
      behavior: "smooth",
    });
  }, [active]);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () =>
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  /* Keyed by tab rather than listed in order, and then mapped over
     ACCOUNT_TABS. There used to be two lists — this one and ACCOUNT_TABS — which
     meant the pills and the header menu could disagree about the order, and
     they did. One list decides it now. */
  const meta: Record<
    AccountTab,
    {
      label: string;
      count?: number;
      dot?: boolean;
      /** Unread notices are worth an accent; a count of past classes is not. */
      gold?: boolean;
    }
  > = {
    profile: { label: a.profile, dot: needsAttention },
    notifications: { label: a.notifications, count: unread, gold: unread > 0 },
    /* Counted but not accented. Gold is reserved for something the studio is
       waiting on the member for, and a class they have already booked is the
       opposite of that. */
    upcoming: { label: a.upcoming, count: counts.upcoming },
    activity: { label: a.activity, count: counts.activity },
    classes: { label: a.classes, count: counts.classes },
    payments: { label: a.payments, count: counts.payments },
    password: { label: a.password },
  };

  const tabs = ACCOUNT_TABS.map((id) => ({ id, ...meta[id] }));

  return (
    <div className="relative -mx-6 md:mx-0">
      <div
        ref={row}
        role="tablist"
        aria-label={a.label}
        className="no-scrollbar flex gap-2 overflow-x-auto px-6 md:px-0"
      >
        {tabs.map((tab) => {
          const on = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative shrink-0 rounded-full border px-4 py-2 text-[11px] uppercase tracking-widest transition-all duration-400 ease-silk",
                on
                  ? "border-mocha-600 bg-mocha-600 text-cream"
                  : "border-mocha-200/70 bg-white/50 text-mocha-500 hover:border-mocha-400",
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={cn(
                    "ml-2 lining-nums tabular-nums",
                    tab.gold
                      ? on
                        ? "text-cream"
                        : "rounded-full bg-gold/20 px-1.5 text-[#8a6f1a]"
                      : on
                        ? "text-cream/60"
                        : "text-clay",
                  )}
                >
                  {tab.count}
                </span>
              )}
              {tab.dot && !on && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* A phone shows three and a half pills. The row scrolls, and this fade
          at the edge is what says so — without it a cut-off pill reads as a
          layout fault rather than an invitation to swipe. It disappears at the
          end of the row, so the last pill is never dimmed by it. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-cream via-cream/80 to-transparent transition-opacity duration-300 md:hidden",
          more ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
