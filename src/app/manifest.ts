import type { MetadataRoute } from "next";
import { dictionaries } from "@/i18n/dictionaries";

/**
 * The web app manifest, and the reason push did not work on iPhone.
 *
 * This file was missing, and everything else about notifications was in place:
 * the service worker, the VAPID keys, the enrolment button, the subscription
 * table. A member added the site to their Home Screen, opened it from the icon,
 * and no notification ever arrived.
 *
 * The cause is an Apple rule with no error message attached to it. iOS grants
 * web push only to a *home screen web app*, and what makes an icon a home
 * screen web app rather than a bookmark is a manifest declaring
 * `display: standalone`. Without one, Add to Home Screen produces something
 * that looks identical on the springboard and is, as far as notifications are
 * concerned, a Safari tab: `Notification.requestPermission` never resolves to
 * granted, `pushManager.subscribe` fails, and nothing in the browser says why.
 *
 * So: `display: standalone` is the load-bearing line here. The icons matter too
 * — iOS refuses to install without a 192 and a 512 — and everything else is
 * ordinary polish.
 *
 * A route rather than a static file because the name and the description come
 * from the same dictionary as the rest of the site, so they cannot drift from
 * what the pages say.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RG Pilates Studio",
    short_name: "RG Pilates Studio",
    description: dictionaries.en.meta.description,
    /**
     * Where the icon opens: the front door, like any other way in.
     *
     * This pointed at the timetable for a while, on the reasoning that somebody
     * who has installed the app is a member and a member wants to book. The
     * studio's answer was that it reads as broken — you tap the studio's icon
     * and land in the middle of the site with no way of telling you are on the
     * same website you were shown. An installed app that starts somewhere
     * different from the site it installed from is a small mystery nobody
     * asked for.
     *
     * There is no cost to it now, either: the home page used to open with a
     * logo animation, and starting there meant watching it. That is gone.
     * Booking is one tap from here.
     */
    start_url: "/",
    scope: "/",
    /**
     * The line that makes push possible on iOS. Also what removes the Safari
     * chrome, so the icon behaves like an app rather than a bookmark.
     */
    display: "standalone",
    orientation: "portrait",
    /* The studio's cream and its brown. The background is what iOS paints
       behind the splash screen while the app starts. */
    background_color: "#FBF7F0",
    theme_color: "#3A3532",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      {
        src: "/brand/logo-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      /* Maskable so Android can crop it to whatever shape the launcher uses
         without slicing the monogram. */
      {
        src: "/brand/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
