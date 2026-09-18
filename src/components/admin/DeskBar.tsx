"use client";

import { useEffect, useRef, useState } from "react";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { Button } from "@/components/ui/Button";
import { Chevron } from "@/components/ui/Chevron";
import { Wordmark } from "@/components/ui/Wordmark";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

export const DESK_TABS = [
  "today",
  "members",
  "timetable",
  "notices",
  "pricing",
  "team",
  "analytics",
  "logistics",
] as const;

export type DeskTab = (typeof DESK_TABS)[number];

/**
 * The desk's own top bar, in place of the website's.
 *
 * The tabs are the whole of the navigation here, and on a wide screen they sit
 * where a browser's tabs would: at the top, always in the same place, always
 * visible. Which tabs appear depends on who is signed in — reception has five,
 * the owner six. The bar sticks to the top of the window so that scrolling
 * down a long roster never means scrolling back up to change tab.
 *
 * The wordmark is deliberately not a link. There is nothing on the public site
 * the desk needs while it is working, and a logo that navigates away is a logo
 * that eventually loses somebody's half-finished notice.
 *
 * ---
 *
 * **Below `lg` the tabs become one button and a menu, and that is a fix rather
 * than a preference.**
 *
 * Six tabs, a 132px wordmark, a language toggle and a Log out button do not fit
 * across a phone. They used to be a horizontally scrolling row, which sounds
 * reasonable and is not: at 390px the row showed about two and a half pills, so
 * reaching Analytics meant swiping a strip of buttons that is 44px tall while
 * every pill under the thumb is a live navigation. Aiming at a target in a
 * scrolling container is the one interaction a thumb is worst at, and picking
 * the wrong tab at the desk means losing whatever was half typed.
 *
 * One button in the corner is a single fixed target, and the menu that opens
 * gives every section a full-width row. It also names the section you are in on
 * the button itself, which the scrolling row could not do once the live pill had
 * scrolled out of sight.
 *
 * Log out moves into the bottom of that menu, with the staff name and the
 * language toggle, because it is the one thing here nobody presses by accident
 * on purpose: on the old bar it sat next to the tabs at the same size, one
 * thumb-width from Analytics.
 *
 * The desktop row keeps `data-desk-tab`, which is what the desk suite reads to
 * check that reception's bar has no Pricing or Analytics on it. The menu rows
 * carry `data-desk-pick` instead, so a selector for one can never match both.
 */
export function DeskBar({
  tabs,
  tab,
  onTab,
  onLock,
  staffName,
}: {
  /** Which tabs this person has. Reception's bar has no Analytics. */
  tabs: readonly DeskTab[];
  tab: DeskTab;
  onTab: (t: DeskTab) => void;
  onLock: () => void;
  staffName: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  /**
   * Escape closes it, and so does a press anywhere else.
   *
   * `pointerdown` rather than `click`: the desk is a touch screen on a counter,
   * and on a tap the menu should be gone before the finger lifts. Both
   * listeners are only attached while it is open, so a closed menu costs
   * nothing on a page that re-renders as often as the roster does.
   */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
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

  return (
    <header className="sticky top-0 z-30 border-b border-mocha-200/70 bg-cream/95 backdrop-blur-md">
      <div className="container-x flex h-20 items-center gap-4 lg:gap-6">
        <span className="shrink-0" aria-label="RG Pilates Studio">
          <Wordmark className="w-[132px]" priority />
        </span>

        {/* Wide screens: the whole row, no menu, nothing hidden. */}
        <nav
          aria-label={t.admin.title}
          className="-mx-2 hidden flex-1 items-center gap-1 px-2 lg:flex"
        >
          {tabs.map((key) => (
            <button
              key={key}
              data-desk-tab={key}
              onClick={() => onTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-4 py-2.5 text-[10px] uppercase tracking-widest transition-colors duration-300",
                tab === key
                  ? "bg-mocha-600 text-cream"
                  : "text-mocha-500 hover:bg-cream-200 hover:text-mocha-600",
              )}
            >
              {t.desk.tabs[key]}
            </button>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-3 lg:flex">
          <span className="text-[11px] text-clay">{staffName}</span>
          <LanguageToggle />
          {/* One press to leave the desk properly: the console locks and the
              session ends, so the next person at this shared machine is asked
              who they are rather than just asked to prove they are the last
              one. */}
          <Button size="sm" variant="outline" onClick={onLock}>
            {t.desk.lock}
          </Button>
        </div>

        {/* Narrow screens: one target in the corner. */}
        <div className="relative ml-auto lg:hidden" ref={menu}>
          <button
            type="button"
            data-desk-menu
            aria-expanded={open}
            aria-controls="desk-menu"
            onClick={() => setOpen((v) => !v)}
            /* The section you are in is the label. A menu button that says
               "Menu" makes you open it to find out where you are. */
            /* py-3.5 rather than the 2.5 the desktop pills use: this is the
               one target on the bar and it is aimed at with a thumb, so it
               clears 44px rather than landing just under it at 37. */
            className="flex items-center gap-2.5 rounded-full border border-mocha-300 bg-white/60 px-4 py-3.5 text-[10px] uppercase tracking-widest text-mocha-600 transition-colors duration-300 hover:border-mocha-400"
          >
            {t.desk.tabs[tab]}
            <Chevron
              className={cn(
                "text-clay transition-transform duration-300",
                open && "rotate-180",
              )}
            />
          </button>

          {/* Kept mounted and toggled with CSS, the same way the member menu in
              the header is, so the desk console ships no animation library
              either. */}
          <div
            id="desk-menu"
            role="menu"
            aria-hidden={!open}
            className={cn(
              "absolute right-0 top-[calc(100%+0.65rem)] z-50 w-56 rounded-3xl border border-mocha-200 bg-cream p-2 shadow-lift transition-all duration-300 ease-silk",
              open
                ? "visible translate-y-0 opacity-100"
                : "invisible -translate-y-1 opacity-0",
            )}
          >
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                data-desk-pick={key}
                tabIndex={open ? 0 : -1}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => {
                  onTab(key);
                  setOpen(false);
                }}
                className={cn(
                  "block w-full rounded-2xl px-4 py-3.5 text-left text-[11px] uppercase tracking-widest transition-colors duration-300",
                  tab === key
                    ? "bg-mocha-600 text-cream"
                    : "text-mocha-500 hover:bg-cream-200 hover:text-mocha-700",
                )}
              >
                {t.desk.tabs[key]}
              </button>
            ))}

            <div className="my-1.5 h-px bg-mocha-200/70" />

            {/* Who is signed in, and the language, on one line. Neither is
                navigation, so neither is a menu item. */}
            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="truncate text-[11px] text-clay">
                {staffName}
              </span>
              <LanguageToggle />
            </div>

            <div className="my-1.5 h-px bg-mocha-200/70" />

            {/* Last, and on its own, which is the whole reason it moved here. */}
            <button
              type="button"
              role="menuitem"
              data-desk-lock
              tabIndex={open ? 0 : -1}
              onClick={() => {
                setOpen(false);
                onLock();
              }}
              className="block w-full rounded-2xl px-4 py-3.5 text-left text-[11px] uppercase tracking-widest text-mocha-600 transition-colors duration-300 hover:bg-cream-200 hover:text-mocha-700"
            >
              {t.desk.lock}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
