"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Section } from "@/components/ui/Section";
import { BookingsPanel } from "@/components/admin/BookingsPanel";
import { ClosurePanel } from "@/components/admin/ClosurePanel";
import { DeskBar, DESK_TABS, type DeskTab } from "@/components/admin/DeskBar";
import { MemberDesk } from "@/components/admin/MemberDesk";
import { NoticePanel } from "@/components/admin/NoticePanel";
import { PricingPanel } from "@/components/admin/PricingPanel";
import { StatsRow } from "@/components/admin/StatsRow";
import { TeamPanel } from "@/components/admin/TeamPanel";
import { LogisticsPanel } from "@/components/admin/LogisticsPanel";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * The desk console: its own bar with the six tabs, and one panel below it.
 *
 * The shell holds almost nothing itself. Each tab is a panel that fetches its
 * own data behind the desk lock, which keeps this file readable and means a
 * locked console loads none of it. The one thing the shell owns is the notice
 * line, because every panel needs somewhere to say "done" and a member of staff
 * should not have to hunt for the confirmation.
 */
export function AdminBody({
  stats,
  packs,
  staffName,
  owner,
  scheduled,
  initialTab,
}: {
  /** Null for reception: the figures were never fetched for them. */
  stats: {
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
  } | null;
  packs: {
    id: string;
    slug: string;
    nameEn: string;
    nameEl: string;
    credits: number;
    priceCents: number;
    listPriceCents: number | null;
    discountLabelEn: string | null;
    discountLabelEl: string | null;
    basePriceCents: number;
    priceEdited: boolean;
  }[];
  staffName: string;
  /** The studio's own account: everything, including the numbers. */
  owner: boolean;
  /** Classes on the books, which reception is allowed to know. */
  scheduled: number;
  /**
   * The `?tab=` from the address, read on the server.
   *
   * Passed in rather than read from `window` so the first client render matches
   * the HTML that came down the wire — see the note in app/admin/page.tsx.
   */
  initialTab: string | null;
}) {
  const { t, fmtLongDate } = useI18n();
  const router = useRouter();

  /**
   * Reception gets two tabs. The owner gets all eight.
   *
   * Bookings and Members are the front desk's whole job: who is in the room,
   * who is on the phone, and taking their money. The other four are the
   * studio's own business — the timetable and its closures, messages to every
   * member at once, the price list, and the figures — and every one of them is
   * something a receptionist can change by accident and nobody notices for a
   * fortnight.
   *
   * **The route behind each of them refuses reception too.** That is the part
   * that matters and it was not true until now: `closures`, `generate`,
   * `notices` and `pricing` were all guarded with `desk()`, so a receptionist
   * with the browser's network tab open could change the price list of a studio
   * whose Pricing tab they could not see. They are `owner()` now. A tab that is
   * only hidden is not a restriction, which the previous version of this comment
   * said while being true of exactly one tab.
   */
  const RECEPTION_TABS = ["today", "members"] as const;
  const tabs = owner
    ? DESK_TABS
    : DESK_TABS.filter((x) =>
        (RECEPTION_TABS as readonly string[]).includes(x),
      );

  /**
   * The tab, kept in the URL.
   *
   * Two reasons, and the second is why it exists. First, the console survives a
   * refresh — press F5 on Members and you come back to Members, not to
   * Bookings. Second, anything that reloads the page deliberately can say where
   * to land: saving a member's profile reloads so the desk can see the change
   * took, and without this it dumped them on the Bookings tab, several clicks
   * from where they were working.
   *
   * `replaceState` rather than a route push: the tab is not a page, and pressing
   * back should leave the desk rather than shuffle through the tabs somebody
   * happened to look at.
   *
   * Read from `initialTab`, which the server put there. Reading it from
   * `window.location` here was a hydration mismatch — the server rendered
   * Bookings and the browser rendered Members, and React threw the tree away
   * and said so in a runtime error.
   */
  const [tab, setTabState] = useState<DeskTab>(() =>
    (tabs as readonly string[]).includes(initialTab ?? "")
      ? (initialTab as DeskTab)
      : "today",
  );

  const setTab = useCallback((next: DeskTab) => {
    setTabState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "today") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }, []);

  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Leaving the desk, properly.
   *
   * This used to lock the console and leave the session behind, so coming back
   * asked only for a password — which is wrong for a machine two people share.
   * Whoever sits down next is not necessarily whoever stood up, and the next
   * person should be asked who they are, not just to prove they are the last
   * one. So both go: the desk unlock and the sign-in itself.
   */
  async function signOut() {
    await Promise.all([
      fetch("/api/admin/lock", { method: "POST" }),
      fetch("/api/auth/logout", { method: "POST" }),
    ]);
    router.refresh();
  }

  return (
    <>
      <DeskBar
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        onLock={signOut}
        staffName={staffName}
      />

      <Section className="pt-10 md:pt-12">
        {/* The marker the HTTP suite looks for: it proves a locked /admin
            renders none of this, not merely that it renders a form somewhere. */}
        <div className="container-x" data-desk-console="">
          <p className="eyebrow mb-4">
            {/* Reception is not "studio admin", and being told they are invites
                them to look for the parts they cannot see. */}
            {owner ? t.admin.title : t.desk.lockedTitle}
            <span className="ml-3 normal-case tracking-normal text-clay">
              {t.desk.lockedFor} {staffName}
            </span>
          </p>
          <h1 className="h-display text-[2.4rem] leading-tight sm:text-5xl">
            {tab === "analytics" || tab === "logistics" || tab === "team" || tab === "pricing"
              ? t.desk.tabs[tab]
              : fmtLongDate(new Date())}
          </h1>

          {notice && (
            <p className="mt-8 rounded-2xl border border-mocha-300 bg-white px-5 py-4 text-sm text-mocha-600">
              {notice}
            </p>
          )}

          {tab === "today" && <BookingsPanel onNotice={setNotice} />}
          {tab === "members" && (
            <MemberDesk onNotice={setNotice} owner={owner} />
          )}
          {tab === "timetable" && (
            <ClosurePanel onNotice={setNotice} scheduled={scheduled} />
          )}
          {tab === "notices" && <NoticePanel onNotice={setNotice} />}
          {tab === "pricing" && (
            <PricingPanel packs={packs} onNotice={setNotice} />
          )}
          {tab === "team" && <TeamPanel onNotice={setNotice} />}
          {/* The numbers are a tab of their own, not a banner over the others.
              They are read deliberately — at the end of a month, or when the
              owner asks — and a permanent row of takings above every screen is
              both a distraction from the job in hand and a set of figures on
              display in a public room. */}
          {tab === "analytics" && stats && <StatsRow initial={stats} />}
          {tab === "logistics" && <LogisticsPanel />}
        </div>
      </Section>
    </>
  );
}
