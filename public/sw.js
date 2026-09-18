/**
 * The service worker, which exists for one reason: a browser will only deliver
 * a push notification to one of these, not to a page. It runs when the site is
 * closed, which is the whole point — a member is told their class is cancelled
 * without having the site open.
 *
 * Deliberately does nothing else. No caching, no offline page, no interception
 * of requests: a service worker that quietly serves stale pages is a support
 * problem nobody can reproduce, and this studio does not need one.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "APEX pilates", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "APEX pilates";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      /* 192 rather than 512: this is drawn at about 64px and Android downscales
         it itself, so the larger file was 27kB of nothing on a phone network. */
      icon: "/brand/logo-192.png",
      /**
       * The little mark Android puts in the status bar, and the reason members
       * on Android saw a white square.
       *
       * `badge` is not a small icon. Android throws the image's colours away and
       * keeps only its alpha channel, then tints the result and crops it to a
       * circle — so any square, fully-opaque image, including a perfectly good
       * logo, arrives as a solid filled square. What belongs here is a glyph on a
       * transparent background and nothing else. iOS ignores this field, which is
       * why the same notification looked right on iPhone all along.
       */
      badge: "/brand/notification-badge.png",
      /* Same tag for the same notice, so a member with the site open on two
         devices does not collect duplicates of one message. */
      tag: data.tag || title,
      data: { url: data.url || "/account?tab=notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  /* Focus a tab that is already on the site rather than opening a fourth one. */
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (client.url.includes(new URL(url, client.url).pathname)) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
