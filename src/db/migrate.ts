import type Database from "better-sqlite3";
import { studioEndOfDay } from "@/lib/time";

/**
 * Bring an existing database up to the current schema, on connect.
 *
 * Why this exists rather than "remember to run `npm run db:push`": every time
 * this project has grown a column, the change has landed in the repo and then
 * failed on a machine that had already been set up, because the schema lives in
 * the database and the database is not in the repo. A missing column is not a
 * cosmetic difference either — it is a crash on the homepage, which is exactly
 * what happened here with `service_opt_in_at`.
 *
 * So the app repairs its own shape. This is a small, additive, idempotent
 * migration: it only ever adds columns, tables and indexes that are absent, and
 * never drops, renames or rewrites anything. `npm run db:push` still works and
 * remains the tool for real schema changes; this is the safety net that means
 * pulling the repo and starting the server is enough.
 *
 * Each entry must match src/db/schema.ts exactly. When you add a column there,
 * add it here too.
 */

type Column = { name: string; ddl: string };

const COLUMNS: Record<string, Column[]> = {
  users: [
    { name: "service_opt_in_at", ddl: "integer" },
    { name: "marketing_opt_in", ddl: "integer default 0 not null" },
    { name: "locale", ddl: "text" },
    { name: "notify_email", ddl: "integer default 1 not null" },
    { name: "notify_sms", ddl: "integer default 0 not null" },
    { name: "notify_push", ddl: "integer default 1 not null" },
    { name: "is_test", ddl: "integer default 0 not null" },
    { name: "email_verified_at", ddl: "integer" },
    { name: "erased_at", ddl: "integer" },
    { name: "erased_by", ddl: "text" },
    { name: "reminder_minutes", ddl: "integer" },
    { name: "birth_date", ddl: "text" },
    { name: "height_cm", ddl: "integer" },
    { name: "weight_grams", ddl: "integer" },
    { name: "notes", ddl: "text" },
    { name: "terms_accepted_at", ddl: "integer" },
    { name: "intake_at", ddl: "integer" },
    { name: "pilates_level", ddl: "text" },
    { name: "pilates_since", ddl: "text" },
    { name: "health_condition", ddl: "text" },
  ],
  instructors: [
    { name: "photo_url", ddl: "text" },
    { name: "bio_ru", ddl: "text default '' not null" },
    { name: "edited_at", ddl: "integer" },
    { name: "roster_key", ddl: "text" },
  ],
  purchases: [
    { name: "provider_ref", ddl: "text" },
    { name: "receipt_url", ddl: "text" },
    { name: "invoice_no", ddl: "text" },
    { name: "invoice_year", ddl: "integer" },
    { name: "invoice_seq", ddl: "integer" },
    { name: "promo_code", ddl: "text" },
    { name: "promo_discount_cents", ddl: "integer" },
    { name: "subscription_id", ddl: "text" },
  ],
  /* The spend window — which class dates a batch may be paid towards, which is
     a different question from when the batch expires. See lib/promo.ts. */
  credit_batches: [
    { name: "usable_from", ddl: "integer" },
    { name: "usable_to", ddl: "integer" },
    /* What the sessions in this batch buy, and how many a day they may buy.
       See the columns in schema.ts for why a kind rather than a window. */
    { name: "kind", ddl: "text default 'CLASS' not null" },
    { name: "per_day_limit", ddl: "integer" },
    { name: "subscription_id", ddl: "text" },
    { name: "frozen_at", ddl: "integer" },
  ],
  credit_packages: [
    { name: "kind", ddl: "text default 'CLASS' not null" },
    { name: "per_day_limit", ddl: "integer" },
    { name: "seats", ddl: "integer default 1 not null" },
    { name: "price_edited_at", ddl: "integer" },
    { name: "edited_at", ddl: "integer" },
    { name: "pack_group", ddl: "text" },
  ],
  class_types: [{ name: "kind", ddl: "text default 'GROUP' not null" }],
  /* The class level, added after launch. Nullable, reads as ALL when absent, so
     every existing class stays "All levels" until the desk says otherwise. */
  class_templates: [{ name: "level", ddl: "text" }],
  class_sessions: [{ name: "level", ddl: "text" }],
  bookings: [{ name: "guest_name", ddl: "text" }],
  notices: [
    { name: "channels", ddl: "text default '' not null" },
    { name: "user_id", ddl: "text references users(id) on delete cascade" },
    { name: "included_test", ddl: "integer default 0 not null" },
    { name: "segment", ddl: "text default '' not null" },
  ],
};

const TABLES: { name: string; ddl: string }[] = [
  {
    name: "user_avatars",
    ddl: `create table user_avatars (
            user_id text primary key not null
              references users(id) on delete cascade,
            content_type text not null,
            bytes integer not null,
            data text not null,
            updated_at integer not null
          )`,
  },
  {
    name: "booking_reminders",
    ddl: `create table booking_reminders (
            id text primary key not null,
            booking_id text not null
              references bookings(id) on delete cascade,
            user_id text not null
              references users(id) on delete cascade,
            due_at integer not null,
            channels text not null,
            sent_at integer,
            created_at integer not null
          )`,
  },
  {
    name: "studio_closures",
    ddl: `create table studio_closures (
            id text primary key not null,
            day text not null,
            reason_en text default '' not null,
            reason_el text default '' not null,
            created_by text references users(id),
            created_at integer not null
          )`,
  },
  {
    name: "notices",
    ddl: `create table notices (
            id text primary key not null,
            title_en text not null,
            body_en text not null,
            title_el text default '' not null,
            body_el text default '' not null,
            audience text default 'ALL' not null,
            channels text default '' not null,
            user_id text references users(id) on delete cascade,
            included_test integer default 0 not null,
            segment text default '' not null,
            important integer default 0 not null,
            created_by text references users(id),
            created_at integer not null
          )`,
  },
  {
    name: "notice_reads",
    ddl: `create table notice_reads (
            notice_id text not null references notices(id) on delete cascade,
            user_id text not null references users(id) on delete cascade,
            read_at integer not null
          )`,
  },
  {
    name: "pricing_rules",
    ddl: `create table pricing_rules (
            id text primary key not null,
            package_id text references credit_packages(id) on delete cascade,
            kind text not null,
            value integer not null,
            label_en text default '' not null,
            label_el text default '' not null,
            active integer default 1 not null,
            created_by text references users(id),
            created_at integer not null
          )`,
  },
  {
    name: "subscriptions",
    ddl: `create table subscriptions (
            id text primary key not null,
            user_id text not null references users(id) on delete cascade,
            months integer not null,
            per_week integer not null,
            monthly_price_cents integer not null,
            total_credits integer not null,
            status text default 'PENDING' not null,
            started_at integer,
            ends_at integer,
            paid_through integer,
            months_paid integer default 0 not null,
            grace_days integer default 3 not null,
            batch_id text,
            reminded_for integer,
            lapsed_at integer,
            cancelled_at integer,
            created_by text,
            created_at integer not null
          )`,
  },
  {
    name: "promo_codes",
    ddl: `create table promo_codes (
            id text primary key not null,
            code text not null,
            kind text not null,
            value integer not null,
            package_id text references credit_packages(id) on delete set null,
            active integer default 1 not null,
            valid_from integer,
            valid_until integer,
            max_uses integer,
            uses integer default 0 not null,
            created_by text references users(id),
            created_at integer not null
          )`,
  },
  {
    name: "instructor_photos",
    ddl: `create table instructor_photos (
            instructor_id text primary key not null
              references instructors(id) on delete cascade,
            content_type text not null,
            data text not null,
            updated_at integer not null
          )`,
  },
  {
    name: "password_resets",
    ddl: `create table password_resets (
            id text primary key not null,
            user_id text not null references users(id) on delete cascade,
            token_hash text not null,
            expires_at integer not null,
            used_at integer,
            created_at integer not null
          )`,
  },
  {
    name: "push_subscriptions",
    ddl: `create table push_subscriptions (
            id text primary key not null,
            user_id text not null references users(id) on delete cascade,
            endpoint text not null,
            p256dh text not null,
            auth text not null,
            user_agent text default '' not null,
            created_at integer not null,
            last_sent_at integer,
            failures integer default 0 not null
          )`,
  },
  {
    name: "notice_deliveries",
    ddl: `create table notice_deliveries (
            id text primary key not null,
            notice_id text not null references notices(id) on delete cascade,
            channel text not null,
            sent integer default 0 not null,
            failed integer default 0 not null,
            skipped integer default 0 not null,
            detail text default '' not null,
            created_at integer not null
          )`,
  },
  {
    name: "email_verifications",
    ddl: `create table email_verifications (
            id text primary key not null,
            user_id text not null
              references users(id) on delete cascade,
            code_hash text not null,
            expires_at integer not null,
            attempts integer default 0 not null,
            sends integer default 1 not null,
            window_started_at integer not null,
            sent_at integer not null,
            created_at integer not null
          )`,
  },
];

const INDEXES: { name: string; ddl: string }[] = [
  {
    name: "email_verifications_user_idx",
    ddl: "create unique index email_verifications_user_idx on email_verifications (user_id)",
  },
  {
    /* One invoice number, once. The sequence is handed out by reading the
       highest and adding one; this is what makes a duplicate impossible rather
       than merely unlikely, on a document a tax authority may audit. */
    name: "purchases_invoice_no_idx",
    ddl: "create unique index purchases_invoice_no_idx on purchases (invoice_no)",
  },
  {
    name: "booking_reminders_due_idx",
    ddl: "create index booking_reminders_due_idx on booking_reminders (due_at)",
  },
  {
    name: "booking_reminders_booking_idx",
    ddl: "create unique index booking_reminders_booking_idx on booking_reminders (booking_id)",
  },
  {
    name: "studio_closures_day_idx",
    ddl: "create unique index studio_closures_day_idx on studio_closures (day)",
  },
  {
    name: "notices_created_idx",
    ddl: "create index notices_created_idx on notices (created_at)",
  },
  {
    name: "notices_user_idx",
    ddl: "create index notices_user_idx on notices (user_id)",
  },
  {
    name: "notice_reads_idx",
    ddl: "create unique index notice_reads_idx on notice_reads (notice_id, user_id)",
  },
  {
    name: "subscriptions_user_idx",
    ddl: "create index subscriptions_user_idx on subscriptions (user_id, status)",
  },
  {
    name: "promo_codes_code_idx",
    ddl: "create unique index promo_codes_code_idx on promo_codes (code)",
  },
  {
    name: "pricing_rules_active_idx",
    ddl: "create index pricing_rules_active_idx on pricing_rules (active)",
  },
  {
    name: "password_resets_user_idx",
    ddl: "create unique index password_resets_user_idx on password_resets (user_id)",
  },
  {
    name: "push_endpoint_idx",
    ddl: "create unique index push_endpoint_idx on push_subscriptions (endpoint)",
  },
  {
    name: "push_user_idx",
    ddl: "create index push_user_idx on push_subscriptions (user_id)",
  },
  {
    name: "notice_deliveries_idx",
    ddl: "create index notice_deliveries_idx on notice_deliveries (notice_id)",
  },
];

function tableExists(conn: Database.Database, name: string) {
  return Boolean(
    conn
      .prepare("select name from sqlite_master where type='table' and name=?")
      .get(name),
  );
}

function indexExists(conn: Database.Database, name: string) {
  return Boolean(
    conn
      .prepare("select name from sqlite_master where type='index' and name=?")
      .get(name),
  );
}

/** Returns a short list of what it changed, for the dev-server log. */
export function ensureSchema(conn: Database.Database): string[] {
  const applied: string[] = [];

  /* Nothing to do on a database that has not been created yet — db:push or the
     seed builds it from the schema, which is already current. */
  if (!tableExists(conn, "users")) return applied;

  for (const [table, columns] of Object.entries(COLUMNS)) {
    if (!tableExists(conn, table)) continue;
    const present = new Set(
      (
        conn.prepare(`pragma table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name),
    );
    for (const col of columns) {
      if (present.has(col.name)) continue;
      conn
        .prepare(`alter table ${table} add column ${col.name} ${col.ddl}`)
        .run();
      applied.push(`${table}.${col.name}`);
    }
  }

  for (const t of TABLES) {
    if (tableExists(conn, t.name)) continue;
    conn.prepare(t.ddl).run();
    applied.push(`table ${t.name}`);
  }

  for (const i of INDEXES) {
    /* The index needs its table, which may only just have been created. */
    if (indexExists(conn, i.name)) continue;
    const on = i.ddl.match(/ on (\w+) /)?.[1];
    if (on && !tableExists(conn, on)) continue;
    conn.prepare(i.ddl).run();
    applied.push(`index ${i.name}`);
  }

  /**
   * Accounts that predate email verification are verified.
   *
   * They were created when registering was the whole of registering, so they
   * never had a code to type and there is nobody to send one to retrospectively.
   * Leaving them null would lock every existing member — including the owner's
   * own account — out of a site they have been using for weeks.
   *
   * Runs only in the boot that adds the column, which is what makes it a
   * backfill rather than a rule: from here on, null means unverified and is
   * enforced.
   */
  if (applied.includes("users.email_verified_at")) {
    const n = conn
      .prepare(
        "update users set email_verified_at = unixepoch() where email_verified_at is null",
      )
      .run().changes;
    if (n > 0) applied.push(`users.email_verified_at backfilled for ${n}`);
  }

  /**
   * The two uniqueness rules on an account, added to a database that may already
   * break them.
   *
   * These are not in the list above because that list assumes an index can
   * always be created, and a unique index cannot: if the data already holds two
   * members with one phone number, `create unique index` throws, and a throw
   * here happens on connect — which would take the whole site down over
   * something a person can fix in the desk in twenty seconds.
   *
   * So each one looks first and skips itself if the data would refuse it,
   * reporting the clash instead. A fresh database, and any database somebody has
   * tidied, gets the constraint; a dirty one keeps running with the
   * application-level check that was there before.
   */
  for (const rule of [
    { index: "users_email_idx", column: "email" },
    { index: "users_phone_idx", column: "phone" },
  ]) {
    if (indexExists(conn, rule.index)) continue;
    const dupe = conn
      .prepare(
        `select ${rule.column} as v, count(*) as n from users
          where ${rule.column} is not null and trim(${rule.column}) <> ''
          group by ${rule.column} having n > 1 limit 1`,
      )
      .get() as { v: string; n: number } | undefined;
    if (dupe) {
      applied.push(
        `index ${rule.index} SKIPPED — ${dupe.n} accounts share ${rule.column} "${dupe.v}"`,
      );
      continue;
    }
    /* Partial, so a blank string is not treated as a value. NULLs are already
       distinct to SQLite; empty strings are not, and a second account with no
       number typed as "" would otherwise collide with the first. */
    conn
      .prepare(
        `create unique index ${rule.index} on users (${rule.column})
           where ${rule.column} is not null and trim(${rule.column}) <> ''`,
      )
      .run();
    applied.push(`index ${rule.index}`);
  }

  /**
   * Two corrections to session batches already in the database.
   *
   * Both were bugs in how a batch was created, so fixing the code fixes every
   * future purchase and leaves every existing one wrong. The studio's own test
   * accounts and the owner's balance are existing ones, so without this the
   * behaviour they see while testing would not be the behaviour they shipped.
   *
   * **The class window.** `expires_at` said when a session could be *spent* and
   * nothing said what it could be spent *on*, so a 30-day pack could book a
   * class in November. `usable_to` is the bound that fixes it, and for an
   * ordinary pack it is simply the expiry. Batches with a `usable_from` are left
   * alone: those are opening-week sessions, which carry a real window of their
   * own and must keep it.
   *
   * **The hour of expiry.** A pack bought at 14:53 expired at 14:53 on its last
   * day, while the member's account showed only the date. Rounded up to the end
   * of that day in Larnaca, which is the date they were shown.
   *
   * Both are naturally idempotent: the first matches only rows with a null
   * window, and the second only rows that are not already at the end of a day.
   * The rounding is done in JavaScript rather than SQL because SQLite has no
   * timezone database and "the end of the day in Nicosia" is two different UTC
   * offsets depending on the month.
   */
  if (tableExists(conn, "credit_batches")) {
    const rows = conn
      .prepare(
        `select id, expires_at as expiresAt, usable_to as usableTo,
                usable_from as usableFrom
           from credit_batches
          where expires_at is not null`,
      )
      .all() as {
      id: string;
      expiresAt: number;
      usableTo: number | null;
      usableFrom: number | null;
    }[];

    const setBoth = conn.prepare(
      "update credit_batches set expires_at = ?, usable_to = ? where id = ?",
    );
    const setExpiry = conn.prepare(
      "update credit_batches set expires_at = ? where id = ?",
    );

    let rounded = 0;
    let windowed = 0;
    for (const row of rows) {
      const wanted = Math.floor(
        studioEndOfDay(new Date(row.expiresAt * 1000)).getTime() / 1000,
      );
      const needsRounding = row.expiresAt !== wanted;
      /* Only an ordinary pack gets its expiry copied into the window. */
      const needsWindow = row.usableTo === null && row.usableFrom === null;

      if (needsWindow) {
        setBoth.run(wanted, wanted, row.id);
        windowed++;
        if (needsRounding) rounded++;
      } else if (needsRounding) {
        setExpiry.run(wanted, row.id);
        rounded++;
      }
    }
    if (rounded > 0) applied.push(`credit_batches.expires_at rounded on ${rounded}`);
    if (windowed > 0) applied.push(`credit_batches.usable_to set on ${windowed}`);
  }

  /* Push stopped being a preference and became a constant: the studio keeps it
     on, and only the member's browser or phone can silence it. Accounts created
     while it was still a switch may hold a 0, which would quietly exclude them
     from every push for good. Idempotent, and it writes nothing once done. */
  if (tableExists(conn, "users")) {
    const stale = conn
      .prepare("select count(*) as n from users where notify_push = 0")
      .get() as { n: number };
    if (stale.n > 0) {
      conn.prepare("update users set notify_push = 1 where notify_push = 0").run();
      applied.push(`users.notify_push on for ${stale.n} accounts`);
    }
  }

  return applied;
}
