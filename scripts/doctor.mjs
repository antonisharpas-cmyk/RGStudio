/**
 * One command that says whether this installation is healthy.
 *
 *   npm run doctor
 *
 * Exists because "I cannot log in" is impossible to act on from a distance,
 * and every diagnosis so far has come down to the same handful of things:
 * a database that predates the current schema, a catalogue that predates the
 * current price list, or a rota that predates the current room. This checks
 * all of them and prints what is wrong in one screen.
 */
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { existsSync, readFileSync } from "node:fs";

/**
 * The class length and capacity, read out of lib/studio.ts.
 *
 * Doctor is plain ESM so it cannot import a TypeScript module, and the numbers
 * were therefore written out here as 3600 and 5. That made the health check the
 * last place to learn about a change: when the studio moved to fifty-minute
 * classes, doctor reported every correctly generated class as "on an older
 * rota". Reading the constants beats remembering them.
 */
const studioSrc = existsSync("src/lib/studio.ts")
  ? readFileSync("src/lib/studio.ts", "utf8")
  : "";
const studioNumber = (key, fallback) =>
  Number(new RegExp(`${key}:\\s*(\\d+)`).exec(studioSrc)?.[1] ?? fallback);
const CLASS_MINUTES = studioNumber("classLengthMinutes", 50);
const CLASS_SECONDS = CLASS_MINUTES * 60;
const CAPACITY = studioNumber("capacity", 5);

/* Read .env the way the server does, so this check reports what the app will
   actually see rather than what happens to be in the shell. Values are used to
   answer yes/no questions and are never printed. */
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const file = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");

let problems = 0;
let warnings = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m, fix) => {
  warnings++;
  console.log(`  \x1b[33m!\x1b[0m ${m}`);
  if (fix) console.log(`      → ${fix}`);
};
const bad = (m, fix) => {
  problems++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (fix) console.log(`      → ${fix}`);
};

console.log(`\n\x1b[1mRG Pilates Studio — installation check\x1b[0m`);
console.log(`\x1b[2mdatabase: ${file}\x1b[0m\n`);

if (!existsSync(file)) {
  bad("the database file does not exist", "npm run db:push && npm run db:seed");
  console.log("");
  process.exit(1);
}

const conn = new Database(file, { readonly: true });
const tables = new Set(
  conn.prepare("select name from sqlite_master where type='table'").all().map((t) => t.name),
);

console.log("Tables");
for (const t of [
  "users",
  "class_types",
  "class_templates",
  "class_sessions",
  "bookings",
  "credit_packages",
  "credit_batches",
  "credit_ledger",
  "instructors",
  "user_avatars",
  "booking_reminders",
  "studio_closures",
  "notices",
  "notice_reads",
  "pricing_rules",
]) {
  if (tables.has(t)) ok(t);
  else bad(`${t} is missing`, "restart the server, or npm run db:push");
}

console.log("\nColumns the app needs");
const cols = (t) =>
  new Set(conn.prepare(`pragma table_info(${t})`).all().map((c) => c.name));
if (tables.has("users")) {
  const u = cols("users");
  for (const c of [
    "service_opt_in_at",
    "marketing_opt_in",
    "notify_email",
    "notify_sms",
    "notify_push",
    "reminder_minutes",
    "birth_date",
    "height_cm",
    "weight_grams",
  ]) {
    if (u.has(c)) ok(`users.${c}`);
    else bad(`users.${c} is missing`, "restart the server so the migration runs");
  }
}
if (tables.has("instructors")) {
  cols("instructors").has("photo_url")
    ? ok("instructors.photo_url")
    : bad("instructors.photo_url is missing", "restart the server");
}
if (tables.has("purchases")) {
  /* Where a payment provider's own reference is kept, whoever the provider is.
     Without it every attempt to take a card fails on the insert. */
  cols("purchases").has("provider_ref")
    ? ok("purchases.provider_ref")
    : bad("purchases.provider_ref is missing", "restart the server");
}

console.log("\nAccounts");
if (tables.has("users")) {
  const n = conn.prepare("select count(*) as n from users").get().n;
  n > 0 ? ok(`${n} account${n === 1 ? "" : "s"}`) : bad("no accounts at all", "npm run db:seed");
  /* Two roles, and they are not interchangeable: an owner sees the takings, a
     receptionist runs the desk without them. A studio with no owner account
     cannot read its own numbers; one with no reception account is running the
     desk from the owner's login, which defeats the split. */
  const owners = conn
    .prepare("select count(*) as n from users where role = 'ADMIN'")
    .get().n;
  const reception = conn
    .prepare("select count(*) as n from users where role = 'STAFF'")
    .get().n;
  owners > 0
    ? ok(`${owners} owner account${owners === 1 ? "" : "s"} (analytics and the keys)`)
    : bad("no owner account — nobody can read the studio's numbers",
          'npm run staff -- add you@rgpilatesstudio.com "Your Name" owner');
  reception > 0
    ? ok(`${reception} reception account${reception === 1 ? "" : "s"} (the desk, no analytics)`)
    : warn("no reception account — the desk is being run from an owner login",
           'npm run staff -- add reception@rgpilatesstudio.com "Reception" reception');

  /* The seeded development passwords must not survive into a real studio. */
  const seeded = conn
    .prepare(
      "select email, password_hash from users where role in ('ADMIN','STAFF')",
    )
    .all();
  const stillDefault = seeded.filter((u) =>
    ["ownerdev123", "receptiondev123", "rgadmin123"].some((p) =>
      bcrypt.compareSync(p, u.password_hash),
    ),
  );
  /* Accounts that registered and never typed the code. A handful is normal —
     people abandon signups. A lot of them, or any at all when email is in log
     mode, is the studio quietly turning people away at the door. */
  const unverified = conn
    .prepare(
      `select count(*) as n from users
        where role = 'MEMBER' and is_test = 0 and erased_at is null
          and email_verified_at is null`,
    )
    .get().n;
  unverified === 0
    ? ok("every member has confirmed their email address")
    : warn(
        `${unverified} account${unverified === 1 ? "" : "s"} registered but never confirmed the emailed code, ` +
          `so they cannot book or pay yet`,
        "check the email provider is really sending; the desk shows the flag on each member",
      );

  /* Should be impossible now: an unconfirmed account cannot book, cannot pay, and
     cannot be sold to at the desk. For one version it could, and any row left over
     from then is a real customer the studio cannot email. Reported rather than
     swept, because the sweep must never delete a record of money. */
  const stuck = conn
    .prepare(
      `select u.email from users u
        where u.role = 'MEMBER' and u.email_verified_at is null
          and u.erased_at is null
          and u.created_at < unixepoch() - 7 * 86400
          and ((select count(*) from purchases p where p.user_id = u.id) > 0
            or (select count(*) from credit_batches b where b.user_id = u.id) > 0
            or (select count(*) from bookings k where k.user_id = u.id) > 0)`,
    )
    .all()
    .map((r) => r.email);
  if (stuck.length > 0) {
    warn(
      `${stuck.length} unconfirmed account${stuck.length === 1 ? " has" : "s have"} sessions or payments on it, ` +
        `which should no longer be possible: ` +
        stuck.join(", "),
      "correct the email on the member's page, then ask them to sign in and request a new code",
    );
  }

  stillDefault.length === 0
    ? ok("no desk account is still on its development password")
    : warn(
        `${stillDefault.length} desk account${stillDefault.length === 1 ? " is" : "s are"} still on the development password: ` +
          stillDefault.map((u) => u.email).join(", "),
        "npm run staff -- password <email>   (before going live)",
      );
}

console.log("\nGetting a message out");
{
  const push = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  push
    ? ok("push: keys in place (no account needed, no cost)")
    : warn("push: no VAPID keys, so no notification can be delivered",
           "npm run push:keys   then paste the three lines into .env");

  const devices = tables.has("push_subscriptions")
    ? conn.prepare("select count(*) as n from push_subscriptions").get().n
    : 0;
  ok(`${devices} device${devices === 1 ? "" : "s"} have allowed notifications`);

  const email = (process.env.EMAIL_PROVIDER ?? "log").toLowerCase();
  const sms = (process.env.SMS_PROVIDER ?? "log").toLowerCase();
  const emailKeyed =
    (email === "smtp" &&
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS) ||
    (email === "resend" && process.env.RESEND_API_KEY) ||
    (email === "brevo" && process.env.BREVO_API_KEY);
  const smsKeyed =
    (sms === "smsto" && process.env.SMSTO_API_KEY && process.env.SMS_SENDER) ||
    (sms === "twilio" &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM) ||
    (sms === "brevo" && process.env.BREVO_API_KEY && process.env.SMS_SENDER);

  /**
   * Email stopped being optional the day registration started needing it.
   *
   * In log mode nothing leaves the building, which used to mean "no receipts" —
   * a shame, not a fault. It now means the confirmation code never arrives, and
   * an account that cannot be confirmed cannot book, pay, or reach its own
   * profile. So nobody can join the studio at all. That is a `bad`, not a `!`.
   */
  email === "log"
    ? bad(
        "email: log mode — nothing is sent, so NOBODY CAN COMPLETE REGISTRATION",
        "set EMAIL_PROVIDER in .env — see docs/notifications.md",
      )
    : emailKeyed
      ? ok(
          email === "smtp"
            ? `email: smtp as ${process.env.SMTP_USER}`
            : `email: ${email}`,
        )
      : bad(`email: ${email} selected but its key is missing`, "docs/notifications.md");

  /* The mistake that wastes an afternoon: a mailbox provider will not send as a
     mailbox you did not sign in as, and the rejection it gives ("550 not
     allowed") reads like a problem with the recipient rather than the sender.

     But this is only true of *mailboxes*. A relay — Brevo, Mailgun, SendGrid —
     signs in with an account identifier that is deliberately nothing like the
     address it sends as, and telling somebody that is broken would send them
     looking for a fault that is not there. So it is a hard problem only where
     the host is a mailbox provider, and silence elsewhere. */
  const MAILBOX_HOSTS =
    /(^|\.)(gmail\.com|google\.com|googlemail\.com|outlook\.com|office365\.com|hotmail\.com|live\.com|yahoo\.com|icloud\.com|me\.com|zoho\.com|zoho\.eu|yandex\.ru|gmx\.net|mail\.ru)$/i;

  if (email === "smtp" && emailKeyed) {
    const sender = /<([^>]+)>/.exec(process.env.EMAIL_FROM ?? "")?.[1]?.trim() ??
      (process.env.EMAIL_FROM ?? "").trim();
    const host = process.env.SMTP_HOST;
    const isMailbox = MAILBOX_HOSTS.test(host.replace(/^smtp[-.]?/i, ""));

    if (!sender) {
      warn("email: EMAIL_FROM is not set, so the default address will be used",
           'EMAIL_FROM="RG Pilates Studio <info@rgpilatesstudio.com>"');
    } else if (sender.toLowerCase() !== process.env.SMTP_USER.toLowerCase()) {
      isMailbox
        ? bad(
            `email: signs in to ${host} as ${process.env.SMTP_USER} but sends as ${sender} — a mailbox will refuse that`,
            "make EMAIL_FROM use the same mailbox as SMTP_USER",
          )
        : ok(`email: smtp via ${host}, sending as ${sender}`);
    }
  }

  /* Which automatic messages use email is no longer an environment variable —
     it is the SENDS table in src/lib/messaging/events.ts, which is the only
     place it lives. Nothing here to check, and a warning about a setting that
     no longer does anything would send somebody editing .env for an afternoon. */
  if (process.env.REMINDER_CHANNELS) {
    warn(
      "REMINDER_CHANNELS is set but no longer does anything",
      "the channels are the SENDS table in src/lib/messaging/events.ts — safe to delete the line",
    );
  }

  sms === "log"
    ? warn("sms: log mode — nothing is actually sent", "docs/notifications.md")
    : smsKeyed
      ? ok(`sms: ${sms} as "${process.env.SMS_SENDER ?? process.env.TWILIO_FROM}"`)
      : bad(`sms: ${sms} selected but its credentials are missing`, "docs/notifications.md");

  /* The sender name is capped at 11 characters by the SMS standard itself, not
     by any provider. Over that it is silently truncated or rejected depending on
     the network, and the studio finds out from a member. */
  const sender = process.env.SMS_SENDER ?? "";
  if (sms !== "log" && sender) {
    sender.length > 11
      ? bad(`sms: sender "${sender}" is ${sender.length} characters, over the 11 the standard allows`)
      : /[^A-Za-z0-9 ]/.test(sender)
        ? warn(`sms: sender "${sender}" has characters some networks reject`, "letters and digits only")
        : ok(`sms: sender name fits (${sender.length}/11)`);
  }

  /**
   * The dialling code, which is digits and is easy to write as a country.
   *
   * `SMS_DEFAULT_COUNTRY` is pasted in front of any number a member typed
   * locally, so `CY` produces `+CY99649052` and the gateway refuses it. It broke
   * only the members whose stored number had no `+` in front of it, which is why
   * it needs a check rather than a comment: the site looks perfectly healthy and
   * some people simply never get a text.
   *
   * Checked against a real local number rather than by inspecting the string, so
   * this asks the same question the sender will ask.
   */
  {
    const given = (process.env.SMS_DEFAULT_COUNTRY ?? "").trim();
    /* The three spellings sms.ts accepts, in the order it tries them. Kept as
       one expression rather than a copy of `toE164`, because the question here
       is only "is this a dialling code" — what the sender then does with it is
       that module's business and is covered by the suite. */
    const digits = given.replace(/^\+/, "").replace(/^00/, "");
    const iso = { CY: "357", GR: "30", GB: "44", UK: "44" }[given.toUpperCase()];

    if (!given) {
      ok("sms: local numbers assume Cyprus (357), the built-in default");
    } else if (/^\d{1,4}$/.test(digits)) {
      ok(`sms: local numbers become +${digits}…`);
    } else if (iso) {
      warn(
        `sms: SMS_DEFAULT_COUNTRY="${given}" is read as +${iso}, but the digits are what this setting means`,
        `SMS_DEFAULT_COUNTRY=${iso}`,
      );
    } else {
      bad(
        `sms: SMS_DEFAULT_COUNTRY="${given}" is not a dialling code, so a locally typed number becomes +${given}99649052 and is refused`,
        "set it to the digits: SMS_DEFAULT_COUNTRY=357",
      );
    }
  }

  /* Credit is the silent failure: it runs out, every send fails, and nothing on
     the website looks any different. Asked about only when a provider is live. */
  if (sms === "smsto" && process.env.SMSTO_API_KEY) {
    try {
      const { smsBalance } = await import("../src/lib/messaging/sms.ts");
      const bal = await smsBalance();
      bal
        ? bal.amount <= 2
          ? warn(`sms: only ${bal.amount} ${bal.currency} of credit left`, "top up at sms.to")
          : ok(`sms: ${bal.amount} ${bal.currency} of credit`)
        : warn("sms: could not read the account balance", "check the key, or the endpoint has moved");
    } catch {
      warn("sms: could not read the account balance");
    }
  }

  /* Members who left email on, and members who deliberately turned SMS on. The
     second number is the one that costs money. */
  const reach = conn
    .prepare(
      `select
         sum(case when notify_email = 1 then 1 else 0 end) as email,
         sum(case when notify_sms = 1 then 1 else 0 end) as sms,
         sum(case when marketing_opt_in = 1 then 1 else 0 end) as offers
       from users where service_opt_in_at is not null`,
    )
    .get();
  ok(
    `reach: ${reach.email ?? 0} by email, ${reach.sms ?? 0} by SMS, ${reach.offers ?? 0} accept offers`,
  );
}

console.log("\nThe room, as the timetable has it");
if (tables.has("class_sessions")) {
  /* Group classes only. A personal or duet hour holds one person by design, so
     checking it against five would report the feature as a fault for ever. */
  const wrong = conn
    .prepare(
      `select count(*) as n from class_sessions cs
         join class_types ct on ct.id = cs.class_type_id
        where cs.starts_at >= ?
          and ct.kind = 'GROUP'
          and (cs.capacity != ? or (cs.ends_at - cs.starts_at) != ?)`,
    )
    .get(Math.floor(Date.now() / 1000), CAPACITY, CLASS_SECONDS).n;
  wrong === 0
    ? ok(`every upcoming class is ${CLASS_MINUTES} minutes with ${CAPACITY} places`)
    : bad(`${wrong} upcoming classes are on an older rota`, "restart the server, or npm run db:seed");

  const upcoming = conn
    .prepare(
      `select count(*) as n from class_sessions cs
         join class_types ct on ct.id = cs.class_type_id
        where cs.starts_at >= ? and ct.kind = 'GROUP'`,
    )
    .get(Math.floor(Date.now() / 1000)).n;
  upcoming > 0 ? ok(`${upcoming} classes scheduled ahead`) : bad("no classes scheduled", "npm run db:seed");

  /**
   * And the midday hours, which are the ones that fail quietly.
   *
   * Nothing on the website says the appointment slots are missing: they simply
   * do not appear, and the studio concludes that a feature it was told is live
   * does not work. Fifteen a week, so a fortnight ahead should hold about thirty.
   */
  const appts = conn
    .prepare(
      `select count(*) as n from class_sessions cs
         join class_types ct on ct.id = cs.class_type_id
        where cs.starts_at >= ? and ct.kind = 'PERSONAL'`,
    )
    .get(Math.floor(Date.now() / 1000)).n;
  appts > 0
    ? ok(`${appts} personal and duet hours open for booking`)
    : bad(
        "no personal or duet hours are on the timetable",
        "load any page to let the timetable repair run, or npm run db:seed",
      );

  /* One class name. Six was the old rota, and members reading six names were
     being asked to choose between distinctions the room does not make. */
  const names = conn
    .prepare(
      `select distinct ct.name_en as n from class_sessions cs
         join class_types ct on ct.id = cs.class_type_id
        where cs.starts_at >= ? and ct.kind = 'GROUP'`,
    )
    .all(Math.floor(Date.now() / 1000))
    .map((r) => r.n);
  names.length <= 1
    ? ok(`every class ahead is called ${names[0] ?? "nothing yet"}`)
    : warn(
        `classes ahead carry ${names.length} different names: ${names.join(", ")}`,
        "restart the server so the timetable repair can run",
      );
}

console.log("\nWhat is on sale");
if (tables.has("credit_packages")) {
  const active = conn
    .prepare("select slug from credit_packages where active = 1 order by sort_order")
    .all()
    .map((p) => p.slug);
  /**
   * What the catalogue *should* hold, read out of the catalogue itself.
   *
   * This was a list typed out by hand, and it went stale the moment the studio
   * added the six, nine and twelve-month terms: twenty-three packs in the
   * database against eleven in the list, so `npm run doctor` reported a red
   * failure and told somebody to reseed a database that was perfectly correct.
   * A health check that cries wolf is worse than no health check, because the
   * next real failure arrives in a list of things known to be lies.
   *
   * `packs.ts` is TypeScript and this is a plain script, so the slugs are read
   * with a regex rather than an import — the same trick `db:mirror` uses on the
   * schema. It matches the `slug: "…"` lines inside the PACKS array and nothing
   * else; the `p.slug` references further down the file have no quoted string.
   */
  const catalogue = readFileSync("src/lib/packs.ts", "utf8");
  const expected = [...catalogue.matchAll(/^\s*slug: "([^"]+)"/gm)].map((m) => m[1]);

  /* Compared as sets. Presence is what matters: a pack missing from the
     database cannot be bought, and one in the database that the code no longer
     knows about prices itself from a row nothing maintains. The order rows come
     back in is a display concern and belongs to sort_order, not here. */
  const inDb = new Set(active);
  const missing = expected.filter((s) => !inDb.has(s));
  const strays = active.filter((s) => !expected.includes(s));
  const faults = [
    missing.length ? `missing ${missing.join(", ")}` : "",
    strays.length ? `unknown ${strays.join(", ")}` : "",
  ].filter(Boolean);

  if (!expected.length) {
    warn("packs: could not read the catalogue from src/lib/packs.ts",
         "this check is stale rather than the packs being wrong");
  } else if (faults.length) {
    bad(`packs on sale do not match the catalogue: ${faults.join("; ")}`,
        "load any page, or npm run db:seed");
  } else {
    ok(`${active.length} packs on sale, all of them in the catalogue`);
  }
}

console.log("\nTaking money");
{
  /* Reads .env the same way the app does, so what this prints is what a member
     would meet at the checkout. */
  const named = (process.env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  const real = (v) => v && v.trim().length > 12 && !/x{3,}/i.test(v);
  const stripeReady =
    real(process.env.STRIPE_SECRET_KEY) &&
    (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_") &&
    real(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const hostedReady =
    Boolean(process.env.HOSTED_PAY_ENDPOINT) &&
    Boolean(process.env.HOSTED_PAY_MERCHANT_ID) &&
    /order:/.test(process.env.HOSTED_PAY_FIELDS ?? "") &&
    /amount:/.test(process.env.HOSTED_PAY_FIELDS ?? "");
  const testAllowed =
    process.env.ALLOW_TEST_PAYMENTS === "true" || process.env.NODE_ENV !== "production";

  const active = named
    ? named
    : stripeReady
      ? "stripe"
      : hostedReady
        ? "hosted"
        : testAllowed
          ? "test"
          : null;

  if (named && named === "stripe" && !stripeReady) {
    bad("PAYMENT_PROVIDER says stripe but the keys are missing or placeholders", "put real sk_ and pk_ keys in .env — docs/payments.md");
  } else if (named && named === "hosted" && !hostedReady) {
    bad("PAYMENT_PROVIDER says hosted but the gateway is not described", "fill in HOSTED_PAY_* — docs/payments.md");
  } else if (active === "stripe") {
    ok("card fields in our own page, through Stripe");
    real(process.env.STRIPE_WEBHOOK_SECRET)
      ? ok("the Stripe webhook is signed")
      : bad("no STRIPE_WEBHOOK_SECRET", "stripe listen --forward-to localhost:3000/api/stripe/webhook");
  } else if (active === "hosted") {
    ok(`redirect to ${process.env.HOSTED_PAY_LABEL ?? "the gateway"}`);
    process.env.HOSTED_PAY_SIGNATURE_FIELD && process.env.HOSTED_PAY_SECRET
      ? ok("returns from the gateway are signature checked")
      : bad("no signature configured for gateway returns", "set HOSTED_PAY_SIGNATURE_* before going live — docs/payments.md");
  } else if (active === "test") {
    ok("test mode: the card form charges nothing (fine in development)");
  } else {
    bad("no payment provider is usable", "see docs/payments.md");
  }
}

conn.close();
console.log(
  problems === 0 && warnings > 0
    ? `\n\x1b[33mNothing broken, ${warnings} thing${warnings === 1 ? "" : "s"} to tidy before going live.\x1b[0m\n`
    : problems === 0
    ? "\n\x1b[32mEverything looks right.\x1b[0m\n"
    : `\n\x1b[31m${problems} problem${problems === 1 ? "" : "s"}.\x1b[0m Follow the arrows above.\n`,
);
process.exit(problems === 0 ? 0 : 1);
