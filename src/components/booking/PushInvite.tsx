"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";
import {
  askAndSubscribe,
  pushPermission,
  supportsPush,
} from "@/lib/push-client";

/**
 * The one time the studio asks about notifications, and it asks after a booking.
 *
 * The permission lived only in the profile, on a screen a member visits once to
 * upload a photograph and then never again — so almost nobody had notifications
 * on, and the studio's ability to say "tonight's class is cancelled" reached
 * about as far as its ability to phone forty people.
 *
 * The moment to ask is the moment the answer means something. Somebody who has
 * just booked a class has, thirty seconds ago, expressed an interest in what
 * happens to that class: "shall we tell you if this changes?" is a question
 * about the thing in front of them, not a request for a permission in the
 * abstract. Which is also why the wording is about the class and not about
 * notifications.
 *
 * Asked once, and taking no for an answer:
 *
 *   - It appears after a booking, not on arrival. A prompt on page load is the
 *     thing every website does and every member dismisses, and Chrome now
 *     penalises a site whose prompts are repeatedly dismissed by refusing to
 *     show them at all — so a badly-timed ask does not merely fail, it burns
 *     the only chance there was.
 *   - "Not now" is remembered, in this browser, and this panel does not come
 *     back. Not on the account: the permission is per-device, so a member who
 *     said not now on their laptop should still be asked on their phone, where
 *     the answer is worth something. That is what makes localStorage the right
 *     store here rather than a column, and it is the only thing it is used for.
 *   - It never appears once the answer is known. Granted needs nothing;
 *     "denied" cannot be undone from a page — only the member, in their browser
 *     settings — and a panel that says "click allow" when no prompt will ever
 *     appear is the most irritating thing an app can do. The profile explains
 *     that case properly, and this points at it.
 */
const SNOOZE_KEY = "rg_push_invite_dismissed";

export function PushInvite({
  publicKey,
  /** Set by the timetable the moment a booking succeeds. */
  show,
}: {
  publicKey: string;
  show: boolean;
}) {
  const { t } = useI18n();
  const p = t.profile;

  const [state, setState] = useState<
    "hidden" | "asking" | "busy" | "done" | "refused"
  >("hidden");

  useEffect(() => {
    if (!show) return;
    if (!supportsPush(publicKey)) return;
    /* Only the never-asked case. Granted is already the outcome we wanted, and
       denied is not ours to reopen. */
    if (pushPermission() !== "default") return;
    try {
      if (window.localStorage.getItem(SNOOZE_KEY)) return;
    } catch {
      /* A browser with storage switched off gets asked. Once per page rather
         than once per device is a fair trade for not silently never asking. */
    }
    setState("asking");
  }, [show, publicKey]);

  async function yes() {
    setState("busy");
    try {
      const answer = await askAndSubscribe(publicKey);
      setState(answer === "granted" ? "done" : "refused");
      /* Whatever they said to the browser, this panel has had its turn: a
         member who dismissed the browser's own prompt does not want ours
         offering it again. */
      remember();
    } catch {
      setState("refused");
    }
  }

  function later() {
    remember();
    setState("hidden");
  }

  function remember() {
    /* Written only because they just pressed "not now", which is the same
       reason the language cookie needs no banner: the visitor asked for it by
       declining. It holds a date, it never leaves the device, and clearing the
       site's storage in the browser removes it. */
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* Nothing to do about it and nothing worth saying. */
    }
  }

  if (state === "hidden") return null;

  if (state === "done") {
    return (
      <div className="mt-4 rounded-2xl border border-mocha-200/70 bg-cream-200/40 p-4">
        <p className="text-[13px] text-mocha-600">{p.pushInviteDone}</p>
      </div>
    );
  }

  if (state === "refused") {
    return (
      <div className="mt-4 rounded-2xl border border-mocha-200/70 bg-cream-200/40 p-4">
        <p className="text-[13px] text-mocha-600">{p.pushInviteProfile}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-mocha-200/70 bg-cream-200/40 p-4">
      <p className="text-[14px] font-medium text-mocha-700">
        {p.pushInviteTitle}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-mocha-600">
        {p.pushInviteBody}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={state === "busy"} onClick={yes}>
          {state === "busy" ? t.common.loading : p.pushInviteYes}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={state === "busy"}
          onClick={later}
        >
          {p.pushInviteLater}
        </Button>
      </div>
    </div>
  );
}
