# RG Pilates Studio

Website and booking system for **RG Pilates Studio**, a Reformer Pilates studio in
Larnaca, Cyprus.

Marketing site, live timetable, credit packs bought by card, and a studio admin
panel. English and Greek. Built with Next.js 15 (App Router), TypeScript,
Tailwind CSS, Drizzle ORM and Stripe.

---

## Quick start

```bash
npm install
npm run setup    # writes .env with a fresh AUTH_SECRET, creates and seeds the database
npm run dev      # http://localhost:3000
```

That is the whole install. `npm run setup` is safe to re-run — it never
overwrites an existing `.env`.

`npm run dev` compiles every page once at startup and then tells you it is done
(about 20 seconds). That is deliberate — see
[Why development feels slow](#why-development-feels-slow-and-production-does-not).
`npm run dev:plain` is the bare `next dev` if you would rather not wait, and
`npm run dev:turbo` runs it on Turbopack.

`npm run setup` prints three sign-in accounts:

| Role      | Email                      | Password          | Sees                                     |
| --------- | -------------------------- | ----------------- | ---------------------------------------- |
| Owner     | `owner@rgpilatesstudio.com`     | `ownerdev123`     | the desk, the analytics, and the keys     |
| Reception | `reception@rgpilatesstudio.com` | `receptiondev123` | the desk — no analytics, no takings       |
| Member    | `member@example.com`       | `member123`       | their own account                        |

The demo member starts with 10 sessions so you can book straight away.

**These are development passwords.** They are written in this file, which means
they are in the repository, which means they are not passwords. Set the real ones
on the studio's own machine before going live:

```bash
npm run staff -- password owner@rgpilatesstudio.com
npm run staff -- password reception@rgpilatesstudio.com
```

`npm run doctor` warns for as long as a desk account is still on its default.

---

## How the session system works

**Members see "sessions". The database calls them "credits".** The member-facing
word is set in `src/i18n/dictionaries.ts`; the tables, columns and functions kept
the original `credit` naming so no migration was needed. If you ever want the
data layer renamed too, it is a mechanical find-and-replace across
`src/db/schema.ts`, `src/lib/credits.ts` and `src/lib/booking.ts` plus a
migration — worth doing only if it bothers you.

One session = one class. This is the core of the product, so it is worth
understanding before changing anything.

- **Packs** (`credit_packages`) define credits, price and validity, e.g.
  `€200 / 10 classes / 90 days`. Edit them in the database or in
  `src/db/seed.ts`.
- **Buying** creates a `purchases` row. Credits are only granted when the money
  is confirmed — by the Stripe webhook in production.
- Credits live in **dated batches** (`credit_batches`), one per purchase, each
  with its own expiry. A member's balance is the sum of unexpired batches.
- **Booking** spends one credit from the batch that **expires soonest**, so
  nothing expires while a later-dated credit sits unused.
- **Cancelling** 12+ hours before the class returns the credit to the batch it
  came from. Later than that, the credit is spent — the reformer was held.
- Every movement is written to `credit_ledger` (`+10 purchase`, `-1 booking`,
  `+1 refund`, admin adjustments), which is what the member sees under "Credit
  activity" and what you can audit later.

The rules live in two files and nowhere else:

- `src/lib/credits.ts` — balance, spend, refund, grant
- `src/lib/booking.ts` — booking, capacity, cancellation

Both are covered by tests (below).

### Rules you may want to change

| Rule                                     | Where                                           | Default                 |
| ---------------------------------------- | ----------------------------------------------- | ----------------------- |
| Free-cancellation window                 | `FREE_CANCELLATION_HOURS` in `src/lib/utils.ts` | 12h                     |
| Booking cut-off before start             | `BOOKING_CUTOFF_MINUTES` in `src/lib/utils.ts`  | 30 min                  |
| Class capacity                           | `class_templates.capacity` (per slot)           | 5                       |
| Class length                             | `class_templates.durationMin`                   | 60 min                  |
| Session price / validity                 | `credit_packages`                               | see seed                |
| Reformers, class length, city, open days | `src/lib/studio.ts`                             | 5 · 60min · Larnaca · 6 |

---

## Payments

Buying is a two-page flow, like any shop: `/pricing` chooses a pack, and
`/checkout?pack=…` puts the order and the card side by side. The member does not
leave the site.

**The provider sits behind an interface** (`src/lib/payments/`), because which
one the studio uses is a business decision, not an architectural one:

| Adapter  | What the member sees                                                      |
| -------- | ------------------------------------------------------------------------- |
| `stripe` | card fields inside our own page, drawn by Stripe in its own iframes       |
| `hosted` | a bank gateway — JCC, Viva, most acquirers — described entirely in `.env` |
| `test`   | a card form that charges nothing, for development                         |

`PAYMENT_PROVIDER` in `.env` names the one in charge. Left unset, the first one
properly configured wins, so a fresh clone has a working checkout with no setup.
Name it explicitly in production: then a missing key is a loud error instead of a
live site quietly falling back to test mode.

**Sessions are granted in exactly one place**, `fulfilPurchase()`, and it is safe
to call twice. Three things report the same payment — the browser
(`/api/payments/settle`), the provider's webhook, and a bank gateway's return URL
— and the purchase row is the lock: its status only moves `PENDING → PAID` once,
for whoever gets there first. So a member whose laptop dies mid-payment still
ends up with their sessions, and a webhook retry can never double a balance.
A gateway return with a missing or wrong signature grants nothing.

No card number ever reaches this server, in any mode. Keep it that way.

**`docs/payments.md` is the working document**: the ten questions to send JCC or
Viva, how each answer maps to `.env`, the Stripe setup in five steps, and what to
check before going live. `npm run doctor` prints which provider is live and
whether its webhook is signed.

---

## The reception desk

`/admin` is the studio's own console, and typing that address is the whole
journey: the door itself asks for a staff email and password, and that one form
both signs the person in and opens the desk for 45 minutes. Nobody is bounced to
the member sign-in page and back. Staff already signed in whose 45 minutes have
lapsed are asked for the password alone.

The second door exists because the reception computer stands in a public room,
signed in all day, and one click behind that session are every member's phone
number, their balance and a password reset. There is no shared desk password to
write on a note — it is each person's own.

**Log out** sits on every screen of the console and ends both things: the desk
unlock and the sign-in itself. Two people share this machine, so coming back has
to ask *who you are*, not merely ask you to prove you are the last person who
used it. And when the 45 minutes lapse on their own — nobody pressed anything,
the session is still alive — the password-only screen names whoever is signed in
and offers **Sign in as somebody else**, which ends that session and puts the
email box back. Reception going home and the owner sitting down is the normal
case, not the exception.

A member who types `/admin`, and a stranger who does, see exactly the same form:
a correct member password is refused in the same words as a wrong one, so the
page never confirms who does or does not work here.

A locked console loads _nothing_: no member list, no takings, no phone numbers.
The API routes check the unlock too, not just the page, because a page is a
suggestion and an API route is the door.

**Two accounts, and they are not owed the same view.**

| Who           | Role  | Has                                                                     |
| ------------- | ----- | ----------------------------------------------------------------------- |
| **Reception** | STAFF | the desk: sessions in and out, bookings, closures, notices, prices       |
| **Owner**     | ADMIN | all of that, plus the analytics, plus handing out the keys               |

Reception cannot see the analytics — how many members the studio has and what it
has taken. That is not a hidden tab: the tab is absent from their bar, the
figures are never queried for their page, and `/api/admin/stats` answers them
403 however they ask. The reception computer sits in a public room, so those
numbers should not be on it.

Reception also cannot see or touch another desk account. A colleague's account
is left out of their member search, comes back "not found" if asked for by id,
and refuses a password reset — otherwise the person at the counter could reset
the owner's password and take the whole console with them. The owner *can* reset
reception's password, because somebody has to when it is forgotten.

**Handing out the keys** is done from the studio's own machine, never from the
console — that is not a decision for the person at the counter, and a password
typed at a terminal never reaches a chat window, a git history or anybody's sent
items:

```bash
npm run staff                                                   # who has what
npm run staff -- add reception@rgpilatesstudio.com "Maria" reception         # a new desk account
npm run staff -- add you@rgpilatesstudio.com "Your Name" owner               # a new owner
npm run staff -- password reception@rgpilatesstudio.com                      # a new password
npm run staff -- remove old@rgpilatesstudio.com                              # take the keys back
```

Leave the password off and one is generated and printed once — that output is
the only copy. Supply one instead if you would rather choose it:
`npm run staff -- password reception@rgpilatesstudio.com "their-own-choice"`. Either way,
each person can change their own from `/account` once they are in.

It refuses to remove the last owner account, so the studio cannot lock itself
out, and an account with history behind it is demoted rather than deleted — the
ledger says who sold those sessions, and a row pointing at nothing is worse than
a row pointing at somebody who no longer works here. Sign out and in again after
a change of role.

**The desk has no website navigation.** `/admin` drops the public bar and the
footer entirely and puts its own bar in their place, carrying its six tabs and
nothing else. Somebody at the counter with a queue in front of them has no use
for HOME, STUDIO, CLASSES, TIMETABLE, PRICING or a BOOK A CLASS button, and every
one of those is a way to lose the screen they were working on. The bar sticks to
the top of the window, so scrolling down a long roster never means scrolling back
up to change tab.

**Dates are picked, never typed.** The browser's own date field reads
`dd/mm/yyyy` on a Windows machine and `mm/dd/yyyy` on an American one — the same
box meaning two different days depending on whose computer is on the desk, which
is not a detail to be relaxed about when the button beside it cancels everybody's
classes. So every date on the console is a calendar (Monday-first, Sundays
dimmed) and every date is displayed in words: "Sunday 30 August 2026".

**The numbers are a tab, not a banner.** Analytics is its own screen rather than
a row of figures carried above every other tab: they are read deliberately — at
the end of a month, or when the owner asks — and a permanent line of takings is
both a distraction from the job in hand and a set of figures on display in a
public room. The console opens on Bookings, which is the actual job.

On that screen the period is **From** and **To**, with **This month**, **Last
month** and **All time** as the shortcuts to the questions that get asked weekly.
Both ends are inclusive whole days. The period applies to the *flows* (bookings
taken, money banked, members who joined) and deliberately not to the *stocks*:
"how many sessions are members holding" has no period, it is true now or it is
not, and a dashboard that quietly date-filters a stock is a dashboard that lies.
So **Members**, **Members with sessions**, **Bookings**, **Sessions
outstanding**, **Sessions booked** and **Revenue (paid)** each say which they
are, and cancellations are reported beside the bookings rather than netted off
them — a quiet week and a week nine people pulled out of are not the same week.

What reception can do, all of it written to the session ledger with who did it:

| Tab          | What it is for                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bookings** | any date, forward or back: the classes on it, who is in them, marking attendance, and rolling the rota forward                                      |
| **Members**  | search, then: sessions in and out, cancel a class with or without a refund, correct an email or phone, switch their channels, set a new password   |
| **Closures** | shut a day — every class on it is cancelled and every session goes back, even inside the 24-hour window, and the day disappears from the timetable; also where the rota is rolled forward |
| **Notices**  | write once, then choose who it goes to (everyone / offers only) and how it travels (push, email, SMS) — each showing how many people it reaches   |
| **Pricing**  | run an offer: a rule across the list, or a different one on a single pack, with one press to go back to normal                                     |

Three things worth knowing about how it behaves:

- **Cash at the desk is a payment, not just a balance.** Selling sessions for
  cash writes a purchase row as well as the credit batch, so the studio's
  takings add up whether the card was tapped online or the notes went in the
  till. An "adjustment" moves the balance without pretending money changed
  hands.
- **A price is decided in one place** (`src/lib/pricing.ts`). The pricing page,
  the checkout summary and the amount actually charged all read it there, so a
  discount cannot be shown to a member and then not honoured. Discounted prices
  round _down_ to a whole euro.
- **Notices are read state, not delivery.** Nothing is emailed or texted yet —
  the message appears in the member's account and the count appears on their
  face. When an email or SMS provider is wired up (see `src/lib/reminders.ts`
  for where that hook belongs) the same notice can go down those channels to the
  members who agreed to them.

Closing a day answers with the list of everyone who was in those classes, with
their phone numbers, so somebody can be told rather than finding out by turning
up.

---

## Timezone

All class times are **wall-clock times in the studio's timezone**
(`Asia/Nicosia`, set in `src/lib/studio.ts` — that is the IANA zone for the whole
of Cyprus, Larnaca included). A 06:00 template produces a 06:00 Larnaca class
whether the server runs in Cyprus or on Vercel in UTC, and a visitor browsing
from London still sees 06:00. If the studio ever moves
timezone, that one constant is the only change.

---

## Content you should edit before launch

| What                                                       | Where                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Address, phone, email, Maps link                           | `src/lib/studio.ts`                                                   |
| All page copy, EN + EL                                     | `src/i18n/dictionaries.ts`                                            |
| Class types and descriptions                               | `src/db/seed.ts` → `CLASS_TYPES`                                      |
| Prices and validity                                        | `src/db/seed.ts` → `PACKAGES`                                         |
| Instructor names and bios (**currently placeholders**)     | `src/db/seed.ts` → `INSTRUCTORS`, or the `instructors` table          |
| Weekly timetable                                           | `src/db/seed.ts` → `WEEKDAY_SLOTS` / `SATURDAY_SLOTS` / `typeForSlot` |
| Privacy policy and terms (**templates, not legal advice**) | `src/components/marketing/LegalBody.tsx`                              |

### Brand assets

`public/brand/`

- `wordmark-cream.png` / `wordmark-brown.png` — the lockup, rebuilt from the
  studio's 1024px artwork. Cream for dark grounds, brown for light.
- `monogram.svg` — the looped mark, traced to vector from the studio's own
  artwork. Rendered through `Monogram.tsx` as a CSS mask over `currentColor`, so
  it takes the colour of whatever text surrounds it and the path data stays out
  of the JavaScript bundle.
- `logo-square.png`, `logo-512.png` — favicon and social image.

`public/media/`

- `class.jpg` — the home page cover. Cropped from the studio's class photograph
  below the faces, so nobody in it is identifiable.
- `reformer.jpg` — the product render, used on the studio page.
- `detail-wood.jpg`, `detail-footbar.jpg` — used on the studio page.
- `reformer-side.jpg` — the "Meet your new standard" side view, spare.
- `schedule-card.jpg` — the opening-hours card, spare.
- `logo-reveal.mp4` / `.webm` / `-poster.jpg` — the logo animation, re-encoded
  for the web (421kB down to 48kB) with the audio stripped, since autoplay
  requires muted video anyway.

### The opening animation

`IntroReveal.tsx` plays the logo animation once per browser session, then fades
into the hero. It is skippable by click, key or scroll, it is skipped outright
for anyone whose system asks for reduced motion, and the page underneath is
fully rendered the whole time — so it costs nothing in loading terms and search
engines never see it. To change how long it holds, edit `HOLD_MS`. To retire it,
delete the `<IntroReveal />` line from `src/app/page.tsx`.

### The cover

`Hero.tsx` is a full-viewport photograph with the type centred over it, and the
header switches into a matching mode over it — centred wordmark, MENU control,
navigation moved into the full-screen sheet (see `cover` in `Header.tsx`). Past
the cover the header returns to the normal light navigation bar.

If you get footage of a class, the cover is already built to sit over a dark
image: swap the `<Image>` for a muted, looping `<video>` with `class.jpg` as its
poster and nothing else needs to change.

**Faces:** the cover photograph is cropped below every face on purpose. If you
replace it with a photo of real members, get their written consent first, or crop
the same way.

### Fonts

Loaded from Google Fonts in `src/app/layout.tsx`: **Jost** (close to the
wordmark's geometry) and **Cormorant Garamond** for display. To self-host them
instead, switch to `next/font/google` in the layout and delete the
`<link>` tags — everything else keeps working through the two CSS variables.

---

## Adding classes to the timetable

The weekly pattern lives in `class_templates`. Real bookable classes
(`class_sessions`) are generated from it.

- **Admin panel → Generate schedule** creates the next N weeks. It is safe to
  run repeatedly; existing classes are never duplicated.
- Run it on a schedule in production so the timetable never runs dry, e.g. a
  weekly Vercel Cron hitting an authenticated route, or
  `npx tsx -e "import('./src/lib/schedule').then(m => m.generateSessions(8))"`.
- A one-off class (workshop, cover instructor) can be inserted straight into
  `class_sessions` with no template.

---

## Database

SQLite via Drizzle in development — no server to install, the whole database is
`dev.db`.

```bash
npm run db:push      # apply schema changes
npm run db:seed      # (re)seed catalogue + timetable
npm run db:studio    # browse the data in a UI
npm run db:reset     # wipe and rebuild from scratch
```

### Moving to Postgres for production

SQLite is a single file on one machine — fine for a single server, not for
serverless hosting like Vercel, where you want managed Postgres (Neon, Supabase,
RDS).

1. `npm install pg` and change `src/db/index.ts` to Drizzle's `node-postgres`
   driver.
2. In `src/db/schema.ts`, swap the `drizzle-orm/sqlite-core` imports for
   `drizzle-orm/pg-core` (`sqliteTable` → `pgTable`, `integer(… {mode:"timestamp"})`
   → `timestamp`, `integer(… {mode:"boolean"})` → `boolean`).
3. Point `DATABASE_URL` at the new database, `npm run db:push`, `npm run db:seed`.

No queries or business logic change — the tables and columns stay identical.

---

## Tests

Five suites, 245 checks. Four of them talk to a running server, so build and
start it first.

```bash
# business rules, straight against the database
npm run test:flows                                # 51 checks

npm run build && npx next start -p 3100
npm run test:http     -- http://localhost:3100    # 90 checks
npm run test:profile  -- http://localhost:3100    # 38 checks
npm run test:payments -- http://localhost:3100    # 33 checks
npm run test:desk     -- http://localhost:3100    # 95 checks
npm run test:notify   -- http://localhost:3100    # 81 checks
```

- **flows** — credit expiry, spending the soonest-expiring credit, double
  booking, capacity, free versus late cancellation, the booking cut-off, and
  that the ledger always reconciles with the credit batches.
- **http** — every page, registration and sign-in, the guards on `/account` and
  `/admin`, buying a pack, booking, cancelling, one member being unable to touch
  another's booking, and the webhook refusing unsigned calls.
- **profile** — photo upload and removal, consents, the password change, the
  reminder window, and every validation rule the profile form relies on.
- **payments** — the checkout page's guards, opening a payment without granting
  anything, settling it, settling it three times and still getting one grant,
  one member failing to settle another's purchase, and a forged gateway return
  being refused.
- **notify** — the three automatic messages (booked, cancelled, reminder), the
  reminder sweep being closed to the public and idempotent, and the consent rules: what a new member starts with (push on and not
  switchable, email on, SMS off, offers unticked), that an edited request cannot
  turn push off, that an offer reaches exactly the members who accepted offers
  and nobody else, and that withdrawing that consent hides the offers already
  sent. See docs/notifications.md.
- **desk** — the front door (a stranger gets the form rather than a redirect, a
  member's correct password does not open it, staff credentials open it in one
  step), the split between reception and the owner (no analytics tab, the stats
  route refusing them, a colleague's account invisible to their search and
  immune to their password reset, and the owner still able to reset theirs),
  the way out (Log out ends the session too, and a lapsed unlock offers the
  email box back so the other account can sign in on the same browser), and the
  lock behind it (a locked console loading no data, the API
  answering 423 rather than 403), the six analytics cards and that the stocks
  among them do not move when the period does,
  then every reception action: cash sales recorded as payments, taking sessions
  back without going negative, cancelling with and without a refund, an email
  clash refused, a password reset the member can then sign in with, closing a
  day and the sessions coming back, a notice arriving unread and being marked
  read, and an offer that is shown _and_ charged.

All five should report `ALL PASS`. Also useful:

```bash
npm run typecheck       # TypeScript
npm run check:classes   # every colour-opacity class actually compiles to CSS
npm run doctor          # is this installation sane, and what will it charge with
```

Each suite exists because something went wrong once. Adding to them is cheaper
than finding the same bug twice.

---

## Deploying

Easiest path is **Vercel**:

1. Push this folder to a Git repository and import it in Vercel.
2. Set the environment variables from `.env.example` in the Vercel project
   (`AUTH_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, the Stripe keys).
3. Move the database to Postgres first (see above) — SQLite will not survive on
   serverless hosting.
4. Add the Stripe webhook endpoint for the deployed URL.

Any Node host works too (`npm run build && npm start` behind a reverse proxy);
there SQLite is a valid choice if the app runs on one machine with a persistent
disk, and you should back up `dev.db` (rename it something more permanent).

---

## Project layout

```
src/
  app/                    routes (App Router)
    api/                  auth, bookings, checkout, stripe webhook, admin
    timetable/            live booking page
    account/              member dashboard: credits, bookings, history
    admin/                studio panel: attendance, members, schedule
  components/
    site/                 header, footer, language toggle
    home/ marketing/      page sections
    booking/ account/ admin/
    ui/                   button, section, reveal, logo, monogram, reformer art
  db/                     schema, connection, seed
  i18n/                   dictionaries (EN + EL) and the language provider
  lib/                    auth, credits, booking, schedule, stripe, time, studio
scripts/                  test suites
public/brand/             logo and wordmark files
```

## Performance

Two diagnostics ship with the project. Run them against a **production** build —
`npm run dev` compiles each page on first request and is several times slower by
design, which is misleading.

```bash
npm run build
npm start                 # in one terminal
npm run diagnose          # in another — per-route TTFB, payload, JS weight
npm run diagnose:db       # query timings and SQLite query plans
```

`diagnose` reports time-to-first-byte (server work), total document time, HTML
size and the compressed JavaScript a modern browser actually downloads, then
flags anything over budget: TTFB <200ms, total <400ms, HTML <120kB, JS <180kB.

`diagnose:db` times every query the app runs on a page load and prints SQLite's
own query plan, so you can see whether an index is being used (`SEARCH … USING
INDEX`) or a table is being scanned (`SCAN`).

### Where it stands

Measured on a production build with 354 classes seeded:

|                                         | Before | After      |
| --------------------------------------- | ------ | ---------- |
| JavaScript per route (transferred)      | 175kB  | **138kB**  |
| Uncompressed JS (excl. legacy polyfill) | 590kB  | **435kB**  |
| Server time (TTFB), slowest route       | 26ms   | **20ms**   |
| Timetable query, 14 days with occupancy | —      | **0.18ms** |
| Logo images                             | 112kB  | **9kB**    |

The database was never the problem — every query is sub-millisecond and
index-backed. The weight was client-side JavaScript, and the fix was removing an
animation library that the shared layout pulled into every route (including
static pages like the privacy policy) just to fade elements in on scroll. That
is now a shared `IntersectionObserver` and a few CSS classes in
`globals.css`/`Reveal.tsx`.

### If you want to go further

Neither of these is needed today; both are real wins if the studio's traffic
grows or you care about first-visit speed on mobile data.

1. **Self-host the fonts.** They currently load from Google Fonts via a
   `<link>` in `src/app/layout.tsx`, which costs two extra connections before
   text can render. Replace it with `next/font/google`:

   ```tsx
   import { Cormorant_Garamond, Jost } from "next/font/google";

   const jost = Jost({
     subsets: ["latin", "greek"],
     weight: ["200", "300", "400", "500"],
     variable: "--font-jost",
     display: "swap",
   });
   const cormorant = Cormorant_Garamond({
     subsets: ["latin", "greek"],
     weight: ["300", "400", "500"],
     variable: "--font-cormorant",
     display: "swap",
   });
   // then: <html className={`${jost.variable} ${cormorant.variable}`}>
   ```

   Delete the `<link>` tags and the inline `<style>` block. Next then serves the
   font files from your own domain and preloads them. Note the `greek` subset —
   the site is bilingual.

2. **Ship one language at a time.** Both the English and Greek dictionaries are
   sent to the browser so the toggle switches instantly with no reload. That is
   roughly 12kB compressed. If you would rather send only the active language,
   have the toggle set the cookie and call `router.refresh()`, and import the
   dictionary per-locale — you trade an instant toggle for a smaller payload.

### Why development feels slow, and production does not

`next dev` compiles each route the first time somebody asks for it. So the first
visit to a page pays for its own compile and every visit after that does not,
which is exactly why the site feels heavy until you have been everywhere once
and instant afterwards. Measured on this project:

| Page         | First visit in dev | Second | Production |
| ------------ | ------------------ | ------ | ---------- |
| `/`          | 7.9s               | 0.41s  | 0.022s     |
| `/contact`   | 2.2s               | 0.07s  | 0.014s     |
| `/studio`    | 2.0s               | 0.09s  | 0.013s     |
| `/timetable` | 1.1s               | 0.11s  | 0.036s     |
| `/pricing`   | 0.7s               | 0.14s  | 0.012s     |

The production column is a real build (`npm run build && npm start`), cold, no
cache: 12 to 36 milliseconds. **Nobody visiting the real site sees the dev
numbers.** There is nothing to fix in the application here.

What `npm run dev` does about it is walk every route once at startup, while you
are still reaching for the browser, so you wait once instead of stalling on each
first click (`scripts/dev.mjs`). `npm run dev:plain` skips that.

If dev still feels sluggish on Windows, the usual causes are an antivirus
scanning `node_modules` on every file read — exclude the project folder — or the
project living on a network or OneDrive-synced drive.

### If class numbers grow a lot

The timetable query counts bookings with a correlated subquery per class. At a
few hundred classes that is 0.18ms. Past a few thousand, switch it to a single
grouped join — `diagnose:db` will tell you when it starts to matter.

---

## Troubleshooting

**`Module not found: Can't resolve '@stripe/react-stripe-js'`**
Somebody pulled a change that added a dependency, and `node_modules` has not
caught up. `npm install`, then `npm run dev`. The same goes for any
`Module not found` naming a package that is present in `package.json`.

**`Cannot find module '../server/require-hook'`**
`npm install` had not finished when the command was run. Wait for
`added N packages` before running anything else, then try again.

**`Could not locate the bindings file` / no `.node` file in
`node_modules/better-sqlite3`**
The SQLite driver is a native module. It normally installs a prebuilt binary,
but there is no prebuild for a Node version newer than the driver, in which case
npm falls back to compiling — which needs Visual Studio build tools on Windows.
Fixes, in order of preference:

1. Make sure `better-sqlite3` is `^12.2.0` or newer in `package.json` (v12 has
   prebuilds for Node 20, 22 and 24), then `npm install` again.
2. Or install Node 22 LTS, delete `node_modules`, and `npm install`.
3. Or `npm install --global windows-build-tools` (as administrator) so the
   fallback compile can succeed.

Check your Node version with `node -v`. Node 20 LTS or 22 LTS are the safest.

**`AUTH_SECRET is missing or too short`**
`.env` was not created. Run `npm run setup`, or copy `.env.example` to `.env`
and paste any long random string into `AUTH_SECRET`.

**"Buy pack" says payments are not switched on**
Expected in a production build with no Stripe keys. Either add the Stripe test
keys, or set `ALLOW_TEST_PAYMENTS="true"` in `.env` to grant credits without
paying (fine for a staging demo, never on the live site). In `npm run dev` it
already works with no keys.

---

## Security notes

- Passwords are hashed with bcrypt; sessions are signed JWTs in an httpOnly,
  SameSite=Lax cookie. Set a long random `AUTH_SECRET` and keep it out of Git.
- Every booking and cancellation is re-checked on the server against the signed
  session — the browser cannot book for someone else or grant itself credits.
- Admin routes check the user's role server-side, not just in the UI.
- `.env` is gitignored. Never commit real Stripe keys.
