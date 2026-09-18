/**
 * The "buy the next pack early" rule.
 *
 * Run with:  npx tsx scripts/test-chain.ts
 *
 * Replays the case that found the gap: one class a week, a month bought on
 * the 18th of September, the next month bought on the 8th of October while
 * the first is still running. The second pack must run to the 17th of
 * November, not the 7th, so the Tuesday of the 10th of November is bookable.
 *
 * Creates a throwaway user, so it is safe against dev.db.
 */
import { eq } from "drizzle-orm";
import { ensureSchema } from "../src/db/migrate";
import { db, sqlite } from "../src/db";
import { creditBatches, creditLedger, users } from "../src/db/schema";
import { grantCredits } from "../src/lib/credits";
import { studioDateKey, studioWallTimeToInstant } from "../src/lib/time";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond || extra === undefined ? "" : `  (${JSON.stringify(extra)})`}`);
}

const realNow = Date.now;
function today(y: number, m: number, d: number) {
  const t = studioWallTimeToInstant(y, m, d, 12, 0).getTime();
  Date.now = () => t;
}

async function main() {
  ensureSchema(sqlite);
  const user = db
    .insert(users)
    .values({ email: `chain-${realNow()}@rg.test`, name: "Chain Test", passwordHash: "x" })
    .returning()
    .get();

  console.log("\n1. First month, bought 18 September");
  today(2026, 9, 18);
  const first = grantCredits({ userId: user.id, credits: 4, validityDays: 30 });
  check("expires 18 October, included", studioDateKey(first.expiresAt!) === "2026-10-18", studioDateKey(first.expiresAt!));
  check("spend window matches", first.usableTo!.getTime() === first.expiresAt!.getTime());

  console.log("\n2. Next month bought 8 October, first still running");
  today(2026, 10, 8);
  const second = grantCredits({ userId: user.id, credits: 4, validityDays: 30 });
  check("starts after the first: expires 17 November", studioDateKey(second.expiresAt!) === "2026-11-17", studioDateKey(second.expiresAt!));
  const tue10Nov = studioWallTimeToInstant(2026, 11, 10, 16, 0);
  check("Tuesday 10 November 16:00 is inside the spend window", second.usableTo! > tue10Nov);
  const note = db.select().from(creditLedger).where(eq(creditLedger.batchId, second.id)).get()?.note ?? "";
  check("ledger says why", note.includes("Starts after the current pack (2026-10-18)"), note);

  console.log("\n3. A third pack chains off the second, not the first");
  today(2026, 10, 20);
  const third = grantCredits({ userId: user.id, credits: 4, validityDays: 30 });
  check("expires 17 December", studioDateKey(third.expiresAt!) === "2026-12-17", studioDateKey(third.expiresAt!));

  console.log("\n4. What does not chain");
  const personal = grantCredits({ userId: user.id, credits: 1, validityDays: 30, kind: "PERSONAL" });
  check("a personal session counts from today", studioDateKey(personal.expiresAt!) === "2026-11-19", studioDateKey(personal.expiresAt!));
  const goodwill = grantCredits({ userId: user.id, credits: 1, validityDays: 30, source: "GRANT", reason: "ADMIN_GRANT" });
  check("a desk goodwill grant counts from today", studioDateKey(goodwill.expiresAt!) === "2026-11-19", studioDateKey(goodwill.expiresAt!));
  const fourth = grantCredits({ userId: user.id, credits: 4, validityDays: 30 });
  check("the goodwill grant did not push the next class pack out", studioDateKey(fourth.expiresAt!) === "2027-01-16", studioDateKey(fourth.expiresAt!));

  console.log("\n5. After everything has lapsed, a pack counts from today again");
  today(2027, 3, 1);
  const fresh = grantCredits({ userId: user.id, credits: 4, validityDays: 30 });
  check("expires 31 March", studioDateKey(fresh.expiresAt!) === "2027-03-31", studioDateKey(fresh.expiresAt!));

  console.log("\n6. A frozen plan batch is ignored");
  db.update(creditBatches).set({ frozenAt: new Date() }).where(eq(creditBatches.id, fresh.id)).run();
  const afterFrozen = grantCredits({ userId: user.id, credits: 4, validityDays: 30 });
  check("counts from today", studioDateKey(afterFrozen.expiresAt!) === "2027-03-31", studioDateKey(afterFrozen.expiresAt!));

  Date.now = realNow;
  db.delete(creditLedger).where(eq(creditLedger.userId, user.id)).run();
  db.delete(creditBatches).where(eq(creditBatches.userId, user.id)).run();
  db.delete(users).where(eq(users.id, user.id)).run();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
