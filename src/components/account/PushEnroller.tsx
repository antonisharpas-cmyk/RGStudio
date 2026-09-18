"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";
import { subscribeThisBrowser, supportsPush } from "@/lib/push-client";

/**
 * Turning push notifications on, for this device.
 *
 * The studio's side of push is always on and there is no switch to turn it off.
 * This is the other side: the browser's permission, which we cannot grant on
 * anybody's behalf and cannot take back. Each device is separate — a member's
 * phone and their laptop are two grants — so this reports on the device in front
 * of them rather than pretending there is one global setting.
 *
 * Pressing the button is a once-ever thing per device, not a routine. Once the
 * browser has been told to allow it, this subscribes on its own on every later
 * visit — the permission is what the member gave, and asking them to press a
 * button again to act on a permission they already granted is asking twice.
 *
 * The states it has to be honest about:
 *   unsupported   an old browser, or an iPhone that has not added the site to
 *                 the Home Screen — Safari does not offer push until it has
 *   default       never asked; the button asks
 *   granted       subscribed, and it says which device count is live
 *   denied        the member said no, and only they can undo that in browser
 *                 settings. We cannot re-prompt, and saying "click allow" when
 *                 no prompt will appear is the most annoying thing an app does.
 */
export function PushEnroller({ publicKey }: { publicKey: string }) {
  const { t } = useI18n();
  const p = t.profile;

  const [state, setState] = useState<
    "checking" | "unsupported" | "default" | "granted" | "denied" | "busy"
  >("checking");
  const [devices, setDevices] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<"ok" | "fail" | null>(null);

  /* refresh() needs subscribe(), and subscribe() is declared after it. A ref
     breaks the cycle without reordering the file into something less readable. */
  const subscribeRef = useRef<(() => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    if (!supportsPush(publicKey)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "granted" : "default");
      /* Register on every visit, whether or not this browser already has a
         subscription.
         *
         * The subtle case, and a real bug found the hard way: a browser holds one
         * push subscription, but an account is a different thing. Somebody who
         * turns notifications on as one member and later signs in as another —
         * an owner testing with a second account, a couple sharing a laptop —
         * used to leave the second account with no device at all, while this
         * screen cheerfully said "on for this device", because a subscription
         * existed and nothing checked whose it was. The second member then
         * received nothing, silently, and there was no way to tell from here.
         *
         * Sending it again is cheap and idempotent, and the server moves the
         * endpoint to whoever is signed in now — which is the right answer,
         * because that is who is sitting in front of it. */
      if (sub || Notification.permission === "granted") {
        try {
          await subscribeRef.current?.();
          setState("granted");
        } catch {
          setState(sub ? "granted" : "default");
        }
      }
    } catch {
      setState("default");
    }
    try {
      const res = await fetch("/api/push/subscribe");
      if (res.ok) {
        const data = (await res.json()) as { devices?: number };
        setDevices(data.devices ?? 0);
      }
    } catch {
      /* The count is a nicety; its absence is not worth a message. */
    }
  }, [publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Registers this browser with the studio. Assumes permission is granted. */
  const subscribe = useCallback(
    () => subscribeThisBrowser(publicKey),
    [publicKey],
  );

  useEffect(() => {
    subscribeRef.current = subscribe;
  }, [subscribe]);

  async function enable() {
    setState("busy");
    setError(null);
    try {
      /* The permission prompt has to come from a press: Safari requires it, and
         Chrome starts ignoring pages that ask without one. */
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "default");
        return;
      }
      await subscribe();
      await refresh();
      setState("granted");
    } catch (e) {
      setError((e as Error).message);
      setState("default");
    }
  }

  async function sendTest() {
    setTesting(true);
    setTested(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      setTested(res.ok ? "ok" : "fail");
    } catch {
      setTested("fail");
    } finally {
      setTesting(false);
    }
  }

  /* Nothing at all while we do not know yet, and nothing on a browser that
     cannot do this: an explanation of somebody else's browser is not something
     they can act on, and it was the longest thing on the screen. */
  if (state === "checking" || state === "unsupported") return null;

  const line =
    state === "granted"
      ? devices > 1
        ? p.pushOnDevices.replace("{n}", String(devices))
        : p.pushOnThisDevice
      : state === "denied"
        ? p.pushBlocked
        : p.pushOffThisDevice;

  return (
    <div className="mt-4 rounded-2xl border border-mocha-200/70 bg-cream-200/40 p-4">
      <p className="text-[12px] leading-relaxed text-mocha-600">{line}</p>

      {(state === "default" || state === "busy") && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={state === "busy"}
          onClick={enable}
        >
          {state === "busy" ? t.common.loading : p.pushEnable}
        </Button>
      )}

      {state === "granted" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={testing}
            onClick={sendTest}
          >
            {testing ? t.common.loading : p.pushTest}
          </Button>
          {tested === "ok" && (
            <span className="text-[12px] text-mocha-500">{p.pushTestSent}</span>
          )}
          {tested === "fail" && (
            <span className="text-[12px] text-red-700">{p.pushTestFailed}</span>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-[12px] text-red-700">{error}</p>}
    </div>
  );
}
