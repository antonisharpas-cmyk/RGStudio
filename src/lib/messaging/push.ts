import webpush from "web-push";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import type { Outgoing, SendResult } from "./types";

/**
 * Web push: the only channel with no bill attached, and the only one we do not
 * control.
 *
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   npm run push:keys
 *   VAPID_SUBJECT=mailto:info@rgpilatesstudio.com
 *
 * There is no company in the middle to sign up with — the message goes straight
 * to Google's, Apple's or Mozilla's push service, signed with our own keys. What
 * we cannot do is make it mandatory. The browser asks the member for permission
 * and the member, or their operating system, can withdraw it at any time
 * without telling us. So "push is always on" is a promise about *our* side: we
 * never turn it off for them and there is no switch to turn it off. Whether a
 * given phone actually rings is between the member and their phone.
 *
 * Two consequences worth knowing:
 *  - A member with no granted permission has no subscription row, so push
 *    simply skips them. They still get the notice in the app.
 *  - On iPhone, web push only works once the site has been added to the Home
 *    Screen. Until then Safari will not even offer the permission prompt.
 */

let configured: boolean | null = null;

function ready() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  /**
   * Set, but that does not mean valid.
   *
   * A VAPID key is a specific 65-byte thing, and `setVapidDetails` throws if it
   * is given anything else. A placeholder typed into a hosting provider's
   * environment panel while waiting for the real keys is exactly that: present,
   * and not a key. Left to throw, it took down every request that touched push —
   * which on a page load means a 500 in the console and a member who cannot
   * register, for the sake of a notification.
   *
   * Push is the most optional thing this site does. An unusable key means push
   * is off, said once in the log, and nothing else changes: members still get
   * every notice in the app, and the reminders still send by email. Treating a
   * bad key as "off" rather than as "fail" is the only proportionate answer.
   */
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:info@rgpilatesstudio.com",
      pub,
      priv,
    );
  } catch (e) {
    console.error(
      "[push] VAPID keys are set but not usable, so push is off. Generate a real pair with `npm run push:keys`.",
      (e as Error).message,
    );
    configured = false;
    return false;
  }
  configured = true;
  return true;
}

export function pushReady() {
  return ready();
}

export function pushPublicKey() {
  /* Only a key the server could actually sign with is worth handing to the
     browser. A placeholder returned from here reaches the enrolment button,
     which then fails inside the browser's own push API with a message about
     byte lengths — a mystery in the member's console instead of a feature that
     is quietly off. Empty means "do not offer it", which the panel already
     understands. */
  if (!ready()) return "";
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/* ------------------------------------------------------------- subscriptions */

export function saveSubscription(args: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  /* One row per browser. Re-subscribing the same browser — which happens when
     the push service rotates its keys — updates the row rather than piling up
     duplicates that would each deliver the same notification. */
  return db
    .insert(pushSubscriptions)
    .values({
      userId: args.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: (args.userAgent ?? "").slice(0, 200),
      failures: 0,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: args.userId,
        p256dh: args.p256dh,
        auth: args.auth,
        failures: 0,
      },
    })
    .returning()
    .get();
}

/**
 * Remove a device's subscription.
 *
 * `userId` scopes the delete to the caller's own devices when a member is
 * unsubscribing, so one member cannot drop another's subscription by its
 * endpoint. It is left off only for the internal cleanup path (a push service
 * reporting a dead endpoint), which is not acting for any particular member.
 */
export function dropSubscription(endpoint: string, userId?: string) {
  return (
    db
      .delete(pushSubscriptions)
      .where(
        userId
          ? and(
              eq(pushSubscriptions.endpoint, endpoint),
              eq(pushSubscriptions.userId, userId),
            )
          : eq(pushSubscriptions.endpoint, endpoint),
      )
      .run().changes > 0
  );
}

export function deviceCount(userId: string) {
  return Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .get()?.n ?? 0,
  );
}

export function subscriptionsFor(userIds: string[]) {
  if (userIds.length === 0) return [];
  const set = new Set(userIds);
  return db
    .select()
    .from(pushSubscriptions)
    .all()
    .filter((s) => set.has(s.userId));
}

/* --------------------------------------------------------------------- send */

export async function sendPush(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  msg: Outgoing,
): Promise<SendResult> {
  if (!ready()) return { ok: false, error: "NOT_CONFIGURED" };

  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify({
        title: msg.subject,
        body: msg.body.slice(0, 300),
        url: msg.url ?? "/account?tab=notifications",
        /* A unique tag per notification, so each one stacks on the phone rather
           than replacing the one before it. The service worker falls back to the
           title as the tag when none is sent (see public/sw.js), and titles
           repeat — "Payment received", "Booking confirmed", "Your class
           tomorrow" — so two notices of the same kind shared a tag and the
           second silently overwrote the first. A member paid twice and saw one
           receipt notification. Uniqueness is per send: every message is its own
           line in the tray. The cost is that nothing supersedes an earlier
           notice any more (a reminder no longer updates in place), which for a
           studio this size is the behaviour the owner actually wants. */
        tag: crypto.randomUUID(),
      }),
      { TTL: 60 * 60 * 24 },
    );
    db.update(pushSubscriptions)
      .set({ lastSentAt: new Date(), failures: 0 })
      .where(eq(pushSubscriptions.id, sub.id))
      .run();
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    /* 404 and 410 are the push service telling us this browser is gone for
       good — uninstalled, permission revoked, cache cleared. Keeping the row
       would mean failing forever, so it goes. */
    if (status === 404 || status === 410) {
      dropSubscription(sub.endpoint);
      return { ok: false, error: `gone (${status})`, gone: true };
    }
    /* Anything else may be temporary. Count it, and retire the endpoint only
       after it has failed repeatedly. */
    db.update(pushSubscriptions)
      .set({ failures: sql`${pushSubscriptions.failures} + 1` })
      .where(eq(pushSubscriptions.id, sub.id))
      .run();
    db.delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.id, sub.id),
          sql`${pushSubscriptions.failures} >= 8`,
        ),
      )
      .run();
    return { ok: false, error: `push ${status ?? ""}: ${(e as Error).message}` };
  }
}
