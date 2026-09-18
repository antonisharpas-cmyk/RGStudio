import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { InstallButton } from "@/components/link/InstallButton";
import { MantraBar } from "@/components/link/MantraBar";
import { Monogram } from "@/components/ui/Monogram";
import { Wordmark } from "@/components/ui/Wordmark";
import { LOCALE_COOKIE, DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/dictionaries";
import { STUDIO } from "@/lib/studio";

/**
 * The card to put behind one link: an Instagram bio, a WhatsApp message, a QR
 * code on the counter.
 *
 * ---
 *
 * **Unlisted, not private.**
 *
 * Nothing links here. It is not in the header, not in the footer, and not in
 * `sitemap.ts`, which is an explicit list rather than a crawl. `robots.ts`
 * disallows it and the metadata below says `noindex, nofollow`, so it stays out
 * of Google.
 *
 * What it is not is secret. There is no password and no token in the address,
 * because the whole purpose is to hand the address to people. Anybody with the
 * link can open it, and it holds nothing that matters: the studio's own name,
 * its public social accounts and its published phone number. Treat it as a
 * printed card, which is what it is.
 *
 * ---
 *
 * **No header and no footer.**
 *
 * A page whose job is five buttons should not carry the site's navigation above
 * them: HOME, STUDIO, CLASSES, TIMETABLE and BOOK A CLASS are five more things
 * to press instead of the one thing the link was sent for. `Chrome` leaves this
 * route bare, the same way it does the reception desk.
 *
 * ---
 *
 * **Why this one is brown when the site is cream.**
 *
 * The cream wordmark exists for dark grounds and had nowhere to be used. More
 * usefully, a share card is seen once, out of context, usually next to somebody
 * else's link, and a coloured ground reads as deliberate there in a way that a
 * white page does not.
 *
 * The ground is `mocha-600`, `#3A3532`, flat. That is the primary brand brown,
 * the one the studio's own material is set on, sampled from it rather than
 * chosen. The first version of this page ran a gradient from `mocha-800` down
 * to `mocha-950` and was much too dark: further from the brand, and the kind of
 * near-black that reads as a different company. Cream on `#3A3532` measures
 * 7.5:1, so the lighter ground costs nothing in legibility.
 */

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "";

export const metadata: Metadata = {
  /* A middle dot, not an em dash: the studio's rule is no em dashes in
     anything a member reads, and a page title is read in the browser tab and
     in every link preview. */
  title: "RG Pilates Studio · Reformer Pilates Larnaca",
  description:
    "Reformer Pilates in Larnaca. Book a class, follow the studio, or call us.",
  /* Belt as well as the braces in robots.ts: that file governs crawling, this
     governs indexing, and a page reached by a shared link is crawled through
     nobody's sitemap but can still be indexed if a browser reports it. */
  robots: { index: false, follow: false },
  /* The link preview in WhatsApp and Messenger, which is where this will
     actually be pasted. Without it the preview is a bare URL. */
  openGraph: {
    title: "RG Pilates Studio",
    description: "Reformer Pilates Larnaca",
    images: BASE ? [`${BASE}/brand/logo-512.png`] : undefined,
  },
};

/** Matches the site: the cookie decides, and English is the fallback. */
async function readLocale() {
  const jar = await cookies();
  const v = jar.get(LOCALE_COOKIE)?.value ?? "";
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : DEFAULT_LOCALE;
}

/**
 * The studio's own lines, kept in English in both languages.
 *
 * Deliberate rather than unfinished. These are the lines off the brand
 * material, they are set as a lockup rather than as a sentence, and a slogan
 * translated for one market and not the other stops being a slogan. The rest of
 * the page is bilingual, as it should be, because the rest of the page is
 * instructions.
 *
 * "Embrace your uniqueness" closes both sets, which is how the studio wrote them.
 */
const TOP_RAIL = [
  "Breathe. Align. Rise.",
  "Strength. Flexibility. Core.",
  "Embrace your uniqueness",
] as const;

const BOTTOM_RAIL = [
  "Find your balance",
  "Own your strength",
  "Embrace your uniqueness",
] as const;

const COPY = {
  en: {
    tagline: "Reformer Pilates Larnaca",
    website: "Visit the website",
    facebook: "Facebook",
    instagram: "Instagram",
    install: "Install the app",
    installed: "You are using the app",
    call: "Call us",
    iosTitle: "To add it to your home screen",
    iosSteps: [
      "Tap the Share button at the bottom of Safari.",
      "Scroll down and choose Add to Home Screen.",
      "Tap Add. It opens like an app from then on.",
    ],
  },
  el: {
    tagline: "Reformer Pilates Λάρνακα",
    website: "Επισκέψου την ιστοσελίδα",
    facebook: "Facebook",
    instagram: "Instagram",
    install: "Εγκατάσταση εφαρμογής",
    installed: "Χρησιμοποιείς την εφαρμογή",
    call: "Κάλεσέ μας",
    iosTitle: "Για να την προσθέσεις στην αρχική οθόνη",
    iosSteps: [
      "Πάτα το κουμπί Κοινοποίηση στο κάτω μέρος του Safari.",
      "Κύλησε κάτω και διάλεξε Προσθήκη στην αρχική οθόνη.",
      "Πάτα Προσθήκη. Από εκείνη τη στιγμή ανοίγει σαν εφαρμογή.",
    ],
  },
  ru: {
    tagline: "Reformer Pilates Ларнака",
    website: "Перейти на сайт",
    facebook: "Facebook",
    instagram: "Instagram",
    install: "Установить приложение",
    installed: "Вы используете приложение",
    call: "Позвонить нам",
    iosTitle: "Чтобы добавить на экран «Домой»",
    iosSteps: [
      "Нажмите кнопку Поделиться внизу Safari.",
      "Прокрутите вниз и выберите На экран «Домой».",
      "Нажмите Добавить. С этого момента сайт открывается как приложение.",
    ],
  },
} as const;

/**
 * `tel:` will not accept the spaces a phone number is written with.
 *
 * `+357 24 000 000` has to travel as `+35724000000` or the phone dials nothing.
 * Kept as a strip rather than a second constant so `STUDIO.phone` stays the one
 * place the number is written.
 */
const dialable = (n: string) => n.replace(/[^\d+]/g, "");

/** One row in the stack. All five look the same on purpose. */
function Action({
  href,
  children,
  icon,
  external,
}: {
  href: string;
  children: React.ReactNode;
  icon: React.ReactNode;
  external?: boolean;
}) {
  /* Borders and muted text sit a notch stronger than they did on the old
     near-black ground: cream at 25% reads clearly against `mocha-950` and goes
     nearly invisible against `mocha-600`, which is 4 steps lighter. */
  const className =
    "flex w-full items-center justify-center gap-3 rounded-full border border-cream/35 px-6 py-3.5 text-xs uppercase tracking-widest text-cream transition-colors duration-300 hover:border-cream/70 hover:bg-cream/10";

  /* `next/link` for anything inside the site so it prefetches and navigates
     without a reload; a plain anchor for anything that leaves, including
     `tel:`, which next/link has no business trying to route. */
  if (external) {
    return (
      <a
        href={href}
        target={href.startsWith("tel:") ? undefined : "_blank"}
        rel="noreferrer noopener"
        className={className}
      >
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {icon}
      {children}
    </Link>
  );
}

export default async function LinkPage() {
  const locale = await readLocale();
  const t = COPY[locale];

  return (
    /**
     * Three bands: a rail, the card, a rail.
     *
     * The rails are outside the centred column on purpose. They run the full
     * width of the screen and are pinned to the top and bottom by `flex-1` on
     * the middle band, so the card floats between them however tall the phone
     * is. Putting them inside `max-w-sm` would have made them two short strips
     * with brown either side, which is not what a rail is.
     */
    <main className="flex min-h-dvh flex-col bg-mocha-600">
      <MantraBar phrases={TOP_RAIL} />

      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          {/* The mark. `Monogram` already does the mask-over-currentColor
              trick, so it recolours with the text around it and the 18kB of
              path data stays in a cacheable file. */}
          {/* Wrapped in a flex row rather than given `mx-auto`: `Monogram`
              renders an `inline-block` span, and auto margins do nothing to an
              inline box, so the mark sat hard left. */}
          <div className="flex justify-center">
            <Monogram className="h-16 w-16 text-cream/90" />
          </div>

          <div className="mt-7 flex justify-center">
            <Wordmark tone="cream" priority className="w-[210px]" />
          </div>

          <p className="mt-7 text-center font-wordmark text-xl tracking-wide text-cream/90">
            {t.tagline}
          </p>

          <div className="mt-10 space-y-3">
            <Action
              href="/"
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 10.5 12 3l9 7.5" />
                  <path d="M5 9.5V21h14V9.5" />
                </svg>
              }
            >
              {t.website}
            </Action>

            <Action
              external
              href={STUDIO.facebook}
              icon={
                <Image
                  src="/brand/facebook.svg"
                  alt=""
                  width={16}
                  height={16}
                  /* The brand SVGs are dark. Inverted to sit on the dark ground,
                   which for a flat single-colour mark is exact. */
                  className="h-4 w-4 invert"
                  aria-hidden
                />
              }
            >
              {t.facebook}
            </Action>

            <Action
              external
              href={STUDIO.instagram}
              icon={
                <Image
                  src="/brand/instagram.svg"
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4 invert"
                  aria-hidden
                />
              }
            >
              {t.instagram}
            </Action>

            {/* Filled rather than outlined: it is the one thing this page is
              really for, and it is the only action that changes anything on the
              visitor's phone. */}
            <InstallButton
              label={t.install}
              installedLabel={t.installed}
              iosTitle={t.iosTitle}
              iosSteps={[...t.iosSteps]}
            />

            <Action
              external
              href={`tel:${dialable(STUDIO.phone)}`}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v4a16 16 0 0 1-16-16Z" />
                </svg>
              }
            >
              {t.call}
            </Action>
          </div>

          <p className="mt-8 text-center text-[11px] uppercase tracking-widest text-cream/45">
            {STUDIO.addressLines[1]}, {STUDIO.city}
          </p>
        </div>
      </div>

      <MantraBar phrases={BOTTOM_RAIL} reverse />
    </main>
  );
}
