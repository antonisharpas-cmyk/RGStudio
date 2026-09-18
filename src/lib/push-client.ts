/**
 * The browser half of push, in one place.
 *
 * Two screens now ask for the same permission — the switch in the profile and
 * the offer made after a first booking — and they must not each carry their own
 * copy of this. The subscribe path in particular has one hard-won detail in it:
 * the endpoint is re-sent to the server on every visit, because a browser holds
 * one push subscription and an account is a different thing, and a laptop that
 * two people sign into would otherwise leave the second of them with no device
 * at all while both screens said notifications were on.
 *
 * Client-only. Every function here touches `navigator` or `Notification` and
 * will throw on the server, which is why the components that use it are
 * "use client" and check `supportsPush()` before anything else.
 */

/**
 * Whether this browser can do push at all.
 *
 * The interesting case is an iPhone: Safari has `PushManager` only inside an
 * installed Home Screen web app, so this is false in a Safari tab on iOS and
 * true after the member has added the site to their Home Screen and opened it
 * from the icon. That is Apple's rule, not ours, and there is no way to ask for
 * the permission before it is satisfied — see src/app/manifest.ts.
 */
export function supportsPush(publicKey: string) {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined" &&
    Boolean(publicKey)
  );
}

/** "default" | "granted" | "denied", or null on a browser that cannot. */
export function pushPermission(): NotificationPermission | null {
  if (typeof Notification === "undefined") return null;
  return Notification.permission;
}

/**
 * Register this browser with the studio. Assumes permission is granted.
 *
 * Idempotent on purpose: an existing subscription is reused rather than
 * replaced, and the server upserts on the endpoint, so calling this on every
 * visit costs one small request and keeps the row pointing at whoever is
 * actually signed in.
 */
export async function subscribeThisBrowser(publicKey: string) {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const raw = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: raw.endpoint,
      p256dh: raw.keys?.p256dh,
      auth: raw.keys?.auth,
    }),
  });
  if (!res.ok) throw new Error("SUBSCRIBE_FAILED");
}

/**
 * Ask, then register. Returns what the member said.
 *
 * The prompt has to come from a press — Safari requires a user gesture and
 * Chrome starts ignoring pages that ask without one — so this is only ever
 * called from a click handler, never from an effect.
 */
export async function askAndSubscribe(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  await subscribeThisBrowser(publicKey);
  return permission;
}

/** The VAPID key travels as base64url and the browser wants raw bytes. */
export function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normal);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
