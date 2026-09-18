/**
 * Clear the testing out of the database, once, on the day the studio opens.
 *
 *     npm run go-live
 *
 * ---
 *
 * **What this is for.**
 *
 * By the time a website opens, its database is full of the work of getting it
 * open: accounts called "Prof Test", twenty-five Stripe attempts of which eight
 * went through, bookings made to see whether booking worked. None of that is the
 * studio's data, and on the first real morning it is in the way of the studio's
 * data. It is also, in one specific respect, a liability: the seeded desk
 * passwords are written in `src/db/seed.ts` in a repository that has been
 * public, so any account still using one has to be treated as compromised.
 *
 * So this deletes the people and the history, keeps the studio's own setup, and
 * rebuilds the timetable. It is meant to be run once.
 *
 * ---
 *
 * **What it keeps, and why the line is drawn there.**
 *
 * Deleted: every account, every booking, every purchase, every session balance
 * and ledger line, every notice, every push subscription, every verification
 * code, and the generated timetable.
 *
 * Kept: the class types, the weekly rota of templates, the packages and their
 * prices, the instructors, any pricing rules, and any closure days already
 * entered. That is the studio describing itself, and re-entering seventy-five
 * rota rows by hand on opening morning would be an unforced error.
 *
 * A useful side effect: invoice numbering restarts at 0001. `assignInvoiceNumber`
 * derives the sequence from the highest `invoice_seq` in `purchases`, so
 * emptying that table is all it takes to hand the accountant a clean, gapless
 * first year. Nothing extra to reset, and nothing to remember.
 *
 * ---
 *
 * **Everything that can refuse, refuses before anything is deleted.**
 *
 * The order here is the whole design. Every check that could fail — the database
 * is the wrong one, the desk passwords are missing, they are still the burned
 * defaults, the two desk addresses are the same — happens *first*, and the
 * password hashing happens first too. A script that deletes every account and
 * then discovers it cannot create the owner has locked the studio out of its own
 * website on opening day, from a shell prompt, with no way back except a disk
 * snapshot.
 *
 * The deletion and the rebuild are then one SQLite transaction. Either the
 * studio starts clean with a working desk account and a full timetable, or
 * nothing happened at all.
 */
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { db, sqlite } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import {
  BOOKING_HORIZON_DAYS,
  generateSessions,
  TIMETABLE_WEEKS,
} from "../src/lib/schedule";
import { studioDateKey } from "../src/lib/time";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function die(headline: string, ...lines: string[]): never {
  console.error(`\n  ${c.red("✗")} ${headline}\n`);
  for (const l of lines) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
}

/** The phrase that has to be typed. Long enough that it cannot be a reflex. */
const PHRASE = "DELETE ALL MEMBER DATA";

/**
 * Emptied, in an order foreign keys accept: a table is only cleared once
 * nothing still pointing at it has rows.
 *
 * Derived from `pragma foreign_key_list` rather than written from memory, and
 * worth keeping in this order — `users` last is not a stylistic choice, it is
 * the only position that works.
 */
const WIPE = [
  "booking_reminders",
  "bookings",
  "class_sessions",
  "contact_messages",
  "credit_batches",
  "credit_ledger",
  "email_verifications",
  "notice_deliveries",
  "notice_reads",
  "notices",
  "purchases",
  "push_subscriptions",
  "user_avatars",
  "users",
] as const;

/** The studio describing itself. Left alone. */
const KEEP = [
  "class_types",
  "class_templates",
  "credit_packages",
  "instructors",
  "pricing_rules",
  "studio_closures",
] as const;

/**
 * Two kept tables record *who* added the row, and that somebody is about to be
 * deleted.
 *
 * `pricing_rules.created_by` and `studio_closures.created_by` both reference
 * `users`. Neither is required, so clearing them costs nothing but the name of
 * whoever typed the row in — and leaving them would make deleting the accounts
 * fail on a foreign key, or worse, leave a row pointing at an account that no
 * longer exists.
 *
 * This is currently invisible, because both tables are empty on the live
 * database. It stops being invisible the moment somebody enters the October
 * public holidays before launch, which is exactly what they have been asked to
 * do.
 */
const ORPHANS = [
  ["pricing_rules", "created_by"],
  ["studio_closures", "created_by"],
] as const;

/**
 * Everything lives in here rather than at the top level.
 *
 * `tsx` compiles this project to CommonJS, which has no top-level await, and
 * this script has to await both bcrypt and the confirmation prompt. Same shape
 * as the test scripts, for the same reason.
 */
async function main() {
  /* ------------------------------------------------------------------- checks */

  const configured = process.env.DATABASE_URL ?? "file:./dev.db";
  const file = configured.replace(/^file:/, "");

  if (/^postgres(ql)?:\/\//.test(configured)) {
    die(
      "DATABASE_URL is a Postgres URL, and it must be a file path.",
      "This website is SQLite throughout. Pointed at a connection string it",
      "does not fail, it serves from a throwaway database — so running this",
      "now would clear a copy that was going to be deleted anyway and leave",
      "the real data untouched. On Render it should be:",
      "",
      `    ${c.bold("DATABASE_URL = file:/var/data/rg.db")}`,
    );
  }
  if (!existsSync(file)) {
    die(`no database at ${c.bold(file)}`, `DATABASE_URL is ${configured}`);
  }

  /**
   * The desk accounts, read before anything is touched.
   *
   * Required rather than defaulted. `src/db/seed.ts` falls back to
   * `ownerdev123` and `receptiondev123` for development, and those two strings
   * are in a repository that has been public: creating a live owner account with
   * one would hand the studio's own console to anybody who has read the code.
   * There is no sensible default for this, so there is no default.
   */
  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "";
  const receptionEmail = (process.env.SEED_RECEPTION_EMAIL ?? "")
    .trim()
    .toLowerCase();
  const receptionPassword = process.env.SEED_RECEPTION_PASSWORD ?? "";

  const missing = [
    !ownerEmail && "SEED_OWNER_EMAIL",
    !ownerPassword && "SEED_OWNER_PASSWORD",
    !receptionEmail && "SEED_RECEPTION_EMAIL",
    !receptionPassword && "SEED_RECEPTION_PASSWORD",
  ].filter(Boolean);

  if (missing.length) {
    die(
      `these are not set: ${missing.join(", ")}`,
      "This deletes every account, including the desk ones, and creates the",
      "owner and reception accounts again from those four variables. Without",
      "all four there would be no way to sign in afterwards, so it stops here",
      "rather than halfway.",
      "",
      "Set them in Render → the web service → Environment, then run this again.",
    );
  }

  /* The passwords written in seed.ts, and the demo member's. Treated as public,
   because they are. */
  const BURNED = ["ownerdev123", "receptiondev123", "member123"];
  for (const [label, pw] of [
    ["SEED_OWNER_PASSWORD", ownerPassword],
    ["SEED_RECEPTION_PASSWORD", receptionPassword],
  ] as const) {
    if (BURNED.includes(pw)) {
      die(
        `${label} is one of the passwords written in src/db/seed.ts.`,
        "That file has been in a public repository, so this password is known.",
        "Pick a new one and set it in Render's environment panel.",
      );
    }
    if (pw.length < 12) {
      die(
        `${label} is ${pw.length} characters, and 12 is the minimum.`,
        "This account can see every member's details and the studio's takings.",
      );
    }
  }
  if (ownerEmail === receptionEmail) {
    die(
      `SEED_OWNER_EMAIL and SEED_RECEPTION_EMAIL are both ${ownerEmail}.`,
      "One account cannot be both: reception has no Analytics tab, and the",
      "owner account is the only one that can promote another. Two addresses.",
    );
  }

  /**
   * Hashed now, before the transaction, because bcrypt is asynchronous and a
   * better-sqlite3 transaction is not. Doing this inside the transaction is not
   * possible; doing it after the deletion would mean a failure here empties the
   * database and creates nobody.
   */
  const ownerHash = await hashPassword(ownerPassword);
  const receptionHash = await hashPassword(receptionPassword);

  /* ----------------------------------------------------------- what will happen */

  const count = (t: string) =>
    (sqlite.prepare(`select count(*) as n from "${t}"`).get() as { n: number })
      .n;

  const toWipe = WIPE.map((t) => ({ table: t, rows: count(t) }));
  const toKeep = KEEP.map((t) => ({ table: t, rows: count(t) }));
  const wipeTotal = toWipe.reduce((a, b) => a + b.rows, 0);

  console.log(`\n  ${c.bold("RG Pilates Studio — going live")}\n`);
  console.log(`  database   ${file}`);
  console.log(`  owner      ${ownerEmail}`);
  console.log(`  reception  ${receptionEmail}\n`);

  console.log(`  ${c.bold(c.red("DELETED"))}\n`);
  const w = Math.max(...[...WIPE, ...KEEP].map((t) => t.length));
  for (const r of toWipe) {
    console.log(
      `    ${r.table.padEnd(w)}  ${String(r.rows).padStart(6)}${r.rows === 0 ? c.dim("  (already empty)") : ""}`,
    );
  }
  console.log(`\n  ${c.bold(c.green("KEPT"))}\n`);
  for (const r of toKeep) {
    console.log(`    ${r.table.padEnd(w)}  ${String(r.rows).padStart(6)}`);
  }

  console.log(
    `\n  Then: the owner and reception accounts are created from the`,
  );
  /* The booking horizon, not the strip window: this generates everything a
   twelve-month pack holder can reach, which is a year, not the ninety days
   the timetable shows at once. */
  console.log(
    `  environment, and ${BOOKING_HORIZON_DAYS} days of classes are generated`,
  );
  console.log(`  from the ${count("class_templates")} rota templates.\n`);
  console.log(
    `  ${c.yellow("This cannot be undone from here.")} The way back is a disk`,
  );
  console.log(`  snapshot: Render → the web service → Disks.\n`);

  if (wipeTotal === 0) {
    console.log(
      `  ${c.dim("Nothing to delete. This has already been run.")}\n`,
    );
    process.exit(0);
  }

  /* ------------------------------------------------------------- confirmation */

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question(`  Type ${c.bold(PHRASE)} to go ahead: `);
  rl.close();

  if (typed.trim() !== PHRASE) {
    console.log(`\n  ${c.dim("Nothing was changed.")}\n`);
    process.exit(0);
  }

  /* ------------------------------------------------------------------- the work */

  let created = 0;

  /**
   * One transaction, so a failure anywhere leaves the database exactly as it was.
   *
   * The timetable is generated inside it as well. A studio that opens with no
   * accounts is locked out; a studio that opens with no timetable has a website
   * that appears to have no classes, and both are the sort of thing that gets
   * discovered by a member rather than by us.
   */
  sqlite.transaction(() => {
    for (const [table, column] of ORPHANS) {
      sqlite.prepare(`update "${table}" set "${column}" = null`).run();
    }
    for (const table of WIPE) {
      sqlite.prepare(`delete from "${table}"`).run();
    }

    const now = new Date();
    db.insert(users)
      .values([
        {
          email: ownerEmail,
          name: "Studio Owner",
          passwordHash: ownerHash,
          role: "ADMIN",
          /* Verified on creation: the confirmation code is for members proving
           they own an address, and there is nobody to click the link in an
           account being created from a shell. Unverified, the desk could not
           sign in. */
          emailVerifiedAt: now,
          serviceOptInAt: now,
          termsAcceptedAt: now,
        },
        {
          email: receptionEmail,
          name: "Reception",
          passwordHash: receptionHash,
          role: "STAFF",
          emailVerifiedAt: now,
          serviceOptInAt: now,
          termsAcceptedAt: now,
        },
      ])
      .run();

    /* `generateSessions` returns a report, not an array: { created, skipped,
     templates, createdIds }. Reading `.length` off it gave "undefined classes
     generated" on the receipt, which on opening morning is exactly the sort of
     line that sends somebody looking for a problem that is not there. */
    created = generateSessions(TIMETABLE_WEEKS, now).created;
  })();

  /* ----------------------------------------------------------------- the receipt */

  const last = sqlite
    .prepare(`select max(starts_at) as m from class_sessions`)
    .get() as { m: number | null };

  console.log(`\n  ${c.green("✓")} the studio is clean\n`);
  console.log(`    accounts        2 ${c.dim("(owner, reception)")}`);
  console.log(`    members         0`);
  console.log(`    bookings        0`);
  console.log(
    `    purchases       0 ${c.dim("(invoice numbering restarts at 0001)")}`,
  );
  console.log(`    classes         ${created} generated`);
  if (last.m) {
    console.log(
      `    timetable to    ${studioDateKey(new Date(last.m * 1000))}`,
    );
  }
  console.log(`\n  ${c.bold("Before you tell anybody the address:")}\n`);
  console.log(`    1. Sign in as ${ownerEmail} and check the console opens.`);
  console.log(`    2. Sign in as ${receptionEmail} and check the desk opens.`);
  console.log(
    `    3. Enter the closure days: public holidays and any the studio`,
  );
  console.log(
    `       shuts for. Otherwise members can book a class that is not`,
  );
  console.log(`       happening.`);
  console.log(
    `    4. Register one real member and take one real payment, to see`,
  );
  console.log(`       the confirmation email and the invoice arrive.`);
  console.log(
    `    5. ${c.bold("npm run db:mirror")} so the mirror is not showing`,
  );
  console.log(`       yesterday's test data.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
