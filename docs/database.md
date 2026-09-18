# The database

Generated from the database itself by `npm run docs:db`, so the columns and
types below cannot drift out of date. The prose is written by hand, in
`scripts/schema-doc.mjs`.

**20 tables · 184 columns · 12 unique indexes · 25 foreign keys**

---

## Where to look at it

```bash
npm run db:studio
```

Opens Drizzle Studio in a browser — every table, every row, editable. It reads
`dev.db` in the project root through the config in `drizzle.config.ts`.

Other ways in:

- **Any SQLite viewer** opens `dev.db` directly. [DB Browser for SQLite](https://sqlitebrowser.org)
  is free and runs on Windows; TablePlus is nicer and paid. The whole database is
  one file — copy it and you have a backup.
- `npm run db:peek` prints what is in there without opening anything: the file,
  its size, every table with its row count, and the six numbers somebody
  usually came for. `npm run db:peek -- users` shows one table's columns and
  its newest rows; `npm run db:peek -- "select ..."` runs a read-only query.
  Writes are refused at the driver *and* at the parser, because this is the tool
  you reach for on a live database while something is going wrong.
- `npm run diagnose:db` prints a health summary rather than the contents.
- `npm run reminders` prints the reminder queue and which accounts have devices.
- `npm run doctor` checks the whole setup: keys, providers, passwords, packs.

**Copy `dev.db-wal` too, or copy neither.** SQLite writes to a journal alongside
the database, so recent changes may live in `dev.db-wal` rather than `dev.db`. A
`dev.db` taken on its own can be hours behind.

---

## Conventions that hold everywhere

| | |
| --- | --- |
| **`id`** | Text, a UUID. No auto-incrementing integers anywhere. |
| **Timestamps** | `integer` — whole Unix **seconds**, not milliseconds. Two real bugs came from this: two things written in the same second tie, so ordering has to fall back to insertion order. |
| **Booleans** | `integer`, 0 or 1. |
| **Money** | Always `_cents` integers. No floating point near money, ever. |
| **`_en` / `_el`** | Anything a member reads exists twice. This is a bilingual studio. |
| **Nothing is deleted** | A withdrawn pack, a cancelled booking, a retired class type is switched off. Deleting a row somebody's receipt points at is how history goes missing. |

---

## People

Accounts, and the two things attached to one.

### `users`

Every account. Members and the studio's own desk logins share this table; `role` tells them apart.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `email` | text | unique |  |
| `name` | text |  |  |
| `phone` | text | optional, unique | Unique, like the email. One number, one member — otherwise two people share a handset and the desk cannot tell them apart on the phone. |
| `password_hash` | text |  | bcrypt. The plain password is never stored or logged. |
| `role` | text |  | MEMBER, STAFF (reception) or ADMIN (the owner). Reception cannot reach Analytics or another desk account. default `'MEMBER'` |
| `service_opt_in_at` | integer | optional | When they agreed to studio and timetable notices — a timestamp, not a checkbox, so consent is a record. |
| `marketing_opt_in` | integer |  | default `false` |
| `notify_email` | integer |  | default `true` |
| `notify_sms` | integer |  | default `false` |
| `notify_push` | integer |  | Not a preference. The studio keeps push on and the server refuses a request that tries to turn it off; only the browser can silence it. default `true` |
| `reminder_minutes` | integer | optional | How long before a class to remind them. Null means no reminder. New accounts start at 120. |
| `is_test` | integer |  | A dummy account the studio keeps for testing. Left out of campaigns and out of the member counts, and out of every figure in Analytics. default `false` |
| `birth_date` | text | optional |  |
| `height_cm` | integer | optional |  |
| `weight_grams` | integer | optional | Grams rather than kilograms, so no rounding creeps in over repeated edits. |
| `notes` | text | optional |  |
| `created_at` | integer |  |  |
| `email_verified_at` | integer | optional | When a code emailed to that address was typed back. Null means the account exists and can do nothing: no booking, no payment, not even its own profile page. |
| `erased_at` | integer | optional | When the member's personal details were erased at their request. The row survives because the payments attached to it are accounting records Cyprus requires kept for six years — see lib/erasure.ts. |
| `erased_by` | text | optional | Which member of staff did it. The whole audit trail for the one irreversible action in the console. |

**unique** on `phone` · **unique** on `email`

### `user_avatars`

The member's photograph, held in the database rather than on disk.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `user_id` | text | key, → `users` | One photo per member, so the member's id is the key. |
| `content_type` | text |  |  |
| `bytes` | integer |  |  |
| `data` | text |  | Base64. Keeping it here means a redeploy or a new machine cannot lose people's faces — the trade is a larger database file. |
| `updated_at` | integer |  |  |

### `push_subscriptions`

One row per browser that has allowed notifications. A member's phone and laptop are two rows.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `user_id` | text | → `users` |  |
| `endpoint` | text | unique | The address Google, Apple or Mozilla gave us for that browser. Unique, so re-subscribing updates rather than duplicating. |
| `p256dh` | text |  | The browser's public key. Every push is encrypted to it before it leaves. |
| `auth` | text |  |  |
| `user_agent` | text |  | default `''` |
| `created_at` | integer |  |  |
| `last_sent_at` | integer | optional |  |
| `failures` | integer |  | Counted, and the row is retired after eight. A 404 or 410 from the push service deletes it immediately — that browser is gone for good. default `0` |

index on `user_id` · **unique** on `endpoint`

### `email_verifications`

The live confirmation code for an account that has not proved its email address yet. One row per account at most, replaced on each resend.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `user_id` | text | unique, → `users` | Unique. A mailbox holding four codes that all still work is four chances for the wrong one to be lifted out of the wrong email. |
| `code_hash` | text |  | An HMAC of the six digits, keyed with AUTH_SECRET. The code itself is never stored — it is a credential, and six digits is a small enough space that a plain digest would be a lookup table. |
| `expires_at` | integer |  |  |
| `attempts` | integer |  | Wrong answers against the current code. Five kills it, and only a new code clears the count. default `0` |
| `sends` | integer |  | Codes sent inside the current hour. Five is the cap, so a stranger's address cannot be used as a way of posting mail to them. default `1` |
| `window_started_at` | integer |  | When the hourly allowance began. Rolling, not a running total, so nobody ends up permanently unable to confirm their own address. |
| `sent_at` | integer |  |  |
| `created_at` | integer |  |  |

**unique** on `user_id`

---

## The room

What the studio teaches, who teaches it, and when. A template is the weekly habit; a session is a class on a date.

### `class_types`

What the studio teaches. Reformer Flow, Reformer Strength, and so on.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `slug` | text | unique | The stable name used in code and URLs, so renaming a class in Greek breaks nothing. |
| `name_en` | text |  |  |
| `name_el` | text |  | Every member-facing string exists twice. This is a bilingual studio. |
| `desc_en` | text |  |  |
| `desc_el` | text |  |  |
| `level` | text |  | default `'ALL'` |
| `intensity` | integer |  | 1 to 3, shown as dots on the classes page. default `2` |
| `focus_en` | text |  | default `''` |
| `focus_el` | text |  | default `''` |
| `active` | integer |  | default `true` |
| `sort_order` | integer |  | default `0` |

**unique** on `slug`

### `instructors`

Who teaches. Shown on the timetable and the studio page.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `name` | text |  |  |
| `bio_en` | text |  | default `''` |
| `bio_el` | text |  | default `''` |
| `photo_url` | text | optional | Usually null: portraits are served from the app's own files, and a repair on read clears stale URLs. |
| `active` | integer |  | default `true` |
| `sort_order` | integer |  | default `0` |

### `class_templates`

The weekly rota — 'Reformer Flow, Mondays at 06:00'. **Nobody can book a template.** It is the pattern that classes are generated from.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `class_type_id` | text | → `class_types` |  |
| `instructor_id` | text | optional, → `instructors` |  |
| `day_of_week` | integer |  | 0 is Sunday, matching JavaScript. |
| `start_minutes` | integer |  | Minutes past midnight, in studio wall-clock time. 06:00 is 360, and it stays 06:00 in Larnaca whatever timezone the server runs in. |
| `duration_min` | integer |  | default `50` |
| `capacity` | integer |  | default `8` |
| `active` | integer |  | A template switched off stops generating new classes and leaves existing ones alone. default `true` |

index on `day_of_week`

### `class_sessions`

A real, bookable class on a real date. This is what the timetable shows and what a booking points at.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `class_type_id` | text | → `class_types` |  |
| `instructor_id` | text | optional, → `instructors` |  |
| `template_id` | text | optional, unique, → `class_templates` | Which rota entry produced it. Unique together with starts_at, which is why rolling the rota forward twice never doubles a class up. |
| `starts_at` | integer | unique | Whole Unix seconds. Generated from the template in studio wall-clock time. |
| `ends_at` | integer |  |  |
| `capacity` | integer |  | Copied from the template when the class is made, so changing the rota later does not silently resize a class people have already booked. default `8` |
| `status` | text |  | default `'SCHEDULED'` |
| `note` | text | optional |  |
| `created_at` | integer |  |  |

index on `starts_at` · **unique** on `template_id + starts_at`

### `studio_closures`

Days the studio is shut. Closing a day cancels every class on it and returns the sessions, even inside the 24-hour window.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `day` | text | unique | A date string rather than a timestamp — a closure is a calendar day, not an instant. |
| `reason_en` | text |  | default `''` |
| `reason_el` | text |  | default `''` |
| `created_by` | text | optional, → `users` |  |
| `created_at` | integer |  |  |

**unique** on `day`

---

## Booking

A member on a class, and the reminder that goes with it.

### `bookings`

One member on one class.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `user_id` | text | unique, → `users` | Unique together with session_id: the same member cannot book the same class twice. |
| `session_id` | text | unique, → `class_sessions` |  |
| `status` | text |  | CONFIRMED, CANCELLED, ATTENDED or NO_SHOW. default `'CONFIRMED'` |
| `credit_batch_id` | text | optional | Which batch the session came out of, so a refund goes back to the same one and its expiry date is preserved. |
| `credit_refunded` | integer |  | default `false` |
| `created_at` | integer |  |  |
| `cancelled_at` | integer | optional |  |

index on `session_id + status` · **unique** on `user_id + session_id`

### `booking_reminders`

The queue for 'your class starts in two hours'. Swept every sixty seconds by the server's own clock.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `booking_id` | text | unique, → `bookings` |  |
| `user_id` | text | → `users` |  |
| `due_at` | integer |  | When to send. Worked out from the member's lead time at the moment they booked. |
| `channels` | text |  | Which channels the member had on when they booked. The studio's own setting can narrow this but never widen it. |
| `sent_at` | integer | optional | Set once it has gone, whether or not a device was reached — otherwise every member who never allowed notifications would be retried forever. |
| `created_at` | integer |  |  |

**unique** on `booking_id` · index on `due_at`

---

## Money and sessions

Five tables, because a balance is not a number. What was on sale, what was paid, what was granted, what is left, and every change in between.

### `credit_packages`

The packs on sale. Single session, 5, 10, 20.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `slug` | text | unique |  |
| `name_en` | text |  |  |
| `name_el` | text |  |  |
| `credits` | integer |  |  |
| `price_cents` | integer |  | Cents, always. No floating point anywhere near money. |
| `validity_days` | integer |  | How long the sessions last from the day they are bought. default `90` |
| `badge` | text | optional |  |
| `active` | integer |  | A withdrawn pack is switched off, never deleted — purchases point at it and a deleted row would orphan somebody's receipt. default `true` |
| `sort_order` | integer |  | default `0` |

**unique** on `slug`

### `pricing_rules`

Discounts on top of pack prices, set at the desk.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `package_id` | text | optional, → `credit_packages` | Null means it applies to every pack. |
| `kind` | text |  | A percentage off or a fixed amount off. |
| `value` | integer |  |  |
| `label_en` | text |  | default `''` |
| `label_el` | text |  | default `''` |
| `active` | integer |  | default `true` |
| `created_by` | text | optional, → `users` |  |
| `created_at` | integer |  |  |

index on `active`

### `purchases`

A payment. Card payments and cash taken at the desk both land here, so 'has this member ever paid us' is one question with one answer.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `user_id` | text | → `users` |  |
| `package_id` | text | optional, → `credit_packages` |  |
| `credits` | integer |  |  |
| `amount_cents` | integer |  |  |
| `currency` | text |  | default `'eur'` |
| `status` | text |  | PENDING, PAID, FAILED or REFUNDED. Only PAID counts as a payment. default `'PENDING'` |
| `provider` | text |  | stripe, or cash / card taken at the desk. default `'stripe'` |
| `provider_ref` | text | optional | Stripe's own reference, or `desk:xxxxxxxx` naming the staff member who took it. |
| `stripe_session` | text | optional, unique |  |
| `stripe_intent` | text | optional | The PaymentIntent. How a webhook arriving later finds the right purchase. |
| `created_at` | integer |  |  |
| `paid_at` | integer | optional |  |

index on `user_id` · **unique** on `stripe_session`

### `credit_batches`

Sessions bought, as a batch with its own expiry. A member's balance is the sum of the batches that have not expired.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `user_id` | text | → `users` |  |
| `purchase_id` | text | optional, → `purchases` |  |
| `credits_total` | integer |  |  |
| `credits_remaining` | integer |  | Booking takes one from the batch expiring soonest, so nothing is quietly written off while a later batch is spent. |
| `source` | text |  | PURCHASE, GRANT or COMPENSATION. A comped session is not a purchase. default `'PURCHASE'` |
| `expires_at` | integer | optional | Null means never. Otherwise the sessions in this batch stop counting after it. |
| `usable_from` | integer | optional |  |
| `usable_to` | integer | optional |  |
| `created_at` | integer |  |  |

index on `user_id + expires_at`

### `credit_ledger`

Every change to every balance, ever, with a reason and a note saying who did it and why. Append-only in practice.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `user_id` | text | → `users` |  |
| `delta` | integer |  | Positive or negative. The balance is never edited in place without a line here. |
| `reason` | text |  | PURCHASE, BOOKING, CANCELLATION_REFUND, ADMIN_GRANT or EXPIRY. |
| `note` | text | optional | Free text, and it always names the staff member for anything done at the desk. This is the table that settles an argument at the counter. |
| `batch_id` | text | optional |  |
| `booking_id` | text | optional |  |
| `purchase_id` | text | optional |  |
| `created_at` | integer |  |  |

index on `user_id + created_at`

---

## Messages

One inbox for two kinds of message: the studio's announcements, and a member's own booking confirmations.

### `notices`

Messages from the studio. Announcements and a member's own booking confirmations share this table, because from the member's side they are one inbox with one unread count.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `title_en` | text |  |  |
| `body_en` | text |  |  |
| `title_el` | text |  | default `''` |
| `body_el` | text |  | default `''` |
| `audience` | text |  | ALL for studio and timetable notices, OFFERS for the opt-in audience. default `'ALL'` |
| `channels` | text |  | Which channels it went out on, e.g. `push,email`. The in-app copy is always written. default `''` |
| `included_test` | integer |  | Whether test accounts were deliberately included. Decides who may see it as well as who was sent it. default `false` |
| `segment` | text |  | Who it went to, in words: 'offers audience · never bought · away 30d+'. Stored because it cannot be reconstructed — the audience for 'not been for three months' is different today. default `''` |
| `user_id` | text | optional, → `users` | Null for an announcement to everybody. Set for a message about one person's own booking — which is invisible to every other member and kept out of the desk's history. |
| `important` | integer |  | default `false` |
| `created_by` | text | optional, → `users` |  |
| `created_at` | integer |  |  |

index on `user_id` · index on `created_at`

### `notice_reads`

Who has read what. Read state is stored as *presence*: a row means read.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `notice_id` | text | unique, → `notices` | Sending to four hundred members writes one notice row, not four hundred read rows — 'unread' costs a left join rather than a fan-out. |
| `user_id` | text | unique, → `users` |  |
| `read_at` | integer |  |  |

**unique** on `notice_id + user_id`

### `notice_deliveries`

What each channel actually did with each notice, so the history says `push 38 · email 41 (2 failed)` rather than the word 'sent'.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `notice_id` | text | → `notices` |  |
| `channel` | text |  |  |
| `sent` | integer |  | default `0` |
| `failed` | integer |  | default `0` |
| `skipped` | integer |  | Not a failure. It means the channel did not apply — no device, no consent, no phone number. default `0` |
| `detail` | text |  | The first few error messages, so forty refused emails are visible immediately rather than a week later. default `''` |
| `created_at` | integer |  |  |

index on `notice_id`

---

## The website

Anything the public side collects.

### `contact_messages`

The public contact form.

| Column | Type | | Notes |
| --- | --- | --- | --- |
| `id` | text | key |  |
| `name` | text |  |  |
| `email` | text |  |  |
| `phone` | text | optional |  |
| `message` | text |  |  |
| `handled` | integer |  | Ticked at the desk once somebody has replied. default `false` |
| `created_at` | integer |  |  |

---

## How fresh is the data?

**Instant.** There is no cache, no sync and no background job between the website
and the database. The registration route writes the row inside the request, so by
the time the browser has its answer the row exists. Measured:

```
registration ok: true (336ms)
separate read-only connection opened 3ms later found the row: true
```

That is a different connection, opened after the fact, reading the file — and it
sees the account. Same for a booking, a payment, a notice. `better-sqlite3` is
synchronous and single-writer, so there is nowhere for a stale read to hide.

Two things that *look* like a delay and are not:

- **Your viewer needs refreshing.** Drizzle Studio and DB Browser read once and
  hold what they read. Press refresh; the row was always there.
- **The journal, again.** A query against `dev.db` through a proper SQLite
  connection sees committed data immediately. A *file copy* of `dev.db` without
  `dev.db-wal` does not.

---

## How big does it get?

Measured rather than guessed: a throwaway copy filled with three years of a real
studio's volume — 400 members, the current 59-template rota, four of every class
booked, a pack every four months each — then weighed.

| | |
| --- | --- |
| Three years, 400 members, no photographs | **69 MB** |
| The same, every member with a photograph | **97 MB** |
| Growth | roughly **32 MB a year** at 400 members |

Where it goes:

| Table | Bytes |
| --- | --- |
| `notices` | 14.3 MB |
| `notice_reads` + its index | 15.3 MB |
| `bookings` + indexes | 11.6 MB |
| `booking_reminders` | 5.2 MB |
| `credit_ledger` + indexes | 8.6 MB |

`notices` leads because every booking and every purchase writes a personal
confirmation, in both languages. That is the cost of the member having a record
they can go back to, and it is a good trade at this size.

**On Render's disk pricing that is €0.25 a month.** Disks are billed per
gigabyte, the smallest is 1 GB, and 1 GB holds about thirty years of this studio.

The one thing that could change the arithmetic is **photographs**. They are
resized to 512×512 in the browser and capped at 256 KB, stored as base64 inside
the database. At the realistic 70 KB each, 400 members is 28 MB. If the cap were
ever raised, that term grows straight with the membership — and it is the only
term that does.

---

## Hosting it: what Render can and cannot do

Two shapes work. A third looks like it works and will lose your data.

### The free tier cannot run this

Three reasons, each fatal on its own:

- **A free web service spins down after 15 minutes without traffic**, and takes
  about a minute to wake. The reminder sweep runs on the server's own clock, and
  a spun-down server has no clock — so a member's two-hour reminder never goes
  out. That is the exact bug we just fixed, reintroduced by the hosting.
- **A free service's filesystem is ephemeral.** `dev.db` is deleted on every
  redeploy, restart and spin-down. Members, bookings and payments with it.
- **A free Postgres database expires 30 days after creation** and is deleted 14
  days after that.

### Looking at it once it is hosted

Render's dashboard has a database browser, and it is **not for this**: it is for
Render's own Postgres services. A SQLite file on a mounted disk is invisible to
it, and `npm run db:studio` cannot help either — Drizzle Studio reads a file on
the machine it runs on, so pointing it at a hosted studio opens an empty
database sitting next to the repository.

The way in is the service's **Shell** tab:

```bash
npm run db:peek                 # the file, the tables, the row counts
npm run db:peek -- users        # one table
npm run db:peek -- "select count(*) from bookings where status='CONFIRMED'"
```

To get a copy onto your own machine, where a graphical viewer can open it, take
a **disk snapshot** (the service's Disk tab keeps one per day for at least seven
days) rather than trying to move the file out through a shell. A file being
written to is not a file worth copying: SQLite keeps recent writes in
`rg.db-wal` beside it, so a half-copied pair is a database missing whatever
happened last.

### Browsing it in Render's dashboard: the Postgres mirror

`db:peek` answers questions you already know how to ask. Clicking around a table
looking for something odd is a different activity, and for that there is a
one-way copy in Postgres:

```bash
npm run db:mirror              # rebuild the copy, about a second
npm run db:mirror -- --dry     # say what it would do, write nothing
```

Then **Render dashboard → the Postgres service → Connect**, and every table is
browsable and queryable with the full run of SQL.

What it is:

- **A photograph, not a second original.** Every run drops the mirrored tables
  and rebuilds them. There is no delta logic, because a mirror that is clever
  about deltas is one that will eventually be subtly wrong.
- **One-way, always.** Nothing reads back from Postgres and nothing writes to
  SQLite. The source is opened with SQLite's read-only flag. A mistyped `update`
  in the dashboard cannot cost the studio a booking; it is simply gone on the
  next run.
- **Better typed than the original.** SQLite stores a date as an integer count of
  seconds, which is why `db:peek` shows `1801674000` where a person wanted
  `3 Feb 2027, 17:00`. Postgres has a real timestamp type, so the mirror converts
  on the way in and dates read as dates. Booleans stop being `0` and `1` too.
  Which columns are which is read out of `src/db/schema.ts` rather than guessed,
  so a column added there arrives in the mirror correctly typed without anyone
  remembering the script exists.
- **All or nothing.** The whole rebuild is one transaction. Nobody opening the
  dashboard mid-run sees a database that appears to have lost half the studio,
  and a failure anywhere leaves the previous copy untouched.
- `zz_mirror_info` holds one row saying when the copy was taken, so a member
  count read off it on Thursday cannot silently be Monday's.

Primary keys come across. Foreign keys, unique indexes and `NOT NULL` do not:
they would force the tables to be built in dependency order, and a constraint
tripping on a copy would stop the mirror over something that is not a problem in
a photograph.

**Setting it up.** One environment variable on the **web service** (not on the
Postgres service):

```
MIRROR_DATABASE_URL = <the Postgres service's Internal Database URL>
```

The Internal URL only resolves from inside Render, so run `db:mirror` from the
web service's Shell tab, not from your own machine.

> **Do not put that URL in `DATABASE_URL`.** That variable is a *file path*, and
> `src/db/index.ts` treats it as one. Handed `postgresql://…` it does not fail:
> it creates a new empty SQLite database in a directory literally named
> `postgresql:` and serves the studio from it, on the container's temporary
> filesystem, while the real data sits untouched on the disk. The deploy goes
> green and the site looks healthy, and every booking taken is deleted at the
> next restart. This happened once, on 3 September 2026, and it is why
> `db-mirror.mjs` refuses to run when `DATABASE_URL` looks like a connection
> string.

### A SQL prompt: `npm run db:sql`

```bash
npm run db:sql                      # an interactive prompt
npm run db:sql -- "select ..."      # one query and out
```

At the prompt, `\dt` lists the tables with row counts, `\d users` shows one
table's columns, `\q` leaves, and a statement runs when it ends in `;` so a long
join can be typed over several lines.

This points at the **mirror**, not at the studio's database, and that is what
makes it useful. `db:peek` is read-only and refuses anything that is not a
`select`, which is correct for a tool aimed at live bookings and makes it a poor
place to experiment. Here, anything is allowed on purpose:

```
sql> delete from bookings;
  ✓ delete 902
```

The studio's SQLite file still has all 902. The mirror is disposable, so the cost
of that mistake is one `npm run db:mirror`. A sandbox that punishes mistakes is
not a sandbox.

**It sets the session to the studio's timezone**, which matters more than it
sounds. Postgres defaults a connection to UTC and Cyprus is two or three hours
ahead, so left alone a 16:00 class in Larnaca prints as `13:00`, and
`starts_at::date` cuts the day at midnight UTC rather than at midnight in
Nicosia. The timezone is read out of `src/lib/studio.ts` rather than written
twice. If you query the mirror from anywhere else — Render's dashboard, pgAdmin,
`psql` — run this first, or dates will be an hour or two out:

```sql
set time zone 'Asia/Nicosia';
```

**Keeping it fresh.** It is deliberately manual: a mirror is for looking at, and
a person looking at it can type one command first. If it should refresh on its
own, the cheapest arrangement is a Render Cron Job in the same region running
`npm run db:mirror` — but note that a cron job is its own instance with its own
filesystem and *cannot see the web service's disk*, so it would have to be a
second copy of the app with the disk attached, which is not worth it. The better
answer, if this is wanted often, is a call to the mirror at the end of the
nightly reminder sweep.

### Option A — paid service with a persistent disk, keep SQLite

Almost no code change: point `DATABASE_URL` at a file on the mounted disk,
`file:/var/data/rg.db`, instead of the project folder.

- Render **snapshots the disk every 24 hours** and keeps snapshots at least seven
  days, so backups happen without you doing anything.
- **One instance only** — a service with a disk cannot scale out. Fine here: a
  studio is not traffic-bound, and one instance means one reminder clock, which
  is simpler than several.
- **No zero-downtime deploys.** Render stops the old instance before starting the
  new one, so each deploy has a few seconds of downtime.

For a studio with hundreds of members this is an adequate production setup, not a
compromise. This workload is a rounding error to SQLite.

### Option B — paid service plus Render Postgres

Managed, backed up, scales past one instance. Real work, but the SQLite-specific
surface is small and known:

| What | Where |
| --- | --- |
| The driver, and two pragmas | `src/db/index.ts` |
| `ensureSchema()`, which reads `PRAGMA table_info` | `src/db/migrate.ts` |
| Two `rowid` tie-breaks in ordering | `src/lib/notices.ts` |
| Timestamps as integer seconds → `timestamptz` | `src/db/schema.ts` |
| Booleans as 0/1 → real booleans | `src/db/schema.ts` |

Every other query in the codebase is portable SQL and would move unchanged. The
two `rowid` orderings get *simpler*: they exist only because whole-second
timestamps tie, and Postgres timestamps carry microseconds.

### Two websites, one database

Not with three-part names. Postgres has `schema.table`, and **you cannot query
across two databases in one connection** — so `rg.messages.notices` and
`ronaldo.messages.notices` cannot both be reachable if `rg` and `ronaldo`
are databases.

What does work:

**One database, one schema per site.**

```sql
select * from rg.notices;
select * from ronaldo.notices;
```

Two parts, not three. Both live in the same database, so both are reachable on one
connection — you can even join across them, which two databases could never do.
Drizzle declares it with `pgSchema("rg")` and every table name stays as it is.

Postgres has no sub-schemas, so there is no true third level. If you want the
grouping that `messages` implies, it goes in the name: `rg_messages`.

One instance means one lot of CPU, memory, disk and connections, and one restore
brings back *both* sites. For two small studio sites that is fine. The day one of
them matters more than the other, give it its own instance.

### Which

**A**, unless you expect to outgrow one instance. The reasons to pay for Postgres
are horizontal scaling, which a studio does not need, and managed backups, which
the disk snapshots already give you.

Whichever you pick: real secrets go in the host's environment variables and never
in the repo, `NEXT_PUBLIC_SITE_URL` points at the live domain or the links in
emails point at localhost, and the database gets reset before opening so the test
purchases are not sitting in the revenue figures.
