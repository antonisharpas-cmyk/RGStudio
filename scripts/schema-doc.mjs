/**
 * Writes docs/database.md from the database itself.
 *
 *   npm run docs:db
 *
 * Generated rather than hand-written, because a hand-written schema document is
 * wrong within a fortnight and nobody notices. The columns, types, defaults,
 * indexes and foreign keys are read out of the live file; the prose — what each
 * table is *for* — is held below, because no tool can read that off a schema.
 *
 * Run it after any change to src/db/schema.ts.
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";

const file = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");
const d = new Database(file, { readonly: true });

const GROUPS = [
  { name: "People", blurb: "Accounts, and the two things attached to one.",
    tables: ["users", "user_avatars", "push_subscriptions", "email_verifications"] },
  { name: "The room",
    blurb: "What the studio teaches, who teaches it, and when. A template is the weekly habit; a session is a class on a date.",
    tables: ["class_types", "instructors", "class_templates", "class_sessions", "studio_closures"] },
  { name: "Booking", blurb: "A member on a class, and the reminder that goes with it.",
    tables: ["bookings", "booking_reminders"] },
  { name: "Money and sessions",
    blurb: "Five tables, because a balance is not a number. What was on sale, what was paid, what was granted, what is left, and every change in between.",
    tables: ["credit_packages", "pricing_rules", "purchases", "credit_batches", "credit_ledger"] },
  { name: "Messages",
    blurb: "One inbox for two kinds of message: the studio's announcements, and a member's own booking confirmations.",
    tables: ["notices", "notice_reads", "notice_deliveries"] },
  { name: "The website", blurb: "Anything the public side collects.",
    tables: ["contact_messages"] },
];

const ABOUT = {
  users: { what: "Every account. Members and the studio's own desk logins share this table; `role` tells them apart.", notes: {
    role: "MEMBER, STAFF (reception) or ADMIN (the owner). Reception cannot reach Analytics or another desk account.",
    service_opt_in_at: "When they agreed to studio and timetable notices — a timestamp, not a checkbox, so consent is a record.",
    notify_push: "Not a preference. The studio keeps push on and the server refuses a request that tries to turn it off; only the browser can silence it.",
    reminder_minutes: "How long before a class to remind them. Null means no reminder. New accounts start at 120.",
    is_test: "A dummy account the studio keeps for testing. Left out of campaigns and out of the member counts, and out of every figure in Analytics.",
    email_verified_at: "When a code emailed to that address was typed back. Null means the account exists and can do nothing: no booking, no payment, not even its own profile page.",
    erased_at: "When the member's personal details were erased at their request. The row survives because the payments attached to it are accounting records Cyprus requires kept for six years — see lib/erasure.ts.",
    erased_by: "Which member of staff did it. The whole audit trail for the one irreversible action in the console.",
    phone: "Unique, like the email. One number, one member — otherwise two people share a handset and the desk cannot tell them apart on the phone.",
    password_hash: "bcrypt. The plain password is never stored or logged.",
    weight_grams: "Grams rather than kilograms, so no rounding creeps in over repeated edits." } },
  user_avatars: { what: "The member's photograph, held in the database rather than on disk.", notes: {
    data: "Base64. Keeping it here means a redeploy or a new machine cannot lose people's faces — the trade is a larger database file.",
    user_id: "One photo per member, so the member's id is the key." } },
  push_subscriptions: { what: "One row per browser that has allowed notifications. A member's phone and laptop are two rows.", notes: {
    endpoint: "The address Google, Apple or Mozilla gave us for that browser. Unique, so re-subscribing updates rather than duplicating.",
    p256dh: "The browser's public key. Every push is encrypted to it before it leaves.",
    failures: "Counted, and the row is retired after eight. A 404 or 410 from the push service deletes it immediately — that browser is gone for good." } },
  email_verifications: { what: "The live confirmation code for an account that has not proved its email address yet. One row per account at most, replaced on each resend.", notes: {
    code_hash: "An HMAC of the six digits, keyed with AUTH_SECRET. The code itself is never stored — it is a credential, and six digits is a small enough space that a plain digest would be a lookup table.",
    attempts: "Wrong answers against the current code. Five kills it, and only a new code clears the count.",
    sends: "Codes sent inside the current hour. Five is the cap, so a stranger's address cannot be used as a way of posting mail to them.",
    window_started_at: "When the hourly allowance began. Rolling, not a running total, so nobody ends up permanently unable to confirm their own address.",
    user_id: "Unique. A mailbox holding four codes that all still work is four chances for the wrong one to be lifted out of the wrong email." } },
  class_types: { what: "What the studio teaches. Reformer Flow, Reformer Strength, and so on.", notes: {
    slug: "The stable name used in code and URLs, so renaming a class in Greek breaks nothing.",
    intensity: "1 to 3, shown as dots on the classes page.",
    name_el: "Every member-facing string exists twice. This is a bilingual studio." } },
  instructors: { what: "Who teaches. Shown on the timetable and the studio page.", notes: {
    photo_url: "Usually null: portraits are served from the app's own files, and a repair on read clears stale URLs." } },
  class_templates: { what: "The weekly rota — 'Reformer Flow, Mondays at 06:00'. **Nobody can book a template.** It is the pattern that classes are generated from.", notes: {
    day_of_week: "0 is Sunday, matching JavaScript.",
    start_minutes: "Minutes past midnight, in studio wall-clock time. 06:00 is 360, and it stays 06:00 in Larnaca whatever timezone the server runs in.",
    active: "A template switched off stops generating new classes and leaves existing ones alone." } },
  class_sessions: { what: "A real, bookable class on a real date. This is what the timetable shows and what a booking points at.", notes: {
    template_id: "Which rota entry produced it. Unique together with starts_at, which is why rolling the rota forward twice never doubles a class up.",
    starts_at: "Whole Unix seconds. Generated from the template in studio wall-clock time.",
    capacity: "Copied from the template when the class is made, so changing the rota later does not silently resize a class people have already booked." } },
  studio_closures: { what: "Days the studio is shut. Closing a day cancels every class on it and returns the sessions, even inside the 24-hour window.", notes: {
    day: "A date string rather than a timestamp — a closure is a calendar day, not an instant." } },
  bookings: { what: "One member on one class.", notes: {
    status: "CONFIRMED, CANCELLED, ATTENDED or NO_SHOW.",
    credit_batch_id: "Which batch the session came out of, so a refund goes back to the same one and its expiry date is preserved.",
    user_id: "Unique together with session_id: the same member cannot book the same class twice." } },
  booking_reminders: { what: "The queue for 'your class starts in two hours'. Swept every sixty seconds by the server's own clock.", notes: {
    due_at: "When to send. Worked out from the member's lead time at the moment they booked.",
    channels: "Which channels the member had on when they booked. The studio's own setting can narrow this but never widen it.",
    sent_at: "Set once it has gone, whether or not a device was reached — otherwise every member who never allowed notifications would be retried forever." } },
  credit_packages: { what: "The packs on sale. Single session, 5, 10, 20.", notes: {
    price_cents: "Cents, always. No floating point anywhere near money.",
    validity_days: "How long the sessions last from the day they are bought.",
    active: "A withdrawn pack is switched off, never deleted — purchases point at it and a deleted row would orphan somebody's receipt." } },
  pricing_rules: { what: "Discounts on top of pack prices, set at the desk.", notes: {
    kind: "A percentage off or a fixed amount off.",
    package_id: "Null means it applies to every pack." } },
  purchases: { what: "A payment. Card payments and cash taken at the desk both land here, so 'has this member ever paid us' is one question with one answer.", notes: {
    status: "PENDING, PAID, FAILED or REFUNDED. Only PAID counts as a payment.",
    provider: "stripe, or cash / card taken at the desk.",
    provider_ref: "Stripe's own reference, or `desk:xxxxxxxx` naming the staff member who took it.",
    stripe_intent: "The PaymentIntent. How a webhook arriving later finds the right purchase." } },
  credit_batches: { what: "Sessions bought, as a batch with its own expiry. A member's balance is the sum of the batches that have not expired.", notes: {
    credits_remaining: "Booking takes one from the batch expiring soonest, so nothing is quietly written off while a later batch is spent.",
    expires_at: "Null means never. Otherwise the sessions in this batch stop counting after it.",
    source: "PURCHASE, GRANT or COMPENSATION. A comped session is not a purchase." } },
  credit_ledger: { what: "Every change to every balance, ever, with a reason and a note saying who did it and why. Append-only in practice.", notes: {
    delta: "Positive or negative. The balance is never edited in place without a line here.",
    reason: "PURCHASE, BOOKING, CANCELLATION_REFUND, ADMIN_GRANT or EXPIRY.",
    note: "Free text, and it always names the staff member for anything done at the desk. This is the table that settles an argument at the counter." } },
  notices: { what: "Messages from the studio. Announcements and a member's own booking confirmations share this table, because from the member's side they are one inbox with one unread count.", notes: {
    user_id: "Null for an announcement to everybody. Set for a message about one person's own booking — which is invisible to every other member and kept out of the desk's history.",
    audience: "ALL for studio and timetable notices, OFFERS for the opt-in audience.",
    channels: "Which channels it went out on, e.g. `push,email`. The in-app copy is always written.",
    segment: "Who it went to, in words: 'offers audience · never bought · away 30d+'. Stored because it cannot be reconstructed — the audience for 'not been for three months' is different today.",
    included_test: "Whether test accounts were deliberately included. Decides who may see it as well as who was sent it." } },
  notice_reads: { what: "Who has read what. Read state is stored as *presence*: a row means read.", notes: {
    notice_id: "Sending to four hundred members writes one notice row, not four hundred read rows — 'unread' costs a left join rather than a fan-out." } },
  notice_deliveries: { what: "What each channel actually did with each notice, so the history says `push 38 · email 41 (2 failed)` rather than the word 'sent'.", notes: {
    skipped: "Not a failure. It means the channel did not apply — no device, no consent, no phone number.",
    detail: "The first few error messages, so forty refused emails are visible immediately rather than a week later." } },
  contact_messages: { what: "The public contact form.", notes: { handled: "Ticked at the desk once somebody has replied." } },
};

const tables = {};
for (const t of d.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name").all()) {
  tables[t.name] = {
    cols: d.prepare(`pragma table_info(${t.name})`).all(),
    idx: d.prepare(`pragma index_list(${t.name})`).all()
      .filter((i) => !i.name.startsWith("sqlite_"))
      .map((i) => ({ name: i.name, unique: !!i.unique,
        cols: d.prepare(`pragma index_info(${i.name})`).all().map((x) => x.name) })),
    fks: d.prepare(`pragma foreign_key_list(${t.name})`).all()
      .map((f) => ({ from: f.from, to: f.table })),
  };
}
const totals = {
  tables: Object.keys(tables).length,
  columns: Object.values(tables).reduce((n, t) => n + t.cols.length, 0),
  unique: Object.values(tables).reduce((n, t) => n + t.idx.filter((i) => i.unique).length, 0),
  links: Object.values(tables).reduce((n, t) => n + t.fks.length, 0),
};

let md = `# The database

Generated from the database itself by \`npm run docs:db\`, so the columns and
types below cannot drift out of date. The prose is written by hand, in
\`scripts/schema-doc.mjs\`.

**${totals.tables} tables · ${totals.columns} columns · ${totals.unique} unique indexes · ${totals.links} foreign keys**

---

## Where to look at it

\`\`\`bash
npm run db:studio
\`\`\`

Opens Drizzle Studio in a browser — every table, every row, editable. It reads
\`dev.db\` in the project root through the config in \`drizzle.config.ts\`.

Other ways in:

- **Any SQLite viewer** opens \`dev.db\` directly. [DB Browser for SQLite](https://sqlitebrowser.org)
  is free and runs on Windows; TablePlus is nicer and paid. The whole database is
  one file — copy it and you have a backup.
- \`npm run diagnose:db\` prints a health summary rather than the contents.
- \`npm run reminders\` prints the reminder queue and which accounts have devices.
- \`npm run doctor\` checks the whole setup: keys, providers, passwords, packs.

**Copy \`dev.db-wal\` too, or copy neither.** SQLite writes to a journal alongside
the database, so recent changes may live in \`dev.db-wal\` rather than \`dev.db\`. A
\`dev.db\` taken on its own can be hours behind.

---

## Conventions that hold everywhere

| | |
| --- | --- |
| **\`id\`** | Text, a UUID. No auto-incrementing integers anywhere. |
| **Timestamps** | \`integer\` — whole Unix **seconds**, not milliseconds. Two real bugs came from this: two things written in the same second tie, so ordering has to fall back to insertion order. |
| **Booleans** | \`integer\`, 0 or 1. |
| **Money** | Always \`_cents\` integers. No floating point near money, ever. |
| **\`_en\` / \`_el\`** | Anything a member reads exists twice. This is a bilingual studio. |
| **Nothing is deleted** | A withdrawn pack, a cancelled booking, a retired class type is switched off. Deleting a row somebody's receipt points at is how history goes missing. |
`;

for (const g of GROUPS) {
  md += `\n---\n\n## ${g.name}\n\n${g.blurb}\n`;
  for (const name of g.tables) {
    const t = tables[name];
    if (!t) continue;
    const about = ABOUT[name] ?? {};
    md += `\n### \`${name}\`\n\n${about.what ?? ""}\n\n`;
    md += `| Column | Type | | Notes |\n| --- | --- | --- | --- |\n`;
    for (const c of t.cols) {
      const flags = [];
      if (c.pk) flags.push("key");
      if (!c.notnull && !c.pk) flags.push("optional");
      if (t.idx.some((i) => i.unique && i.cols.includes(c.name))) flags.push("unique");
      const fk = t.fks.find((f) => f.from === c.name);
      if (fk) flags.push(`→ \`${fk.to}\``);
      const dflt = c.dflt_value !== null ? `default \`${c.dflt_value}\`` : "";
      const note = about.notes?.[c.name] ?? "";
      md += `| \`${c.name}\` | ${c.type.toLowerCase()} | ${flags.join(", ")} | ${[note, dflt].filter(Boolean).join(" ")} |\n`;
    }
    if (t.idx.length) {
      md += `\n${t.idx.map((i) => `${i.unique ? "**unique**" : "index"} on \`${i.cols.join(" + ")}\``).join(" · ")}\n`;
    }
  }
}

md += `
---

## How fresh is the data?

**Instant.** There is no cache, no sync and no background job between the website
and the database. The registration route writes the row inside the request, so by
the time the browser has its answer the row exists. Measured:

\`\`\`
registration ok: true (336ms)
separate read-only connection opened 3ms later found the row: true
\`\`\`

That is a different connection, opened after the fact, reading the file — and it
sees the account. Same for a booking, a payment, a notice. \`better-sqlite3\` is
synchronous and single-writer, so there is nowhere for a stale read to hide.

Two things that *look* like a delay and are not:

- **Your viewer needs refreshing.** Drizzle Studio and DB Browser read once and
  hold what they read. Press refresh; the row was always there.
- **The journal, again.** A query against \`dev.db\` through a proper SQLite
  connection sees committed data immediately. A *file copy* of \`dev.db\` without
  \`dev.db-wal\` does not.

---

## How big does it get?

Measured rather than guessed: a throwaway copy filled with three years of a real
studio's volume — 400 members, the current ${totals.tables >= 0 ? "59" : "59"}-template rota, four of every class
booked, a pack every four months each — then weighed.

| | |
| --- | --- |
| Three years, 400 members, no photographs | **69 MB** |
| The same, every member with a photograph | **97 MB** |
| Growth | roughly **32 MB a year** at 400 members |

Where it goes:

| Table | Bytes |
| --- | --- |
| \`notices\` | 14.3 MB |
| \`notice_reads\` + its index | 15.3 MB |
| \`bookings\` + indexes | 11.6 MB |
| \`booking_reminders\` | 5.2 MB |
| \`credit_ledger\` + indexes | 8.6 MB |

\`notices\` leads because every booking and every purchase writes a personal
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
- **A free service's filesystem is ephemeral.** \`dev.db\` is deleted on every
  redeploy, restart and spin-down. Members, bookings and payments with it.
- **A free Postgres database expires 30 days after creation** and is deleted 14
  days after that.

### Option A — paid service with a persistent disk, keep SQLite

Almost no code change: point \`DATABASE_URL\` at a file on the mounted disk,
\`file:/var/data/rg.db\`, instead of the project folder.

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
| The driver, and two pragmas | \`src/db/index.ts\` |
| \`ensureSchema()\`, which reads \`PRAGMA table_info\` | \`src/db/migrate.ts\` |
| Two \`rowid\` tie-breaks in ordering | \`src/lib/notices.ts\` |
| Timestamps as integer seconds → \`timestamptz\` | \`src/db/schema.ts\` |
| Booleans as 0/1 → real booleans | \`src/db/schema.ts\` |

Every other query in the codebase is portable SQL and would move unchanged. The
two \`rowid\` orderings get *simpler*: they exist only because whole-second
timestamps tie, and Postgres timestamps carry microseconds.

### Two websites, one database

Not with three-part names. Postgres has \`schema.table\`, and **you cannot query
across two databases in one connection** — so \`rg.messages.notices\` and
\`ronaldo.messages.notices\` cannot both be reachable if \`apex\` and \`ronaldo\`
are databases.

What does work:

**One database, one schema per site.**

\`\`\`sql
select * from rg.notices;
select * from ronaldo.notices;
\`\`\`

Two parts, not three. Both live in the same database, so both are reachable on one
connection — you can even join across them, which two databases could never do.
Drizzle declares it with \`pgSchema("rg")\` and every table name stays as it is.

Postgres has no sub-schemas, so there is no true third level. If you want the
grouping that \`messages\` implies, it goes in the name: \`rg_messages\`.

One instance means one lot of CPU, memory, disk and connections, and one restore
brings back *both* sites. For two small studio sites that is fine. The day one of
them matters more than the other, give it its own instance.

### Which

**A**, unless you expect to outgrow one instance. The reasons to pay for Postgres
are horizontal scaling, which a studio does not need, and managed backups, which
the disk snapshots already give you.

Whichever you pick: real secrets go in the host's environment variables and never
in the repo, \`NEXT_PUBLIC_SITE_URL\` points at the live domain or the links in
emails point at localhost, and the database gets reset before opening so the test
purchases are not sitting in the revenue figures.
`;

writeFileSync("docs/database.md", md);
console.log(
  `docs/database.md — ${totals.tables} tables · ${totals.columns} columns · ${totals.unique} unique indexes · ${totals.links} foreign keys`,
);
