import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Chrome } from "@/components/site/Chrome";
import { ResumeHome } from "@/components/app/ResumeHome";
import { Footer } from "@/components/site/Footer";
import { Header, type HeaderUser } from "@/components/site/Header";
import {
  DEFAULT_LOCALE,
  dictionaries,
  LOCALE_COOKIE,
  LOCALES,
  type Locale,
} from "@/i18n/dictionaries";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { currentUser } from "@/lib/auth";
import { hasAvatar } from "@/lib/avatars";
import { getAvailableCredits } from "@/lib/credits";
/**
 * The fonts, self-hosted from the `@fontsource` packages instead of fetched from
 * Google at runtime.
 *
 * They used to load from a Google Fonts <link> with `display=swap`, which is
 * what made the headline flash on every fresh load: the browser painted a
 * fallback serif, fetched the real font from Google (a whole extra connection to
 * a third-party server), then swapped it in — the visible "correction". Serving
 * the woff2 files from our own domain instead collapses that fetch from hundreds
 * of milliseconds to tens, so the swap is effectively gone, and it removes the
 * dependency on Google being reachable at build or run time.
 *
 * Only the weights actually used, latin only — none of the three ship Greek
 * glyphs, so Greek text falls back to a system face exactly as it did before.
 */
import "@fontsource/jost/200.css";
import "@fontsource/jost/300.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/marcellus/400.css";
import "./globals.css";
import { unreadCount } from "@/lib/notices";

export const metadata: Metadata = {
  title: {
    default: "RG Pilates Studio | Reformer Pilates in Larnaca",
    template: "%s · RG Pilates Studio",
  },
  description: dictionaries.en.meta.description,
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  /**
   * The manifest, and the icons iOS wants.
   *
   * `manifest` is what turns Add to Home Screen into an installed web app
   * rather than a bookmark, which is what web push requires on iPhone. See
   * app/manifest.ts — that omission is why notifications silently did nothing
   * there for a while.
   *
   * The Apple icon is its own file at 180 and flattened onto the cream, because
   * iOS does not composite transparency: a PNG with an alpha channel gets a
   * black background on the Home Screen.
   */
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/brand/logo-512.png",
    apple: "/brand/apple-touch-icon.png",
  },
  /**
   * The legacy pair of Apple meta tags, still read by iOS and still worth
   * setting alongside the manifest: `capable` is what removes the browser bar,
   * and the title is what appears under the icon instead of the page title,
   * which would otherwise be the whole "RG Pilates Studio | Reformer Pilates in
   * Larnaca" line truncated to nothing useful.
   */
  appleWebApp: {
    capable: true,
    title: "RG Pilates Studio",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "RG Pilates Studio | Reformer Pilates in Larnaca",
    description: dictionaries.en.meta.description,
    type: "website",
    images: ["/brand/logo-square.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#C6BDB6",
};

async function readLocale(): Promise<Locale> {
  const jar = await cookies();
  const v = jar.get(LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(v ?? "") ? (v as Locale) : DEFAULT_LOCALE;
}

/**
 * There is deliberately no cookie banner here, and that is a decision rather
 * than an omission.
 *
 * This site sets no advertising, analytics or tracking cookie of any kind. What
 * it stores is the sign-in cookie, the desk's own lock, and the language the
 * visitor picked. The first two are strictly necessary, which is exempt from
 * consent; the third is only ever written the moment somebody clicks EN or EL,
 * which is the visitor asking for it, and interface preferences a visitor sets
 * themselves are exempt on the same footing (Article 29 Working Party opinion
 * 04/2012, the "UI customisation" case).
 *
 * So there is nothing here to ask permission for in advance. Not clicking the
 * language switch is the refusal. What is still owed is the telling, and that
 * is /cookies, linked in the footer under Legal, which names every cookie, what
 * it holds and how long it lasts.
 *
 * The one thing that could change this is Stripe: its script sets two of its
 * own cookies on the checkout page for fraud checks. Stripe treats them as
 * strictly necessary to take a payment, which is the ordinary reading. If a
 * lawyer disagrees, the banner comes back on that page and nowhere else.
 */

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await readLocale();
  const user = await currentUser();

  const headerUser: HeaderUser = user
    ? {
        name: user.name,
        role: user.role,
        credits: await getAvailableCredits(user.id),
        hasPhoto: await hasAvatar(user.id),
        /* The number on their face in the corner: notices from the studio they
           have not read yet. */
        unread: unreadCount(user.id),
      }
    : null;

  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-cream">
        <LanguageProvider initialLocale={locale}>
          {/* Reopening the installed app lands on the homepage rather than on
              whatever screen it was suspended on. Renders nothing. */}
          <ResumeHome />
          {/* The public bar and footer everywhere except the reception desk,
              which brings its own — see components/site/Chrome.tsx. */}
          <Chrome header={<Header user={headerUser} />} footer={<Footer />}>
            {children}
          </Chrome>
        </LanguageProvider>
      </body>
    </html>
  );
}
