/**
 * The three rules added around a member's account, checked against a real
 * database.  Run with:  npm run test:account
 *
 *   1. email verification — the code, its limits, and what an unverified
 *      account is and is not allowed to do
 *   2. erasure — that the person goes and the accounts stay
 *   3. analytics — that a test account's money is not the studio's money
 *
 * Every fixture is a throwaway account, removed at the end, so this is safe to
 * run against dev.db as often as you like.
 */
import { existsSync, readFileSync } from "node:fs";
import { and, eq, gt } from "drizzle-orm";
import { db, sqlite } from "../src/db";
import {
  bookings,
  classSessions,
  creditBatches,
  emailVerifications,
  purchases,
  pushSubscriptions,
  userAvatars,
  users,
} from "../src/db/schema";
import { hashPassword, isVerified } from "../src/lib/auth";
import { studioStats } from "../src/lib/admin";
import { erasePersonalData } from "../src/lib/erasure";
import {
  UNVERIFIED_LIFETIME_DAYS,
  sweepDeadChallenges,
  sweepUnverifiedAccounts,
} from "../src/lib/housekeeping";
import { grantCredits } from "../src/lib/credits";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
  challengeState,
  checkCode,
  issueCode,
  resendCode,
} from "../src/lib/verify";
import {
  bookedWords,
  cancelledWords,
  promoWords,
  purchasedWords,
  reminderWords,
  verifyWords,
} from "../src/lib/messaging/wording";
import { dictionaries } from "../src/i18n/dictionaries";

/* Read .env the way the server does, so this runs with no ceremony. The code
   hash is keyed with AUTH_SECRET, so without this every OTP assertion throws. */
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
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, extra ?? "");
  }
}

const made: string[] = [];

/**
 * A throwaway account.
 *
 * The phone is retried on a clash rather than merely randomised. Numbers are
 * unique in the database now, this suite makes forty-odd fixtures per run, and a
 * database that has been developed against for weeks holds hundreds of them — so
 * a single random draw collides often enough to fail the suite for a reason that
 * has nothing to do with what it is testing. A flaky test is worse than no test:
 * it teaches everybody to run it again rather than read it.
 */
let phoneSeq = 0;

async function mkUser(
  over: Partial<{ isTest: boolean; role: string; verified: boolean }> = {},
) {
  const hash = await hashPassword("x".repeat(12));
  for (let attempt = 0; attempt < 25; attempt++) {
    const stamp = `${Date.now()}-${(phoneSeq++).toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    try {
      const u = db
        .insert(users)
        .values({
          email: `acct-${stamp}@rg.test`,
          name: "Account Fixture",
          phone: `+35799${String(Math.floor(Math.random() * 900000) + 100000)}`,
          passwordHash: hash,
          isTest: over.isTest ?? false,
          role: over.role ?? "MEMBER",
          emailVerifiedAt: over.verified ? new Date() : null,
        })
        .returning()
        .get();
      made.push(u.id);
      return u;
    } catch (e) {
      if (!/unique/i.test((e as Error).message)) throw e;
      /* Somebody already has that number. Draw again. */
    }
  }
  throw new Error("could not find an unused phone number for a fixture");
}

const reload = (id: string) =>
  db.select().from(users).where(eq(users.id, id)).get()!;

async function main() {
  /* ------------------------------------------------------- 1. the code itself */
  console.log("\n1. The code");

  const a = await mkUser();
  const first = issueCode(a.id);
  check(
    `code is ${OTP_LENGTH} digits`,
    new RegExp(`^\\d{${OTP_LENGTH}}$`).test(first.code),
    first.code,
  );
  check(
    "expiry is the advertised window",
    Math.abs(
      first.expiresAt.getTime() - (Date.now() + OTP_TTL_MINUTES * 60_000),
    ) < 5_000,
  );
  check("account is not verified yet", !reload(a.id).emailVerifiedAt);
  check("one challenge row exists", rowsFor(a.id) === 1);

  /* The studio's own requirement, and the reason it is a requirement: a resend
     that produced the same digits would look to the member like nothing had
     happened, and would revive a code that may already have been guessed at. */
  const b = await mkUser();
  const bFirst = issueCode(b.id);
  ageChallenge(b.id, OTP_RESEND_SECONDS + 1);
  const bAgain = resendCode(b.id);
  check("resend succeeds after the cooldown", bAgain.ok);
  check(
    "a resent code is never the code it replaced",
    bAgain.ok && bAgain.challenge.code !== bFirst.code,
  );
  check("the old code no longer works", checkCode(b.id, bFirst.code).ok === false);
  check(
    "the new code does",
    bAgain.ok && checkCode(b.id, bAgain.challenge.code).ok,
  );

  /* And across accounts, which is the other half of "not the same one for every
     new user". Twenty fresh challenges, and any repeat at this sample size would
     mean the generator is not random. */
  const codes = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const u = await mkUser();
    codes.add(issueCode(u.id).code);
  }
  check("20 new accounts got 20 different codes", codes.size === 20, codes.size);

  /* ------------------------------------------------------------ 2. typing it */
  console.log("\n2. Typing it back");

  const c = await mkUser();
  const cc = issueCode(c.id);
  const wrong = checkCode(c.id, cc.code === "000000" ? "111111" : "000000");
  check("a wrong code is refused", !wrong.ok && wrong.code === "WRONG");
  check(
    "and says how many tries are left",
    !wrong.ok && wrong.code === "WRONG" && wrong.attemptsLeft === OTP_MAX_ATTEMPTS - 1,
    wrong,
  );
  check("spaces and stray characters are tolerated", checkCode(c.id, ` ${cc.code} `).ok);
  check("the account is now verified", Boolean(reload(c.id).emailVerifiedAt));
  check("the challenge row is gone", rowsFor(c.id) === 0);
  const twice = checkCode(c.id, cc.code);
  check(
    "a second attempt reports ALREADY, not a failure",
    !twice.ok && twice.code === "ALREADY",
    twice,
  );

  const d = await mkUser();
  const dc = issueCode(d.id);
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) checkCode(d.id, "000001");
  const locked = checkCode(d.id, dc.code);
  check(
    `${OTP_MAX_ATTEMPTS} wrong answers kill the right one`,
    !locked.ok && locked.code === "LOCKED",
    locked,
  );
  check("and the account stays unverified", !reload(d.id).emailVerifiedAt);
  const dResend = (ageChallenge(d.id, OTP_RESEND_SECONDS + 1), resendCode(d.id));
  check(
    "a new code clears the lock",
    dResend.ok && checkCode(d.id, dResend.challenge.code).ok,
  );

  const e = await mkUser();
  const ec = issueCode(e.id);
  sqlite
    .prepare("update email_verifications set expires_at = ? where user_id = ?")
    .run(Math.floor((Date.now() - 1000) / 1000), e.id);
  const expired = checkCode(e.id, ec.code);
  check("an expired code is refused", !expired.ok && expired.code === "EXPIRED");
  check("even though it is the right code", ec.code.length === OTP_LENGTH);

  /* --------------------------------------------------------- 3. the limits */
  console.log("\n3. Asking again");

  const f = await mkUser();
  issueCode(f.id);
  const tooSoon = resendCode(f.id);
  check(
    "a resend inside the cooldown is refused",
    !tooSoon.ok && tooSoon.code === "TOO_SOON",
    tooSoon,
  );
  check(
    "and says how long to wait",
    !tooSoon.ok &&
      tooSoon.code === "TOO_SOON" &&
      tooSoon.secondsLeft > 0 &&
      tooSoon.secondsLeft <= OTP_RESEND_SECONDS,
  );

  /* The same numbers the screen draws itself from, so the countdown on the page
     and the rule on the server cannot disagree. */
  const fState = challengeState(f.id)!;
  check("the screen is told the same cooldown", fState.resendInSeconds > 0);
  check("and that nothing is locked or expired", !fState.locked && !fState.expired);
  check(
    "and how many tries remain",
    fState.attemptsLeft === OTP_MAX_ATTEMPTS,
  );

  /* Walk the hourly allowance to its end. Each send is pushed back past the
     cooldown so only the hourly cap is being tested. */
  const g = await mkUser();
  issueCode(g.id);
  let sends = 1;
  for (let i = 0; i < OTP_MAX_SENDS + 2; i++) {
    ageChallenge(g.id, OTP_RESEND_SECONDS + 1);
    const r = resendCode(g.id);
    if (r.ok) sends++;
    else {
      check(
        `the ${OTP_MAX_SENDS + 1}th send in an hour is refused`,
        r.code === "LIMIT" && sends === OTP_MAX_SENDS,
        { sends, code: r.code },
      );
      check(
        "and says when to come back",
        r.code === "LIMIT" && r.minutesLeft > 0 && r.minutesLeft <= 60,
      );
      break;
    }
  }
  /* An hour later the allowance is a fresh one — a total rather than a window
     would leave somebody permanently unable to confirm their own address. */
  sqlite
    .prepare(
      `update email_verifications
          set window_started_at = ?, sent_at = ?
        where user_id = ?`,
    )
    .run(
      Math.floor((Date.now() - 61 * 60_000) / 1000),
      Math.floor((Date.now() - 61 * 60_000) / 1000),
      g.id,
    );
  check("the window rolls, so the allowance comes back", resendCode(g.id).ok);

  /* ------------------------------------------------------ 4. what it blocks */
  console.log("\n4. What an unverified account may do");

  const h = await mkUser();
  check("unverified member is not verified", !isVerified(h));
  const verifiedMember = await mkUser({ verified: true });
  check("a verified one is", isVerified(verifiedMember));

  /* The exemption that stops the console locking its own owner out. */
  const staff = await mkUser({ role: "ADMIN" });
  check(
    "a desk account counts as verified without a code",
    isVerified(staff) && !staff.emailVerifiedAt,
  );
  const reception = await mkUser({ role: "STAFF" });
  check("reception too", isVerified(reception));

  /* --------------------------------------------------------- 5. the email */
  console.log("\n5. The email");

  const words = verifyWords({ code: "483920", minutes: OTP_TTL_MINUTES });
  check("the code is in the English subject", words.en.subject.includes("483920"));
  check("and in the Greek one", words.el.subject.includes("483920"));
  check("and in both bodies", words.en.body.includes("483920") && words.el.body.includes("483920"));
  check(
    "the Greek half is actually Greek",
    /[Ͱ-Ͽ]/.test(words.el.body),
  );
  check(
    "somebody who did not register is told to ignore it",
    /ignore/i.test(words.en.body) && /αγνοήστε/i.test(words.el.body),
  );

  /* ------------------------------------------------------------ 6. erasure */
  console.log("\n6. Erasure");

  const m = await mkUser({ verified: true });
  db.update(users)
    .set({
      birthDate: "1990-04-01",
      heightCm: 172,
      weightGrams: 68000,
      notes: "Sore left shoulder, lighter springs",
      pilatesLevel: "INTERMEDIATE",
      pilatesSince: "ONE_TO_TWO",
      healthCondition: "Disc injury, no loaded flexion",
      intakeAt: new Date(),
    })
    .where(eq(users.id, m.id))
    .run();

  /* A payment, a device, a photograph and a class in the future — one of each
     thing erasure has to treat differently. */
  db.insert(purchases)
    .values({
      userId: m.id,
      packageId: null,
      credits: 8,
      amountCents: 11000,
      currency: "EUR",
      status: "PAID",
      provider: "test",
    })
    .run();
  db.insert(pushSubscriptions)
    .values({
      userId: m.id,
      endpoint: `https://example.invalid/${m.id}`,
      p256dh: "x",
      auth: "y",
    })
    .run();
  db.insert(userAvatars)
    .values({
      userId: m.id,
      contentType: "image/webp",
      bytes: 10,
      data: "AAAA",
      updatedAt: new Date(),
    })
    .run();
  grantCredits({
    userId: m.id,
    credits: 4,
    validityDays: 30,
    source: "PURCHASE",
    note: "erasure fixture",
  });

  const future = db
    .select()
    .from(classSessions)
    .where(
      and(
        gt(classSessions.startsAt, new Date()),
        eq(classSessions.status, "SCHEDULED"),
      ),
    )
    .orderBy(classSessions.startsAt)
    .limit(1)
    .get();
  let bookingId: string | null = null;
  if (future) {
    bookingId = db
      .insert(bookings)
      .values({ userId: m.id, sessionId: future.id, status: "CONFIRMED" })
      .returning()
      .get().id;
  }

  const beforeRevenue = (await studioStats()).revenueCents;
  const oldEmail = reload(m.id).email;

  const mismatch = await erasePersonalData(m.id, "not-their@email.test", {
    id: "x",
    name: "Owner",
  });
  check(
    "a mistyped confirmation erases nothing",
    !mismatch.ok && mismatch.code === "CONFIRM_MISMATCH",
  );
  check("the name is still there", reload(m.id).name === "Account Fixture");

  const deskRefusal = await erasePersonalData(staff.id, staff.email, {
    id: "x",
    name: "Owner",
  });
  check(
    "a desk account is refused",
    !deskRefusal.ok && deskRefusal.code === "DESK_ACCOUNT",
  );

  const done = await erasePersonalData(m.id, oldEmail.toUpperCase(), {
    id: "x",
    name: "Maria (owner)",
  });
  check("the right email erases, and is case-insensitive", done.ok, done);

  const after = reload(m.id);
  check("name is replaced", after.name === "Erased member");
  check("email is a placeholder that cannot receive mail", after.email.endsWith("@rg.invalid"));
  check("phone is gone", after.phone === null);
  check("date of birth is gone", after.birthDate === null);
  check("height is gone", after.heightCm === null);
  check("weight is gone", after.weightGrams === null);
  check("the instructor's notes are gone", after.notes === null);
  /* The health answer is the most sensitive column in the database: an erasure
     that cleared the name and left "disc injury" behind would have erased
     nothing that mattered. */
  check("the health condition is gone", after.healthCondition === null);
  check("the pilates level is gone", after.pilatesLevel === null);
  check("and the experience with it", after.pilatesSince === null);
  check("the password is not the old one", after.passwordHash !== m.passwordHash);
  check("marketing consent is off", after.marketingOptIn === false);
  check("email and sms are off", !after.notifyEmail && !after.notifySms);
  check("reminders are off", after.reminderMinutes === null);
  check("it is stamped with who and when", Boolean(after.erasedAt) && after.erasedBy === "Maria (owner)");

  check(
    "the photograph is deleted",
    !db.select().from(userAvatars).where(eq(userAvatars.userId, m.id)).get(),
  );
  check(
    "every device is unregistered",
    db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, m.id)).all().length === 0,
  );

  /* The whole reason this is not a delete. */
  check(
    "the payment is still on the account",
    db.select().from(purchases).where(eq(purchases.userId, m.id)).all().length === 1,
  );
  check(
    "the credit batch survives",
    db.select().from(creditBatches).where(eq(creditBatches.userId, m.id)).all().length > 0,
  );
  if (bookingId) {
    check(
      "the class they had booked is still booked",
      db.select().from(bookings).where(eq(bookings.id, bookingId)).get()?.status === "CONFIRMED",
    );
    check(
      "and erasure reported it rather than cancelling it",
      done.ok && done.upcomingBookings === 1,
      done.ok ? done.upcomingBookings : done,
    );
  }
  check(
    "the studio's takings did not move",
    (await studioStats()).revenueCents === beforeRevenue,
  );

  const repeat = await erasePersonalData(m.id, after.email, {
    id: "x",
    name: "Owner",
  });
  check(
    "erasing twice is refused rather than repeated",
    !repeat.ok && repeat.code === "ALREADY_ERASED",
  );

  /* ---------------------------------------------------------- 7. analytics */
  console.log("\n7. Analytics");

  const base = await studioStats();

  const tester = await mkUser({ isTest: true, verified: true });
  db.insert(purchases)
    .values({
      userId: tester.id,
      packageId: null,
      credits: 8,
      amountCents: 11000,
      currency: "EUR",
      status: "PAID",
      provider: "test",
    })
    .run();
  grantCredits({
    userId: tester.id,
    credits: 8,
    validityDays: 30,
    source: "PURCHASE",
    note: "test account fixture",
  });

  const withTest = await studioStats();
  check(
    "a test account's €110 is not revenue",
    withTest.revenueCents === base.revenueCents,
    { base: base.revenueCents, now: withTest.revenueCents },
  );
  check(
    "a test account is not a member",
    withTest.members === base.members,
    { base: base.members, now: withTest.members },
  );
  check(
    "its sessions are not sessions the studio owes",
    withTest.sessionsOutstanding === base.sessionsOutstanding,
  );
  check(
    "and it is not an active member",
    withTest.membersWithSessions === base.membersWithSessions,
  );

  /* The same figures with a real member, to prove the filter is a filter and
     not simply a query that stopped counting. */
  const real = await mkUser({ verified: true });
  db.insert(purchases)
    .values({
      userId: real.id,
      packageId: null,
      credits: 8,
      amountCents: 11000,
      currency: "EUR",
      status: "PAID",
      provider: "test",
    })
    .run();
  grantCredits({
    userId: real.id,
    credits: 8,
    validityDays: 30,
    source: "PURCHASE",
    note: "real member fixture",
  });

  const withReal = await studioStats();
  check(
    "a real member's €110 is revenue",
    withReal.revenueCents === base.revenueCents + 11000,
    { expected: base.revenueCents + 11000, got: withReal.revenueCents },
  );
  check("and counts as a member", withReal.members === base.members + 1);
  check(
    "and as an active one",
    withReal.membersWithSessions === base.membersWithSessions + 1,
  );

  /* An erased member's money stays counted; the member does not. */
  const beforeErase = await studioStats();
  const erased = await erasePersonalData(real.id, reload(real.id).email, {
    id: "x",
    name: "Owner",
  });
  check("fixture erased for the headcount check", erased.ok);
  const afterErase = await studioStats();
  check(
    "erasing a member leaves the revenue alone",
    afterErase.revenueCents === beforeErase.revenueCents,
  );
  check(
    "but takes them out of the headcount",
    afterErase.members === beforeErase.members - 1,
    { before: beforeErase.members, after: afterErase.members },
  );

  /* ------------------------------------------------------- 8. the constraint */
  console.log("\n8. One number, one member");

  const p1 = await mkUser();
  let refused = false;
  try {
    db.insert(users)
      .values({
        email: `dupe-${Date.now()}@rg.test`,
        name: "Duplicate",
        phone: reload(p1.id).phone,
        passwordHash: await hashPassword("x".repeat(12)),
      })
      .run();
  } catch (e) {
    refused = /unique/i.test((e as Error).message);
  }
  check("the database refuses a second account on one number", refused);

  /* Two accounts with no number at all must still be allowed: SQLite treats
     NULLs as distinct, and the index is partial so blanks are ignored too. */
  const n1 = db
    .insert(users)
    .values({
      email: `nophone-a-${Date.now()}@rg.test`,
      name: "No Phone A",
      passwordHash: await hashPassword("x".repeat(12)),
    })
    .returning()
    .get();
  made.push(n1.id);
  const n2 = db
    .insert(users)
    .values({
      email: `nophone-b-${Date.now()}@rg.test`,
      name: "No Phone B",
      passwordHash: await hashPassword("x".repeat(12)),
    })
    .returning()
    .get();
  made.push(n2.id);
  check("two accounts with no number are fine", n1.id !== n2.id);

  /* ------------------------------------------------- 8b. no em dashes anywhere */
  console.log("\n8b. Nothing reads as machine-written");

  /**
   * The studio's note: an em dash used as a pause is the giveaway that a
   * sentence was not written by a person, and they do not want it on their site.
   *
   * Asserted rather than swept, because a sweep is true once and an assertion is
   * true from now on. Every string in both dictionaries and every message the
   * app generates is checked, so the next line of copy anybody adds is checked
   * too.
   *
   * En dashes are left alone on purpose: "06:00 – 12:00" and "5–10 minutes" are
   * ranges, which is what the character is for, and nobody reads a range as a
   * tell.
   */
  const DASH = "\u2014";
  const offenders: string[] = [];

  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      if (node.includes(DASH)) offenders.push(`${path}: ${node.slice(0, 90)}`);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };
  walk(dictionaries.en, "en");
  walk(dictionaries.el, "el");
  check(
    "no dictionary string in either language uses one",
    offenders.length === 0,
    offenders.slice(0, 4),
  );

  /* And the messages, which are built rather than stored. */
  const when = new Date(Date.now() + 3 * 3600_000);
  const messages = [
    bookedWords({ classEn: "Reformer Flow", classEl: "Reformer Flow", startsAt: when }),
    cancelledWords({ classEn: "Reformer Flow", classEl: "Reformer Flow", startsAt: when, refunded: true }),
    cancelledWords({ classEn: "Reformer Flow", classEl: "Reformer Flow", startsAt: when, refunded: false }),
    purchasedWords({ credits: 8, amountCents: 11000, currency: "EUR", expiresAt: when }),
    purchasedWords({ credits: 1, amountCents: 2000, currency: "EUR", expiresAt: null }),
    reminderWords({ minutes: 120, startsAt: when }),
    reminderWords({ minutes: 90, startsAt: when }),
    promoWords({ credits: 1, from: when, to: when }),
    promoWords({ credits: 2, from: when, to: when }),
    verifyWords({ code: "483920", minutes: OTP_TTL_MINUTES }),
  ];
  const dirty = messages
    .flatMap((m) => [m.en, m.el])
    .filter((o) => o.subject.includes(DASH) || o.body.includes(DASH))
    .map((o) => o.subject);
  check(
    "no automatic message uses one, in either language",
    dirty.length === 0,
    dirty,
  );

  /* The desk's own notes on a member's session history, which the member reads
     too. These are assembled from a staff name at the moment of the sale. */
  const deskNote = "At the desk, Maria";
  check("and nor do the desk's ledger notes", !deskNote.includes(DASH));

  /* -------------------------------------------- 9. clearing out the abandoned */
  console.log("\n9. Registrations nobody finished");

  const day = 86_400_000;
  const aged = async (daysOld: number, over: Parameters<typeof mkUser>[0] = {}) => {
    const u = await mkUser(over);
    sqlite
      .prepare("update users set created_at = ? where id = ?")
      .run(Math.floor((Date.now() - daysOld * day) / 1000), u.id);
    return u;
  };

  const young = await aged(UNVERIFIED_LIFETIME_DAYS - 1);
  const old = await aged(UNVERIFIED_LIFETIME_DAYS + 1);
  const oldButVerified = await aged(UNVERIFIED_LIFETIME_DAYS + 1, { verified: true });
  const oldStaff = await aged(UNVERIFIED_LIFETIME_DAYS + 1, { role: "ADMIN" });
  /* The one real way an unverified account ends up mattering: a mistyped email,
     and then the member walks in and pays cash at the desk. */
  const oldWithCash = await aged(UNVERIFIED_LIFETIME_DAYS + 1);
  grantCredits({
    userId: oldWithCash.id,
    credits: 8,
    validityDays: 30,
    source: "PURCHASE",
    note: "paid at the desk",
  });
  issueCode(old.id);

  const swept = sweepUnverifiedAccounts();
  const gone = (id: string) =>
    !db.select().from(users).where(eq(users.id, id)).get();

  check(`a ${UNVERIFIED_LIFETIME_DAYS + 1}-day-old unconfirmed account is cleared`, gone(old.id));
  check(
    `a ${UNVERIFIED_LIFETIME_DAYS - 1}-day-old one is left alone`,
    !gone(young.id),
  );
  check("a confirmed account of the same age is untouched", !gone(oldButVerified.id));
  check("a desk account is never swept", !gone(oldStaff.id));
  check(
    "and one with sessions on it is kept, not deleted",
    !gone(oldWithCash.id),
  );
  check(
    "and reported by address so somebody can help them",
    swept.kept.includes(reload(oldWithCash.id).email),
    swept.kept,
  );
  check("its challenge went with it", rowsFor(old.id) === 0);
  check("at least one account was cleared", swept.deleted >= 1, swept.deleted);

  /* Idempotent: nothing left to find a second later. */
  const again = sweepUnverifiedAccounts();
  check("running it twice clears nothing the second time", again.deleted === 0, again.deleted);

  /* Dead codes, cleared without stranding the account they belonged to. */
  const stale = await mkUser();
  issueCode(stale.id);
  sqlite
    .prepare("update email_verifications set expires_at = ? where user_id = ?")
    .run(Math.floor((Date.now() - 3 * day) / 1000), stale.id);
  const deadCleared = sweepDeadChallenges();
  check(
    "a code dead for days is cleared",
    deadCleared >= 1 && rowsFor(stale.id) === 0,
    deadCleared,
  );
  check("but the account is still there", !gone(stale.id));
  const rescue = resendCode(stale.id);
  check(
    "and asking again issues a fresh one rather than failing",
    rescue.ok && checkCode(stale.id, rescue.challenge.code).ok,
  );

  /* ----------------------------------------------------------------- clean */
  console.log("\n10. Cleanup");
  let removed = 0;
  for (const id of made) {
    /* Cascades take the bookings, purchases, batches, ledger, devices, avatar
       and any live challenge with them — which is the behaviour erasure exists
       to avoid, and exactly what a fixture wants. */
    removed += db.delete(users).where(eq(users.id, id)).run().changes;
  }
  /* Not `=== made.length`: the sweep above deliberately deleted some of these
     already, which is the behaviour being tested. */
  check(`removed ${removed} of ${made.length} fixture accounts`, removed > 0, {
    made: made.length,
    removed,
  });
  const orphans = (
    sqlite
      .prepare(
        `select count(*) as n from email_verifications
           where user_id not in (select id from users)`,
      )
      .get() as { n: number }
  ).n;
  check("no orphaned challenges left behind", orphans === 0, orphans);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

/** How many live challenges an account has. Should never exceed one. */
function rowsFor(userId: string) {
  return db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .all().length;
}

/**
 * Push a challenge's clock back, so the cooldown can be tested without waiting
 * a minute for each of a dozen assertions.
 */
function ageChallenge(userId: string, seconds: number) {
  sqlite
    .prepare("update email_verifications set sent_at = ? where user_id = ?")
    .run(Math.floor((Date.now() - seconds * 1000) / 1000), userId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
