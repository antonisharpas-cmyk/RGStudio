"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Coming back to the installed app opens the homepage, not wherever you left.
 *
 * ---
 *
 * **Why `start_url` is not the answer.**
 *
 * The manifest already says `start_url: "/"`, and it is correct: a genuine cold
 * start does open the homepage. But a phone almost never cold-starts an
 * installed web app. It *suspends* it and *resumes* it, and on resume both iOS
 * and Android restore the page you were last on and never look at the manifest
 * again. So the studio's members were reopening the app onto their own profile
 * notices, or onto the sign-up form, depending on whether they were signed in
 * — which is exactly the screen they had been on hours earlier.
 *
 * There is no manifest field for this. It has to be handled when the app comes
 * back into view.
 *
 * ---
 *
 * **Why a threshold, and why thirty minutes.**
 *
 * The naive version redirects every time the app becomes visible, and it is
 * genuinely worse than the bug. Switching to WhatsApp to paste a confirmation
 * code, glancing at the clock, taking a call halfway through choosing a class
 * — all of those hide the app for a few seconds, and all of them would come
 * back to the homepage with the booking abandoned. People blame the website for
 * that, correctly.
 *
 * Thirty minutes is the line between "I looked at something else" and "I am
 * back later". Above it, opening the app is a new visit and the homepage is
 * where a new visit starts.
 *
 * ---
 *
 * **Three places it deliberately does nothing.**
 *
 * `/checkout` — somebody is in the middle of paying. Interrupting that could
 *   cost the studio the sale and the member their confidence, and a card form
 *   that vanishes while you are reading your phone for the SMS code is the
 *   single worst moment to be helpful.
 *
 * `/admin` — the desk. Reception leaves the tab open all day between members,
 *   and their own fifteen-minute idle lock already covers the real risk there.
 *
 * `/verify` — waiting on the emailed code, which means switching to the mail
 *   app, which means being away for exactly as long as the email takes to
 *   arrive.
 *
 * Browser tabs are left alone too: this only runs in the installed app. A tab
 * that quietly navigated itself home while sitting in the background would be
 * a different and stranger bug.
 */

/** Away longer than this and the next look counts as a new visit. */
const AWAY_MS = 30 * 60 * 1000;

/** Paths where somebody is mid-task and must not be moved. */
const LEAVE_ALONE = ["/checkout", "/admin", "/verify"];

export function ResumeHome() {
  const router = useRouter();

  useEffect(() => {
    /* The installed app, by either spelling: the standards one, and Safari's
       own property, which iOS set long before it supported display-mode and
       still reports. */
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true;
    if (!installed) return;

    let hiddenAt: number | null = null;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }

      /* Visible without having been hidden first happens on the very first
         paint. Nothing to compare against, and nothing to do. */
      if (hiddenAt === null) return;

      const away = Date.now() - hiddenAt;
      hiddenAt = null;
      if (away < AWAY_MS) return;

      /* Read from the browser rather than from a `usePathname()` dependency,
         so this listener is attached once for the life of the app instead of
         being torn down and rebuilt on every navigation. */
      const here = window.location.pathname;
      if (here === "/") return;
      if (LEAVE_ALONE.some((p) => here.startsWith(p))) return;

      /* `replace`, not `push`: the page they were on half an hour ago has no
         business being one back-swipe away from the homepage they just opened. */
      router.replace("/");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [router]);

  return null;
}
