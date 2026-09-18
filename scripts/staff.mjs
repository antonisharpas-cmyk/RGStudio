/**
 * The two accounts that open the desk console.
 *
 *   npm run staff                                    who has what
 *   npm run staff -- add reception@rgpilatesstudio.com "Maria" reception
 *   npm run staff -- add maria@rgpilatesstudio.com "Maria" owner
 *   npm run staff -- password reception@rgpilatesstudio.com
 *   npm run staff -- password reception@rgpilatesstudio.com "their-own-choice"
 *   npm run staff -- remove old@rgpilatesstudio.com
 *
 * Why a command and not a screen: a password typed here never leaves this
 * machine. It is not in the repository, not in a chat window, not in anybody's
 * sent items. Leave the password off and one is generated and printed once —
 * that output is the only copy, so put it in the studio's password manager
 * before closing the terminal.
 *
 *   owner       (ADMIN) the desk, plus the analytics and the keys
 *   reception   (STAFF) the desk: sessions, bookings, closures, notices, prices
 *
 * Reception deliberately cannot see the analytics — the membership count and
 * what the studio has taken — and cannot touch another desk account.
 */
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const file = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");
if (!existsSync(file)) {
  console.error(`\n  No database at ${file}. Run npm run setup first.\n`);
  process.exit(1);
}
const db = new Database(file);

const ROLE = { owner: "ADMIN", reception: "STAFF" };
const LABEL = { ADMIN: "owner", STAFF: "reception", MEMBER: "member" };

/* Readable on a note and still strong: 4 words' worth of entropy from a small
   alphabet that has no l/1/O/0 to mistype. */
function makePassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

function list() {
  const rows = db
    .prepare("select email, name, role from users order by role, email")
    .all();
  const deskAccounts = rows.filter((r) => r.role !== "MEMBER");

  console.log(`\n  Who can open /admin  (${file})\n`);
  if (deskAccounts.length === 0) {
    console.log("    Nobody. /admin is unreachable until you add somebody.");
  } else {
    for (const r of deskAccounts) {
      console.log(
        `    ${LABEL[r.role].padEnd(10)} ${r.email.padEnd(32)} ${r.name}`,
      );
    }
  }
  console.log(`\n    ${rows.length - deskAccounts.length} member accounts\n`);
  console.log("  Add one:      npm run staff -- add someone@rgpilatesstudio.com \"Their Name\" reception");
  console.log("  New password: npm run staff -- password someone@rgpilatesstudio.com");
  console.log("  Remove one:   npm run staff -- remove someone@rgpilatesstudio.com\n");
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd) {
  list();
  process.exit(0);
}

/* -------------------------------------------------------------------- add */
if (cmd === "add") {
  const [emailArg, name, roleArg, given] = rest;
  const email = (emailArg ?? "").trim().toLowerCase();
  const role = ROLE[(roleArg ?? "").trim().toLowerCase()];

  if (!email.includes("@") || !name || !role) {
    console.error(
      '\n  npm run staff -- add <email> "<name>" <owner|reception> [password]\n',
    );
    process.exit(1);
  }

  const password = given ?? makePassword();
  if (password.length < 10) {
    console.error("\n  That password is too short. Ten characters at least.\n");
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  const existing = db
    .prepare("select id, role from users where email = ?")
    .get(email);

  if (existing) {
    db.prepare(
      `update users set name = ?, role = ?, password_hash = ?,
              email_verified_at = coalesce(email_verified_at, unixepoch())
        where id = ?`,
    ).run(name, role, hash, existing.id);
    console.log(`\n  Updated ${email} — now ${LABEL[role]}.`);
  } else {
    db.prepare(
      /* email_verified_at is stamped, not left null. A desk account is created
         by somebody standing at this keyboard, and requiring them to confirm an
         address in order to open the console that would tell them the code never
         arrived is a locked door with the key inside. */
      `insert into users
         (id, email, name, password_hash, role, created_at, service_opt_in_at,
          email_verified_at)
       values (?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())`,
    ).run(randomUUID(), email, name, hash, role);
    console.log(`\n  Created ${email} — ${LABEL[role]}.`);
  }

  if (given) {
    console.log("  Password: the one you supplied.\n");
  } else {
    console.log(`\n    password:  ${password}\n`);
    console.log("  This is the only time it is shown. Save it now.");
    console.log("  They can change it themselves at /account once signed in.\n");
  }
  console.log(`  They open the desk at /admin with that email and password.\n`);
  db.close();
  process.exit(0);
}

/* --------------------------------------------------------------- password */
if (cmd === "password") {
  const [emailArg, given] = rest;
  const email = (emailArg ?? "").trim().toLowerCase();
  const user = db
    .prepare("select id, email, name, role from users where email = ?")
    .get(email);

  if (!user) {
    console.error(`\n  No account with that email: ${email}\n`);
    process.exit(1);
  }

  const password = given ?? makePassword();
  if (password.length < 10) {
    console.error("\n  That password is too short. Ten characters at least.\n");
    process.exit(1);
  }
  db.prepare("update users set password_hash = ? where id = ?").run(
    bcrypt.hashSync(password, 10),
    user.id,
  );

  console.log(`\n  ${user.name} <${user.email}>  (${LABEL[user.role]})`);
  if (given) {
    console.log("  Password changed to the one you supplied.\n");
  } else {
    console.log(`\n    password:  ${password}\n`);
    console.log("  This is the only time it is shown. Save it now.\n");
  }
  db.close();
  process.exit(0);
}

/* ----------------------------------------------------------------- remove */
if (cmd === "remove") {
  const email = (rest[0] ?? "").trim().toLowerCase();
  const user = db
    .prepare("select id, email, name, role from users where email = ?")
    .get(email);

  if (!user) {
    console.error(`\n  No account with that email: ${email}\n`);
    process.exit(1);
  }

  /* Never leave the studio locked out of its own console. */
  if (user.role !== "MEMBER") {
    const owners = db
      .prepare("select count(*) as n from users where role = 'ADMIN' and id != ?")
      .get(user.id).n;
    if (owners === 0) {
      console.error(
        `\n  Refusing: ${user.email} is the only owner account.` +
          `\n  Add another owner first:\n` +
          `    npm run staff -- add you@rgpilatesstudio.com "Your Name" owner\n`,
      );
      process.exit(1);
    }
  }

  /* An account with history is demoted rather than deleted: the ledger says who
     sold those sessions, and a row pointing at nothing is worse than a row
     pointing at somebody who no longer works here. */
  const history = db
    .prepare(
      `select (select count(*) from bookings where user_id = ?)
            + (select count(*) from purchases where user_id = ?)
            + (select count(*) from credit_batches where user_id = ?) as n`,
    )
    .get(user.id, user.id, user.id).n;

  if (history > 0) {
    db.prepare("update users set role = 'MEMBER' where id = ?").run(user.id);
    console.log(`\n  ${user.email} can no longer open /admin.`);
    console.log(
      `  Kept as a member account: it has ${history} rows of history behind it.\n`,
    );
  } else {
    db.prepare("delete from users where id = ?").run(user.id);
    console.log(`\n  Deleted ${user.email}.\n`);
  }
  db.close();
  process.exit(0);
}

console.error(`\n  Unknown command: ${cmd}`);
console.error("  Try: add, password, remove, or no arguments to list.\n");
process.exit(1);
