/**
 * Forgotten passwords, end to end against the library.
 * Run with:  npx tsx scripts/test-reset.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { ensureSchema } from "../src/db/migrate";
import { db, sqlite } from "../src/db";
import { passwordResets, users } from "../src/db/schema";
import { hashPassword, verifyPassword } from "../src/lib/auth";
import { completeReset, lookupReset, requestReset } from "../src/lib/password-reset";

/* Read .env the way the server does: the token hash is keyed with AUTH_SECRET. */
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond || extra === undefined ? "" : `  (${JSON.stringify(extra)})`}`);
}

async function main() {
  ensureSchema(sqlite);
  const email = `reset-${Date.now()}@rg.test`;
  const user = db
    .insert(users)
    .values({ email, name: "Reset Test", passwordHash: await hashPassword("old-password-1") })
    .returning()
    .get();

  console.log("\n1. Asking");
  check("unknown address gets nothing to send", requestReset("nobody@rg.test") === null);
  const first = requestReset(email.toUpperCase());
  check("known address, any case, gets a token", Boolean(first?.token) && first!.user.id === user.id);
  const second = requestReset(email);
  check("asking again replaces the link", second !== null && second.token !== first!.token);
  check("the old link is dead", lookupReset(first!.token).ok === false);
  check("the new link is live", lookupReset(second!.token).ok === true);
  const rows = db.select().from(passwordResets).where(eq(passwordResets.userId, user.id)).all();
  check("one row per account, holding a hash and not the token", rows.length === 1 && rows[0]!.tokenHash !== second!.token);

  console.log("\n2. Bad input");
  check("garbage token is INVALID", lookupReset("not-a-token").ok === false);
  const short = await completeReset(second!.token, "short", "short");
  check("short password refused", !short.ok && short.code === "PASSWORD_SHORT");
  const mismatch = await completeReset(second!.token, "new-password-1", "new-password-2");
  check("mismatch refused", !mismatch.ok && mismatch.code === "MISMATCH");
  check("link still live after refusals", lookupReset(second!.token).ok === true);

  console.log("\n3. Setting the password");
  const done = await completeReset(second!.token, "new-password-1", "new-password-1");
  check("accepted", done.ok);
  const fresh = db.select().from(users).where(eq(users.id, user.id)).get()!;
  check("new password signs in", await verifyPassword("new-password-1", fresh.passwordHash));
  check("old password does not", !(await verifyPassword("old-password-1", fresh.passwordHash)));
  const used = lookupReset(second!.token);
  check("link is USED afterwards", !used.ok && used.code === "USED");
  const again = await completeReset(second!.token, "another-pass-1", "another-pass-1");
  check("cannot be used twice", !again.ok && again.code === "USED");

  console.log("\n4. Expiry");
  const third = requestReset(email)!;
  const later = new Date(Date.now() + 61 * 60_000);
  const expired = lookupReset(third.token, later);
  check("dead after an hour", !expired.ok && expired.code === "EXPIRED");
  check("alive just before", lookupReset(third.token, new Date(Date.now() + 59 * 60_000)).ok);

  db.delete(passwordResets).where(eq(passwordResets.userId, user.id)).run();
  db.delete(users).where(eq(users.id, user.id)).run();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
