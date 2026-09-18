# Handover notes: RG Pilates Studio

What is finished, what is placeholder, and what to decide next. This site is
the ErgonSite studio platform, first built for APEX pilates in Larnaca and
here rebranded for RG Pilates Studio. The booking engine, the desk console,
payments, notifications and backups are unchanged and proven; what changed is
everything a member can see.

## Done and working

- **Marketing site**: home, studio, timetable, pricing, FAQ, contact,
  privacy, terms, cookies, 404, sitemap, robots. Bilingual EN/EL with a header
  toggle that persists in a cookie and renders server side.
- **Brand**: the RG logo, its greige ground (#C6BDB6) and near black ink, the
  RG wordmark in the header and footer, the ring mark as the site's monogram,
  and the studio's own lines on the cover: "Embrace your uniqueness",
  "Breathe. Align. Rise.", "Find your balance, own your strength" and
  "Strength · Flexibility · Core".
- **Cover**: the two class photographs alternate every two seconds, with the
  line changing alongside them.
- **Hours**: taken from the studio's published schedule card. Monday to
  Thursday 06:00 to 12:00 and 15:00 to 20:00; Friday 06:00 to 11:00, 13:00 to
  14:00 and 15:00 to 20:00; Saturday 07:00 to 12:00; Sunday closed. Sixty
  minute sessions on the hour. Personal and Duet appointments sit at 12:00,
  13:00 and 14:00, Monday to Thursday.
- **Accounts, packs, booking, member dashboard, desk console, invoices,
  email, SMS, push, backups**: as documented in `docs/`.
- **Three languages**: English, Greek and Russian (`src/i18n/ru.ts`). Legal
  pages and notification emails are served in English to Russian readers
  until they are translated.
- **Desk console additions for RG**:
  - Team tab (owner only): add, edit, hide and restore instructors, with bios
    in all three languages and a portrait address. The studio page follows the
    database at once. Nobody is deleted; hidden instructors keep their name on
    past classes.
  - Pricing tab (owner only): edit each pack's list price; create promo codes
    with percent or euro discounts, an on/off switch, a valid from/until range,
    an optional maximum number of uses and an optional single pack scope.
    Members type the code at checkout and the charge is reduced before the
    card form opens. A use is counted only when the payment settles.
  - Pricing tab (owner only), packs: every pack can be edited (name in two
    languages, sessions, days of validity, price, heading on the pricing
    page), new packs can be created, and any pack can be taken off sale or
    put back. Nothing is deleted; members keep what they bought. Once a pack
    has been edited from the desk, `packs.ts` no longer overwrites it.
  - Monthly plans (`src/lib/subscriptions.ts`): a term of 6 to 12 months at
    1 to 4 classes a week, paid month by month. All sessions go on the account
    on day one (9 months at 2 a week is 72 sessions), the monthly price is the
    live price of the one month pack for that cadence. Members start a plan
    from the pricing page and pay online; the desk can start one and take a
    month in cash or by card on the member's card; the member can also pay a
    month online from their account. Reminders go out 3 days before and on
    the due date. If a month is unpaid 3 days after its due date the plan
    lapses: its sessions freeze and its upcoming bookings are released for
    other members. Any payment thaws it. The cron sweep does the lapsing.
  - Members tab: any desk account can extend the expiry of a member's pack
    (pick the batch, add days, the new date is shown before pressing). Staff
    now see the owner and staff accounts in the member list but cannot change
    their passwords or contact details; only the owner can.

## Monthly plans and automatic card charging

Not built, on purpose, and here is the reasoning for RG. Stripe can charge a
saved card every month (Stripe Subscriptions or a saved payment method with
off session charges), but RG said members may pay one month in cash, the
next by card at the desk and another online. An automatic charge on a month
already paid in cash is a refund and an argument at the counter, and a card
declined at 06:00 still needs the same lapse rules as a member who forgot.
So the plan engine is deliberately payment method agnostic: every till ends
in the same `recordSubscriptionPayment`, and the member gets a reminder with
a one press "Pay this month" button.

If RG later wants automatic charging for members who ask for it, the clean
addition is: a per plan flag `autoRenew`, a saved Stripe payment method on
the member, and a step in the cron sweep that, on the due date, creates a
PaymentIntent off session for `monthlyPriceCents` with `subscriptionId` on the
purchase row. Fulfilment already knows what to do with such a purchase, so
nothing else changes. Roughly a day's work once Stripe is live.

## Buying the next pack early

A pack's days count from the day after the member's current pack ends, not
from the day of purchase, whenever a paid pack of the same kind is still
running. A month bought on 18 September runs to 18 October included; a
second month bought on 8 October runs 19 October to 17 November, and its
sessions are on the account at once, so the member can book the Tuesdays
in November the day they pay. The ledger note on the new batch says which
pack it followed. Personal or duet sessions chain only with their own kind,
and desk goodwill grants and promo credits never move a pack. Frozen plan
batches are ignored. `npm run test:chain` replays the whole case.

One consequence to know about: a member holding a long pack (say nine
months) who buys a one month pack has that month start after the nine, so
it is not the way to add sessions to the current month. For that, the
desk sells the pack with the "adjustment" method or grants sessions, both
of which count from today.

## Desk logins

Development defaults, created by `npm run setup` (or `npm run db:seed`):

| Account | Email | Password | Can do |
| --- | --- | --- | --- |
| Owner | owner@rgpilatesstudio.com | ownerdev123 | Everything, including analytics, pricing, promo codes, team |
| Reception (instructors) | reception@rgpilatesstudio.com | receptiondev123 | Bookings and members, including selling sessions and extending expiry |
| Demo member | member@example.com | member123 | A member with 10 sessions, for clicking through |

The desk console at `/admin` asks for the same password again to unlock. Set
RG's real accounts on the studio's machine with `npm run staff` (see README);
the defaults must not reach a live database, and the seed refuses to create
them in production without `SEED_OWNER_PASSWORD` and `SEED_RECEPTION_PASSWORD`.

## Environment

`.env` is not part of this folder and no Apex credential was carried over.
`npm run setup` creates `.env` from `.env.example` with a fresh `AUTH_SECRET`
and placeholders for everything else. Fill in RG's own: Stripe keys and webhook
secret, `PAYMENT_PROVIDER`, SMTP (Gmail app password if they use Gmail),
`SMS_PROVIDER` and `SMSTO_API_KEY`, `SMS_SENDER`, VAPID keys
(`npm run push:keys`), `INVOICE_*`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`.
`npm run doctor` checks the file. `render.yaml` lists the same variables for
hosting.

## Placeholder: confirm with RG before launch

1. **Email address**: `info@rgpilatesstudio.com` in `src/lib/studio.ts`,
   `.env.example` and `render.yaml` is a guess. Replace it with the studio's
   real mailbox everywhere (search the repo for it).
2. **Legal entity**: company name, HE number and VAT number in
   `src/lib/legal.ts` are placeholders, as are the `INVOICE_*` values in
   `.env.example`.
3. **Instructors**: `Andrea` and `Maria` in `src/lib/roster.ts` are placeholders; the bios are written for the demo and
   there are no portraits yet. Confirm the team and drop photos into
   `public/team/`, then add them to `INSTRUCTOR_PHOTOS` in `src/lib/packs.ts`.
4. **Who teaches which hour**: `WEEKLY_SCHEDULE` in `src/lib/rota.ts` splits
   the week between the two instructors as a placeholder.
5. **Reformers in the room**: `capacity: 5` in `src/lib/studio.ts`. Count them.
6. **Prices**: the packs in `src/lib/packs.ts` are carried over from the
   previous studio as a market rate proposal. Confirm every price with RG.
7. **First class free**: the pricing page says so, because RG's members say
   so. Today it is fulfilled at the desk with a manual grant of one session;
   there is no automatic mechanism.
8. **Map**: paste the Google Maps embed URL into `mapsEmbedUrl` in
   `src/lib/studio.ts` to turn the contact page link into an embedded map.
9. **Hosting**: `render.yaml` names the service `rg-pilates`. Set
   `NEXT_PUBLIC_SITE_URL` to the real domain once it exists.
10. **Demo accounts**: run `npm run staff` to create RG's own owner and
    reception logins and retire the development ones.

## Getting started

```
npm install
npm run setup        # writes .env, pushes the schema, seeds the catalogue
npm run dev
```

Then `npm run typecheck`, `npm run test:flows` and `npm run test:http` before
any deploy. `npm run go-live` is the launch day reset described in
`docs/going-live.md`.
