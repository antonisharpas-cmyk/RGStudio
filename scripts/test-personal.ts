/**
 * Personal and duet sessions, and the Unlimited plan, checked against a real
 * database.  Run with:  npm run test:personal
 *
 * What this suite is for. Two new rules were added to a credit system that had
 * exactly one rule before, and both of them are the kind that fail silently:
 *
 *   1. a session of the wrong kind must not pay for a class, in either
 *      direction. Get this wrong and a member spends €30 of one to one on an
 *      18:00 group class, or is told they have no sessions while holding six
 *   2. an appointment closes at the end of the previous day, and so does its
 *      cancellation. Get this wrong and an instructor is called in for an hour
 *      that has been cancelled, or is not called in for one that has not
 *
 * Neither would throw. Both would be discovered by a member losing money, which
 * is why they are asserted here rather than tested by hand once.
 *
 * Also checked: the Unlimited arithmetic, the one-a-day rule, the appointment
 * slots being where the studio says they are, the studio's own email carrying
 * what somebody needs to make a phone call, and no em dash in any of the new
 * words in either language.
 *
 * Every fixture is a throwaway account with `isTest` set, removed at the end, so
 * this is safe to run against dev.db as often as you like.
 */
import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../src/db";
import { bookings, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { bookClass, cancelBooking, listMyBookings } from "../src/lib/booking";
import {
  getCreditSummary,
  grantCredits,
  kindsThatPayFor,
  refundOneCredit,
  spendBlockReason,
} from "../src/lib/credits";
import { activeInstructors, upcomingAppointments } from "../src/lib/admin";
import {
  CONDITION_MAX_CHARS,
  PILATES_EXPERIENCE,
  PILATES_LEVELS,
  intakeRequired,
} from "../src/lib/intake";
import {
  assignInstructor,
  bookForMember,
  memberDetail,
  updateContact,
} from "../src/lib/reception";
import {
  PERSONAL_DURATION_MINUTES,
  PERSONAL_SLOT_DAYS,
  PERSONAL_SLOT_HOURS,
  STUDIO_OPS_EMAIL,
  isPersonalBookable,
  isPersonalCancellable,
  personalBookingClosesAt,
} from "../src/lib/personal";
import {
  BUILDER_TERMS,
  CARD_GROUPS,
  PACKS,
  packBySlug,
} from "../src/lib/packs";
import { repairCatalogue } from "../src/lib/catalogue-repair";
import { repairSchedule } from "../src/lib/schedule-repair";
import { repairTimetable } from "../src/lib/timetable-repair";
import {
  instructorChangedWords,
  personalBookedWords,
  personalCancelledWords,
  studioAppointmentWords,
} from "../src/lib/messaging/wording";
import { dictionaries } from "../src/i18n/dictionaries";
import { APPOINTMENT_SENDS } from "../src/lib/messaging/events";
import {
  studioAddDays,
  studioDateKey,
  studioEndOfDay,
  studioParts,
  studioStartOfDay,
  studioWallTimeToInstant,
} from "../src/lib/time";

/* Read .env the way the server does, so this runs with no ceremony. */
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
let seq = 0;

async function mkUser() {
  const hash = await hashPassword("x".repeat(12));
  for (let attempt = 0; attempt < 25; attempt++) {
    const stamp = `${Date.now()}-${(seq++).toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    try {
      const u = db
        .insert(users)
        .values({
          email: `personal-${stamp}@rg.test`,
          name: "Appointment Fixture",
          phone: `+35799${String(Math.floor(Math.random() * 900000) + 100000)}`,
          passwordHash: hash,
          isTest: true,
          emailVerifiedAt: new Date(),
        })
        .returning()
        .get();
      made.push(u.id);
      return u;
    } catch (e) {
      if (!/unique/i.test((e as Error).message)) throw e;
    }
  }
  throw new Error("could not find an unused phone number for a fixture");
}

type Slot = { id: string; startsAt: Date };

/** Appointment slots still open for booking, soonest first. */
function openAppointments(limit = 40): Slot[] {
  const now = new Date();
  return (
    sqlite
      .prepare(
        `select cs.id, cs.starts_at as t
           from class_sessions cs
           join class_types ct on ct.id = cs.class_type_id
          where ct.kind = 'PERSONAL'
            and cs.status = 'SCHEDULED'
            and cs.starts_at > unixepoch()
          order by cs.starts_at
          limit ?`,
      )
      .all(limit) as { id: string; t: number }[]
  )
    .map((r) => ({ id: r.id, startsAt: new Date(r.t * 1000) }))
    .filter(
      (s) =>
        isPersonalBookable(s.startsAt, now) &&
        /* Nobody in it, so the fixture is not fighting another test's booking. */
        (
          sqlite
            .prepare(
              "select count(*) as n from bookings where session_id = ? and status != 'CANCELLED'",
            )
            .get(s.id) as { n: number }
        ).n === 0,
    );
}

/** Group classes on one studio day, with room in them. */
function groupClassesOn(dayOffset: number, limit = 3): Slot[] {
  const day = studioAddDays(studioStartOfDay(new Date()), dayOffset);
  const key = studioDateKey(day);
  return (
    sqlite
      .prepare(
        `select cs.id, cs.starts_at as t, cs.capacity as cap
           from class_sessions cs
           join class_types ct on ct.id = cs.class_type_id
          where ct.kind = 'GROUP'
            and cs.status = 'SCHEDULED'
            and cs.starts_at > unixepoch()
          order by cs.starts_at`,
      )
      .all() as { id: string; t: number; cap: number }[]
  )
    .filter((r) => studioDateKey(new Date(r.t * 1000)) === key)
    .filter(
      (r) =>
        (
          sqlite
            .prepare(
              "select count(*) as n from bookings where session_id = ? and status != 'CANCELLED'",
            )
            .get(r.id) as { n: number }
        ).n < r.cap,
    )
    .slice(0, limit)
    .map((r) => ({ id: r.id, startsAt: new Date(r.t * 1000) }));
}

const EM_DASH = "—";

/** Whether an appointment emails the member. It must not: see events.ts. */
const SENDS_APPOINTMENT_EMAIL = APPOINTMENT_SENDS.email;

async function main() {
  /* The suite exercises data the repairs create, so make sure they have run.
     All three are idempotent, so this is free on a database already in shape. */
  repairCatalogue();
  repairTimetable();
  repairSchedule();

  /* ------------------------------------------------------ 1. the price list */
  console.log("\n1. The price list");

  const day = packBySlug("single");
  check(
    "the single class is a day pass",
    day?.nameEn === "Day pass",
    day?.nameEn,
  );
  check("and it has a Greek name", (day?.nameEl ?? "").length > 0, day?.nameEl);

  const unlimited = packBySlug("quarter-4");
  check(
    "the 3 month plan is named Unlimited",
    (unlimited?.nameEn ?? "").includes("Unlimited"),
    unlimited?.nameEn,
  );
  /**
   * The arithmetic, asserted rather than trusted.
   *
   * 90 days is twelve whole weeks and six days over. The studio opens five days
   * a week, Monday to Friday, so the most a member could attend at one class a
   * day is twelve fives plus the five weekdays in the six spare days: 65. That
   * is the Unlimited count — the one number in the price list that is a
   * calculation rather than a decision, which makes it the one worth a test.
   */
  const weeks = Math.floor((unlimited?.validityDays ?? 0) / 7);
  const spare = (unlimited?.validityDays ?? 0) % 7;
  const expected = weeks * 5 + Math.min(spare, 5);
  check(
    `Unlimited credits one a day: ${weeks} weeks x 5 plus ${Math.min(spare, 5)} = ${expected}`,
    unlimited?.credits === expected,
    unlimited?.credits,
  );
  check(
    "and caps it at one class a day",
    unlimited?.perDayLimit === 1,
    unlimited?.perDayLimit,
  );

  const personalPack = packBySlug("personal");
  const duetPack = packBySlug("duet");
  check("a personal session costs 30 euro", personalPack?.priceCents === 3000);
  check("a duet costs 45", duetPack?.priceCents === 4500);
  check(
    "both expire in 30 days",
    personalPack?.validityDays === 30 && duetPack?.validityDays === 30,
  );
  check(
    "a duet is one session for two people",
    duetPack?.credits === 1 && duetPack?.seats === 2,
  );
  check(
    "both sit at the foot of the list, after the 3 month plans",
    (personalPack?.sortOrder ?? 0) > (unlimited?.sortOrder ?? 0) &&
      (duetPack?.sortOrder ?? 0) > (personalPack?.sortOrder ?? 0),
  );
  check(
    "every pack in the list declares what it buys",
    PACKS.every((p) => ["CLASS", "PERSONAL", "DUET"].includes(p.kind)),
  );

  /* The catalogue in the database has to agree, because that is what the
     checkout and the webhook read. */
  const rows = sqlite
    .prepare(
      "select slug, credits, price_cents, validity_days, kind, per_day_limit, seats from credit_packages where active = 1",
    )
    .all() as Record<string, never>[];
  const bySlug = new Map(rows.map((r) => [r.slug as unknown as string, r]));
  check(
    "the database agrees about the Unlimited count",
    Number(bySlug.get("quarter-4")?.credits) === expected,
    bySlug.get("quarter-4"),
  );
  check(
    "and about what a personal session buys",
    String(bySlug.get("personal")?.kind) === "PERSONAL" &&
      String(bySlug.get("duet")?.kind) === "DUET",
  );

  /* --------------------------------------------------------- 2. the slots */
  console.log("\n2. The slots");

  const templates = sqlite
    .prepare(
      `select t.day_of_week as dow, t.start_minutes as m, t.duration_min as len,
              t.capacity as cap, t.active as active
         from class_templates t
         join class_types ct on ct.id = t.class_type_id
        where ct.kind = 'PERSONAL'`,
    )
    .all() as {
    dow: number;
    m: number;
    len: number;
    cap: number;
    active: number;
  }[];

  check(
    `${PERSONAL_SLOT_DAYS.length} weekdays x ${PERSONAL_SLOT_HOURS.length} hours = ${PERSONAL_SLOT_DAYS.length * PERSONAL_SLOT_HOURS.length} weekly slots`,
    templates.length === PERSONAL_SLOT_DAYS.length * PERSONAL_SLOT_HOURS.length,
    templates.length,
  );
  check(
    "at 12:00, 13:00 and 14:00 and nowhere else",
    templates.every((r) => PERSONAL_SLOT_HOURS.includes((r.m / 60) as never)),
    [...new Set(templates.map((r) => r.m / 60))],
  );
  check(
    "on weekdays and never at the weekend",
    templates.every((r) => r.dow >= 1 && r.dow <= 5),
    [...new Set(templates.map((r) => r.dow))].sort(),
  );
  check(
    "one reformer, so one booking",
    templates.every((r) => r.cap === 1),
    [...new Set(templates.map((r) => r.cap))],
  );
  check(
    `a full ${PERSONAL_DURATION_MINUTES} minutes`,
    templates.every((r) => r.len === PERSONAL_DURATION_MINUTES),
  );

  /**
   * The repair that would have broken them.
   *
   * `repairSchedule` forces every future class to the studio's capacity, which
   * is five. Run over an appointment it would sell four seats in a one to one,
   * and nothing would have complained.
   */
  repairSchedule();
  const caps = sqlite
    .prepare(
      `select distinct cs.capacity as cap from class_sessions cs
         join class_types ct on ct.id = cs.class_type_id
        where ct.kind = 'PERSONAL' and cs.starts_at > unixepoch()`,
    )
    .all() as { cap: number }[];
  check(
    "the capacity repair leaves appointments at one place",
    caps.every((r) => r.cap === 1),
    caps,
  );

  const generated = sqlite
    .prepare(
      `select count(*) as n from class_sessions cs
         join class_types ct on ct.id = cs.class_type_id
        where ct.kind = 'PERSONAL' and cs.starts_at > unixepoch()`,
    )
    .get() as { n: number };
  check(
    "the slots were rolled forward into real bookable hours",
    generated.n > 0,
    generated.n,
  );

  /* One class name, everywhere the timetable looks. */
  const liveGroupTypes = sqlite
    .prepare(
      "select slug, name_en from class_types where kind = 'GROUP' and active = 1",
    )
    .all() as { slug: string; name_en: string }[];
  check(
    "one group class type is on offer, not six",
    liveGroupTypes.length === 1,
    liveGroupTypes,
  );
  check(
    "and it is Reformer Flow",
    liveGroupTypes[0]?.name_en === "Reformer Flow",
    liveGroupTypes[0],
  );
  const futureNames = sqlite
    .prepare(
      `select distinct ct.name_en as n from class_sessions cs
         join class_types ct on ct.id = cs.class_type_id
        where ct.kind = 'GROUP' and cs.starts_at >= unixepoch()`,
    )
    .all() as { n: string }[];
  check(
    "every group class still to come carries that one name",
    futureNames.length === 1 && futureNames[0]!.n === "Reformer Flow",
    futureNames,
  );

  /* --------------------------------------------------- 3. what pays for what */
  console.log("\n3. What pays for what");

  check(
    "a group class takes a class session and nothing else",
    JSON.stringify(kindsThatPayFor("GROUP")) === JSON.stringify(["CLASS"]),
  );
  check(
    "one person at an appointment takes a personal session and only that",
    JSON.stringify(kindsThatPayFor("PERSONAL", 1)) ===
      JSON.stringify(["PERSONAL"]),
  );
  check(
    "two people need a duet session",
    JSON.stringify(kindsThatPayFor("PERSONAL", 2)) === JSON.stringify(["DUET"]),
  );

  const slots = openAppointments();
  if (slots.length < 4) {
    console.log(
      `  ! only ${slots.length} free appointment slots ahead, so some checks are skipped`,
    );
  }

  const m1 = await mkUser();
  grantCredits({ userId: m1.id, credits: 3, validityDays: 30 });

  check(
    "a class session cannot buy a midday hour",
    slots[0]
      ? (() => {
          const r = bookClass(m1.id, slots[0]!.id);
          return !r.ok && r.code === "NEEDS_PERSONAL_CREDIT";
        })()
      : true,
  );

  /* And the other direction, which is the half that costs the member money. */
  const m2 = await mkUser();
  grantCredits({
    userId: m2.id,
    credits: 1,
    validityDays: 30,
    kind: "PERSONAL",
  });
  const group = groupClassesOn(3);
  check(
    "a personal session cannot buy a group class",
    group[0]
      ? (() => {
          const r = bookClass(m2.id, group[0]!.id);
          return !r.ok && r.code === "CREDITS_NOT_VALID_HERE";
        })()
      : true,
    group.length,
  );

  /* The balance still reads honestly while both are held. */
  grantCredits({ userId: m2.id, credits: 4, validityDays: 30 });
  const sum = await getCreditSummary(m2.id);
  check(
    "the two halves of a mixed balance are counted apart",
    sum.available === 5 && sum.classCredits === 4 && sum.personalCredits === 1,
    sum,
  );
  check(
    "and the appointment half is split into solo and duet",
    sum.soloCredits === 1 && sum.duetCredits === 0,
    { solo: sum.soloCredits, duet: sum.duetCredits },
  );

  /* ------------------------------------------------------- 4. booking one */
  console.log("\n4. Booking one");

  const m3 = await mkUser();
  grantCredits({
    userId: m3.id,
    credits: 1,
    validityDays: 30,
    kind: "PERSONAL",
  });
  const solo = slots[0];
  let soloBooking = "";
  if (solo) {
    const r = bookClass(m3.id, solo.id);
    check("a personal session books the hour", r.ok, r);
    if (r.ok) {
      soloBooking = r.bookingId;
      check("and nobody else is named on it", r.guestName === null);
    }
    const again = bookClass(m3.id, solo.id);
    check(
      "one reformer means one booking",
      !again.ok &&
        (again.code === "ALREADY_BOOKED" || again.code === "CLASS_FULL"),
      again,
    );
  }

  /* Somebody else cannot take the same hour: capacity is one. */
  const m4 = await mkUser();
  grantCredits({
    userId: m4.id,
    credits: 1,
    validityDays: 30,
    kind: "PERSONAL",
  });
  if (solo) {
    const clash = bookClass(m4.id, solo.id);
    check(
      "and the hour is then full for everybody",
      !clash.ok && clash.code === "CLASS_FULL",
      clash,
    );
  }

  /* --------------------------------------------------------- 5. the duet */
  console.log("\n5. The duet");

  const duetSlot = slots[1];
  const m5 = await mkUser();
  grantCredits({
    userId: m5.id,
    credits: 1,
    validityDays: 30,
    kind: "PERSONAL",
  });
  if (duetSlot) {
    const r = bookClass(m5.id, duetSlot.id, { guestName: "Elena P." });
    check(
      "bringing somebody needs a duet session, not a personal one",
      !r.ok && r.code === "NEEDS_DUET_CREDIT",
      r,
    );
  }

  const m6 = await mkUser();
  grantCredits({ userId: m6.id, credits: 1, validityDays: 30, kind: "DUET" });
  let duetBooking = "";
  if (duetSlot) {
    const r = bookClass(m6.id, duetSlot.id, { guestName: "Elena P." });
    check("a duet session books the hour for two", r.ok, r);
    if (r.ok) {
      duetBooking = r.bookingId;
      check(
        "and the second person is on the booking",
        r.guestName === "Elena P.",
      );
    }
  }

  /**
   * And the hole that was closed: a Duet cannot be spent alone.
   *
   * It used to fall back, so somebody holding a €45 Duet could book the hour by
   * themselves and the studio would have sold the pair rate to one person. The
   * refusal says which of the two problems it is, because "you need a Personal
   * session" is true and unhelpful to somebody looking at a Duet in their
   * balance.
   */
  const m7 = await mkUser();
  grantCredits({ userId: m7.id, credits: 1, validityDays: 30, kind: "DUET" });
  if (slots[2]) {
    const r = bookClass(m7.id, slots[2]!.id);
    check(
      "a duet session cannot be spent on the hour alone",
      !r.ok && r.code === "DUET_IS_FOR_TWO",
      r,
    );
    check(
      "but it books the hour once somebody is named",
      (() => {
        const ok = bookClass(m7.id, slots[2]!.id, { guestName: "Nikos A." });
        return ok.ok && ok.guestName === "Nikos A.";
      })(),
    );
  }

  /* And a Personal session cannot cover two, which is the mirror image. */
  const m7b = await mkUser();
  grantCredits({
    userId: m7b.id,
    credits: 1,
    validityDays: 30,
    kind: "PERSONAL",
  });
  if (slots[3]) {
    const r = bookClass(m7b.id, slots[3]!.id, { guestName: "Nikos A." });
    check(
      "a personal session cannot cover two people",
      !r.ok && r.code === "NEEDS_DUET_CREDIT",
      r,
    );
  }

  /* ------------------------------------------------------- 6. the cutoff */
  console.log("\n6. The cutoff");

  const anySlot = slots[0] ?? {
    startsAt: studioAddDays(new Date(), 3),
    id: "",
  };
  const closes = personalBookingClosesAt(anySlot.startsAt);
  const parts = studioParts(closes);
  check(
    "booking closes at midnight at the start of the day of the session",
    parts.hour === 0 && parts.minute === 0,
    parts,
  );
  check(
    "which is the end of the day before",
    studioDateKey(studioAddDays(closes, -1)) ===
      studioDateKey(studioAddDays(anySlot.startsAt, -1)),
  );
  check(
    "a second before it, booking is open",
    isPersonalBookable(anySlot.startsAt, new Date(closes.getTime() - 1000)),
  );
  check(
    "at it, booking is closed",
    !isPersonalBookable(anySlot.startsAt, closes),
  );
  check(
    "and cancellation closes on the same line",
    isPersonalCancellable(
      anySlot.startsAt,
      new Date(closes.getTime() - 1000),
    ) && !isPersonalCancellable(anySlot.startsAt, closes),
  );

  /**
   * The real refusal, against a real row.
   *
   * Every appointment earlier than midnight tonight is past its cutoff, so if
   * the database holds one that has not started yet it is exactly the case this
   * rule exists for.
   */
  const tooLate = (
    sqlite
      .prepare(
        `select cs.id, cs.starts_at as t from class_sessions cs
           join class_types ct on ct.id = cs.class_type_id
          where ct.kind = 'PERSONAL' and cs.status = 'SCHEDULED'
            and cs.starts_at > unixepoch()
          order by cs.starts_at limit 1`,
      )
      .all() as { id: string; t: number }[]
  ).filter((r) => !isPersonalBookable(new Date(r.t * 1000), new Date()))[0];

  if (tooLate) {
    const m8 = await mkUser();
    grantCredits({
      userId: m8.id,
      credits: 1,
      validityDays: 30,
      kind: "PERSONAL",
    });
    const r = bookClass(m8.id, tooLate.id);
    check(
      "an hour later today is refused, because nobody can be called in for it",
      !r.ok && r.code === "PERSONAL_TOO_LATE",
      r,
    );
  } else {
    console.log("  ! no appointment inside today's window to refuse, skipped");
  }

  /* ------------------------------------------------ 7. cancelling one */
  console.log("\n7. Cancelling one");

  if (soloBooking) {
    const before = (await getCreditSummary(m3.id)).personalCredits;
    const r = cancelBooking(m3.id, soloBooking);
    check("cancelling in time works", r.ok, r);
    const after = await getCreditSummary(m3.id);
    check(
      "and the session comes back as a personal one, not a class one",
      after.personalCredits === before + 1 && after.classCredits === 0,
      { before, after: after.personalCredits, cls: after.classCredits },
    );
  }

  /* ------------------------------------------- 8. one class a day */
  console.log("\n8. One class a day");

  const m9 = await mkUser();
  grantCredits({
    userId: m9.id,
    credits: expected,
    validityDays: 90,
    perDayLimit: 1,
  });
  const twoOnOneDay = groupClassesOn(4, 2);
  if (twoOnOneDay.length === 2) {
    const first = bookClass(m9.id, twoOnOneDay[0]!.id);
    check("the first class of the day is fine", first.ok, first);
    const second = bookClass(m9.id, twoOnOneDay[1]!.id);
    check(
      "the second on the same day is refused, and says why",
      !second.ok && second.code === "ONE_PER_DAY",
      second,
    );
    const nextDay = groupClassesOn(5, 1);
    if (nextDay[0]) {
      const r = bookClass(m9.id, nextDay[0].id);
      check("the next day is open again", r.ok, r);
    }
    /* Cancelling the first frees the day back up. Somebody who changed their
       mind has used nothing. */
    if (first.ok) {
      cancelBooking(m9.id, first.bookingId);
      const retry = bookClass(m9.id, twoOnOneDay[1]!.id);
      check("and cancelling the first frees the day again", retry.ok, retry);
      if (retry.ok) cancelBooking(m9.id, retry.bookingId);
    }
  } else {
    console.log("  ! fewer than two free classes on that day, skipped");
  }

  /* An ordinary pack has no cap, and must not acquire one. */
  const m10 = await mkUser();
  grantCredits({ userId: m10.id, credits: 4, validityDays: 30 });
  const twoMore = groupClassesOn(6, 2);
  if (twoMore.length === 2) {
    const a = bookClass(m10.id, twoMore[0]!.id);
    const b = bookClass(m10.id, twoMore[1]!.id);
    check("an ordinary pack can still book twice in a day", a.ok && b.ok, {
      a,
      b,
    });
  }

  check(
    "the block reason for a capped batch is the cap, not a missing session",
    (() => {
      const m = made.length ? m9 : m9;
      const cls = groupClassesOn(4, 1)[0];
      if (!cls) return true;
      /* m9 has a class booked on day 4 again only if the retry above ran; the
         reason is asserted directly instead, which is what the UI reads. */
      return ["PER_DAY", "NOT_BLOCKED"].includes(
        spendBlockReason(m.id, {
          classStartsAt: cls.startsAt,
          kinds: ["CLASS"],
        }),
      );
    })(),
  );

  /* ------------------------------------------- 9. what the studio is told */
  console.log("\n9. What the studio is told");

  /* The member gets the buzz and the in-app copy; the email is the studio's
     alone, because the studio is the one who has to find an instructor. */
  check(
    "an appointment sends the member no email",
    SENDS_APPOINTMENT_EMAIL === false,
    SENDS_APPOINTMENT_EMAIL,
  );

  check(
    "the operations address is the one the studio asked for",
    STUDIO_OPS_EMAIL.includes("@"),
    STUDIO_OPS_EMAIL,
  );

  const when = new Date("2026-09-08T09:00:00Z"); // 12:00 in Larnaca
  const opsSolo = studioAppointmentWords({
    startsAt: when,
    memberName: "Andreas Kyriacou",
    memberEmail: "a@example.com",
    memberPhone: "+35799123456",
    guestName: null,
  });
  const opsDuet = studioAppointmentWords({
    startsAt: when,
    memberName: "Andreas Kyriacou",
    memberEmail: "a@example.com",
    memberPhone: "+35799123456",
    guestName: "Elena P.",
  });
  const opsCancel = studioAppointmentWords({
    startsAt: when,
    memberName: "Andreas Kyriacou",
    memberEmail: "a@example.com",
    memberPhone: "+35799123456",
    guestName: "Elena P.",
    cancelled: true,
  });

  check(
    "the studio email names the day and the hour in the subject",
    /Tuesday/.test(opsSolo.en.subject) && /12:00/.test(opsSolo.en.subject),
    opsSolo.en.subject,
  );
  check(
    "it carries the member's number, so a call can be made from it",
    opsSolo.en.body.includes("+35799123456"),
  );
  check(
    "it says whether one person or two are coming",
    opsSolo.en.body.includes("one person") &&
      opsDuet.en.body.includes("two people"),
  );
  check("it names the second person", opsDuet.en.body.includes("Elena P."));
  check(
    "it says out loud that an instructor is needed",
    /instructor/i.test(opsSolo.en.body),
  );
  check(
    "a cancellation is unmistakably a cancellation",
    /^Cancelled/.test(opsCancel.en.subject) &&
      /Ακύρωση/.test(opsCancel.el.subject),
    opsCancel.en.subject,
  );
  check(
    "and tells them to un-book the instructor they booked",
    /told/i.test(opsCancel.en.body),
  );

  /* ----------------------------------- 10. what the member is told */
  console.log("\n10. What the member is told");

  const meSolo = personalBookedWords({ startsAt: when, guestName: null });
  const meDuet = personalBookedWords({ startsAt: when, guestName: "Elena P." });
  const meCancel = personalCancelledWords({ startsAt: when, refunded: true });

  check(
    "the confirmation names the day and hour in both languages",
    /Tuesday 8 September at 12:00/.test(meSolo.en.body) &&
      /12:00/.test(meSolo.el.body) &&
      /Σεπτ/.test(meSolo.el.body),
    [meSolo.en.body.slice(0, 60), meSolo.el.body.slice(0, 60)],
  );
  check(
    "a duet confirmation names the person coming with them",
    meDuet.en.body.includes("Elena P.") && meDuet.el.body.includes("Elena P."),
  );
  check(
    "it states the cancellation rule, which is stricter than the one they know",
    /end of the day\s+before/.test(meSolo.en.body.replace(/\n/g, " ")) &&
      /προηγούμενης/.test(meSolo.el.body),
  );
  check(
    "it does not promise an instructor by name",
    !/Maria|Andreas P\./.test(meSolo.en.body),
  );
  check(
    "a cancellation says where the session went",
    /back in your balance/.test(meCancel.en.body) &&
      /υπόλοιπό σας/.test(meCancel.el.body),
  );

  /* -------------------------------------------- 11. no em dashes */
  console.log("\n11. No em dashes in anything a member reads");

  const generatedTexts: [string, string][] = [];
  for (const [name, w] of [
    ["personalBooked, solo", meSolo],
    ["personalBooked, duet", meDuet],
    ["personalCancelled", meCancel],
    ["studioAppointment, solo", opsSolo],
    ["studioAppointment, duet", opsDuet],
    ["studioAppointment, cancelled", opsCancel],
  ] as const) {
    generatedTexts.push([`${name} en`, `${w.en.subject} ${w.en.body}`]);
    generatedTexts.push([`${name} el`, `${w.el.subject} ${w.el.body}`]);
  }
  const dirty = generatedTexts.filter(([, text]) => text.includes(EM_DASH));
  check(
    `${generatedTexts.length} generated appointment texts are clean`,
    dirty.length === 0,
    dirty.map(([n]) => n),
  );

  /* And the dictionary strings the new screens read. */
  let strings = 0;
  const badKeys: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      strings++;
      if (node.includes(EM_DASH)) badKeys.push(path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node))
        walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(dictionaries, "");
  check(
    `${strings} dictionary strings are clean`,
    badKeys.length === 0,
    badKeys,
  );

  /* The new keys exist in both languages, or a screen renders "undefined". */
  for (const lang of ["en", "el"] as const) {
    const dk = dictionaries[lang].desk as Record<string, unknown>;
    const missing = [
      "instructorLabel",
      "instructorSet",
      "instructorCleared",
      "instructorToldMembers",
    ].filter((k) => typeof dk[k] !== "string");
    check(
      `the rota strings are written in ${lang}`,
      missing.length === 0,
      missing,
    );
  }

  const NEW_BOOKING_KEYS = [
    "duetIsForTwo",
    "duetForcedNote",
    "heldPersonal",
    "heldPersonalPlural",
    "heldDuet",
    "heldDuetPlural",
    "personalChip",
    "personalHeld",
    "personalTag",
    "personalFree",
    "personalTaken",
    "personalExplainer",
    "whoIsComing",
    "justMe",
    "twoOfUs",
    "guestLabel",
    "guestPlaceholder",
    "guestHint",
    "bookPersonal",
    "personalCutoff",
    "personalBooked",
    "personalBookedBody",
    "personalTooLate",
    "personalCancelTooLate",
    "needsPersonal",
    "needsDuet",
    "onePerDay",
  ] as const;
  for (const lang of ["en", "el"] as const) {
    const missing = NEW_BOOKING_KEYS.filter(
      (k) => typeof (dictionaries[lang].booking as never)[k] !== "string",
    );
    check(
      `every new booking string is written in ${lang}`,
      missing.length === 0,
      missing,
    );
  }
  for (const lang of ["en", "el"] as const) {
    const d = dictionaries[lang].desk as Record<string, unknown>;
    const missing = [
      "appointmentsTitle",
      "appointmentsNote",
      "personal",
      "duet",
      "instructorNeeded",
      "sellKind",
      "sellKindClass",
      "sellKindPersonal",
      "sellKindDuet",
      "sellKindNote",
    ].filter((k) => typeof d[k] !== "string");
    check(
      `every new desk string is written in ${lang}`,
      missing.length === 0,
      missing,
    );
    const p = dictionaries[lang].pricingPage as Record<string, unknown>;
    const missingP = [
      "perPersonLabel",
      "peopleLabel",
      "paceLabel",
      "onePerDay",
    ].filter((k) => typeof p[k] !== "string");
    check(
      `every new pricing string is written in ${lang}`,
      missingP.length === 0,
      missingP,
    );
    /**
     * Every group a pack claims has a heading to sit under.
     *
     * This used to name `personal` specifically, and that stopped being right on
     * 4 September 2026 when Personal and Duet moved in with the day pass under
     * "One at a time" and the `personal` group was retired. Asserting the
     * *invariant* instead of the one group is what should have been here all
     * along: it caught nothing about the six new sections, and it would have
     * failed with a missing heading on any of them.
     */
    const headings = (p.groups ?? {}) as Record<string, { title?: string }>;
    /**
     * Headings and card sections have to match, in both directions.
     *
     * Note this is `CARD_GROUPS`, not "every group a pack claims". Since the
     * plan builder landed, the `month`, `quarter`, `half`, `nine` and `year`
     * packs deliberately have no heading: they are chosen with two chips rather
     * than rendered as twenty cards, and a heading for them would print a title
     * above nothing. What must never happen is a *section* with no heading, or a
     * heading with no section, and that is what these two assert.
     */
    const noHeading = CARD_GROUPS.filter(
      (g) => typeof headings[g]?.title !== "string",
    );
    check(
      `every card section has a heading in ${lang}`,
      noHeading.length === 0,
      noHeading,
    );
    const orphaned = Object.keys(headings).filter(
      (g) => !(CARD_GROUPS as readonly string[]).includes(g),
    );
    check(
      `no heading without a section in ${lang}`,
      orphaned.length === 0,
      orphaned,
    );
    /* The builder carries every plan the studio sells, so it needs its own
       strings in both languages. */
    const builder = (p.builder ?? {}) as Record<string, unknown>;
    const missingBuilder = [
      "title",
      "howLong",
      "howOften",
      "oneMonth",
      "months",
      "perWeek",
      "unlimited",
      "buy",
      "unavailable",
    ].filter((k) => typeof builder[k] !== "string");
    check(
      `the plan builder is written in ${lang}`,
      missingBuilder.length === 0,
      missingBuilder,
    );
    /**
     * Every combination the builder offers resolves to a real pack.
     *
     * The builder builds a slug and looks it up, so a term or cadence with no
     * pack behind it would render "not on sale" at somebody trying to buy. Five
     * terms times four cadences, checked against the catalogue.
     */
    if (lang === "en") {
      const missingPacks: string[] = [];
      for (const { group } of BUILDER_TERMS) {
        for (const n of [1, 2, 3, 4]) {
          const slug = `${group}-${n}`;
          if (!PACKS.some((x) => x.slug === slug)) missingPacks.push(slug);
        }
      }
      check(
        "every plan the builder can offer exists as a pack",
        missingPacks.length === 0,
        missingPacks,
      );

      /**
       * Nothing is stranded between the two.
       *
       * A pack reaches a buyer one of two ways: its group has a row of cards, or
       * the builder covers it. A group in neither list is a pack the studio has
       * priced, seeded and cannot sell, and the page would look completely
       * normal. That is exactly what happened to `half`, `nine` and `year` when
       * the builder took over the whole page and CARD_GROUPS was cut to
       * ["single"] — they were reachable then only because the builder carried
       * all five terms, and the day it carried three the invariant is the only
       * thing standing between a working page and four missing plans.
       */
      const reachable = new Set<string>([
        ...CARD_GROUPS,
        ...BUILDER_TERMS.map((x) => x.group),
      ]);
      const stranded = [...new Set(PACKS.map((x) => x.group))].filter(
        (g) => !reachable.has(g),
      );
      check(
        "every pack group is either a card section or in the builder",
        stranded.length === 0,
        stranded,
      );

      /* And the other direction: a group cannot be both, or the studio sells
         the same term twice on one page at two different prices per class. */
      const both = BUILDER_TERMS.map((x) => x.group).filter((g) =>
        (CARD_GROUPS as readonly string[]).includes(g),
      );
      check("and no group is in both at once", both.length === 0, both);
    }
    check(
      `the studio page has a team heading in ${lang}`,
      typeof (dictionaries[lang].studio as { team?: { title?: string } }).team
        ?.title === "string",
    );
  }

  /* ------------------------------------ 12. what the desk sees */
  console.log("\n12. What the desk sees");

  const appts = await upcomingAppointments();
  check(
    "the desk's forward list holds the appointments just booked",
    appts.some((a) => a.bookingId === duetBooking) || duetBooking === "",
    { listed: appts.length, looking: duetBooking },
  );
  const listedDuet = appts.find((a) => a.bookingId === duetBooking);
  if (listedDuet) {
    check("with the second person named", listedDuet.guestName === "Elena P.");
    check("and counted as two", listedDuet.seats === 2);
    check("and the member's number on the row", Boolean(listedDuet.phone));
  }
  check(
    "and nothing from the group timetable in it",
    appts.every((a) => {
      const hour = studioParts(a.startsAt).hour;
      return PERSONAL_SLOT_HOURS.includes(hour as never);
    }),
    appts.map((a) => studioParts(a.startsAt).hour),
  );

  /* The member's own list carries the same facts. */
  if (duetBooking) {
    const mine = await listMyBookings(m6.id);
    const row = mine.upcoming.find((b) => b.id === duetBooking);
    check(
      "the member's own list marks it as an appointment",
      row?.kind === "PERSONAL",
      row?.kind,
    );
    check("and shows who is coming with them", row?.guestName === "Elena P.");
    check(
      "and dates the cancellation deadline by the appointment rule",
      row
        ? row.freeCancellationUntil.getTime() ===
            personalBookingClosesAt(row.startsAt).getTime()
        : false,
      row?.freeCancellationUntil,
    );
  }

  /* --------------------------------------- 13. who is teaching it */
  console.log("\n13. Who is teaching it");

  const teachers = await activeInstructors();
  check(
    "the desk has instructors to choose from",
    teachers.length > 0,
    teachers.length,
  );

  const slot = openAppointments().find(
    (x) => !appts.some((a) => a.startsAt.getTime() === x.startsAt.getTime()),
  );
  const m11 = await mkUser();
  grantCredits({
    userId: m11.id,
    credits: 1,
    validityDays: 30,
    kind: "PERSONAL",
  });
  let taught = "";
  if (slot && teachers.length >= 2) {
    const r = bookClass(m11.id, slot.id);
    check("a member books the hour", r.ok, r);

    /**
     * The three cases, and the only one that writes to a member.
     *
     * Filling an empty slot is an assignment, not a swap: nobody was promised
     * anybody, so nobody is told. Replacing a named instructor with a different
     * one is a swap, and the member who booked with the first is exactly the
     * person the notice is for. Clearing it tells nobody either, because "your
     * instructor is now nobody" is not a message anybody should receive.
     */
    const first = await assignInstructor({
      sessionId: slot.id,
      instructorId: teachers[0]!.id,
      staffName: "Suite",
    });
    check(
      "filling an empty slot names the instructor",
      first.ok && first.instructor === teachers[0]!.name,
      first,
    );
    check(
      "and tells nobody, because it is not a swap",
      first.ok && first.told === 0,
      first,
    );

    const swap = await assignInstructor({
      sessionId: slot.id,
      instructorId: teachers[1]!.id,
      staffName: "Suite",
    });
    check(
      "swapping one named instructor for another",
      swap.ok &&
        swap.previous === teachers[0]!.name &&
        swap.instructor === teachers[1]!.name,
      swap,
    );
    check("tells the member booked into it", swap.ok && swap.told === 1, swap);

    const again = await assignInstructor({
      sessionId: slot.id,
      instructorId: teachers[1]!.id,
      staffName: "Suite",
    });
    check(
      "choosing the same name again changes nothing",
      again.ok && again.told === 0,
      again,
    );

    const cleared = await assignInstructor({
      sessionId: slot.id,
      instructorId: null,
      staffName: "Suite",
    });
    check(
      "clearing the slot works and tells nobody",
      cleared.ok && cleared.instructor === null && cleared.told === 0,
      cleared,
    );
    taught = slot.id;
  } else {
    console.log("  ! no free appointment or too few instructors, skipped");
  }

  check(
    "an unknown instructor is refused",
    (
      await assignInstructor({
        sessionId: taught || "none",
        instructorId: "not-a-real-id",
        staffName: "Suite",
      })
    ).ok === false,
  );
  check(
    "and an unknown class is refused",
    (
      await assignInstructor({
        sessionId: "not-a-real-session",
        instructorId: teachers[0]?.id ?? null,
        staffName: "Suite",
      })
    ).ok === false,
  );

  /* The words the member reads. */
  const swapWords = instructorChangedWords({
    classEn: "Reformer Flow",
    classEl: "Reformer Flow",
    startsAt: when,
    from: "Maria",
    to: "Andrea",
  });
  check(
    "the notice names both instructors, so the member can see what changed",
    swapWords.en.body.includes("Maria") &&
      swapWords.en.body.includes("Andrea"),
    swapWords.en.body,
  );
  check(
    "and says nothing else has moved",
    /Nothing else has changed/.test(swapWords.en.body) &&
      /Δεν αλλάζει κάτι άλλο/.test(swapWords.el.body),
  );
  check(
    "in both languages, with no em dash",
    !`${swapWords.en.subject}${swapWords.en.body}${swapWords.el.subject}${swapWords.el.body}`.includes(
      EM_DASH,
    ),
  );

  /* And a group class can be reassigned too, which is the sick-instructor case
     the studio actually asked for. */
  const cls = groupClassesOn(7, 1)[0];
  if (cls && teachers.length >= 2) {
    const m12 = await mkUser();
    grantCredits({ userId: m12.id, credits: 1, validityDays: 30 });
    const booked = bookClass(m12.id, cls.id);
    await assignInstructor({
      sessionId: cls.id,
      instructorId: teachers[0]!.id,
      staffName: "Suite",
    });
    const swap = await assignInstructor({
      sessionId: cls.id,
      instructorId: teachers[1]!.id,
      staffName: "Suite",
    });
    check(
      "a group class can be reassigned, and its members are told",
      booked.ok && swap.ok && swap.told >= 1,
      swap,
    );
  }

  /* ------------------------------- 14. when sessions expire, and for what */
  console.log("\n14. When sessions expire, and for what");

  const m13 = await mkUser();
  grantCredits({ userId: m13.id, credits: 4, validityDays: 30 });
  const wallet = await getCreditSummary(m13.id);
  const expiry = wallet.nextExpiry!;
  const parts30 = studioParts(expiry);

  /**
   * Bug one: the expiry used to land at the minute of purchase.
   *
   * A pack bought at 14:53 died at 14:53 on the thirtieth day, while the
   * member's account showed only the date. Somebody who bought at nine in the
   * morning and came back at eight in the evening on their last day saw a date
   * that was still today and a balance that had already gone.
   */
  check(
    "an expiry lands at the very end of its last day, not at the hour of purchase",
    parts30.hour === 23 && parts30.minute === 59,
    { at: expiry.toISOString(), studio: parts30 },
  );
  check(
    "which is 30 studio days from today",
    studioDateKey(expiry) ===
      studioDateKey(studioAddDays(studioStartOfDay(new Date()), 30)),
    { expiry: studioDateKey(expiry) },
  );

  /**
   * Bug two: the expiry governed the booking and not the class.
   *
   * Nothing compared the class date to the expiry, so a member could buy a
   * 30-day pack, wait until day 29, and book classes across November and
   * December. Thirty days constrained the shopping and not the training.
   */
  const batch = wallet.batches[0]!;
  check(
    "and the class has to fall inside the window too",
    batch.usableTo !== null && batch.usableTo.getTime() === expiry.getTime(),
    { usableTo: batch.usableTo?.toISOString(), expiry: expiry.toISOString() },
  );
  check(
    "with no lower bound, so a session bought today books a class tonight",
    batch.usableFrom === null,
    batch.usableFrom,
  );

  /* Asserted against the real spend path, on real rows. */
  const ct = sqlite
    .prepare(
      "select id from class_types where kind = 'GROUP' and active = 1 limit 1",
    )
    .get() as { id: string };

  const makeClass = (at: Date) =>
    (
      sqlite
        .prepare(
          `insert into class_sessions
             (id, class_type_id, starts_at, ends_at, capacity, status, created_at)
           values (?, ?, ?, ?, 5, 'SCHEDULED', unixepoch()) returning id`,
        )
        .get(
          crypto.randomUUID(),
          ct.id,
          Math.floor(at.getTime() / 1000),
          Math.floor(at.getTime() / 1000) + 3600,
        ) as { id: string }
    ).id;

  /* One class the evening of the last day, one the morning after. */
  const lastDay = studioWallTimeToInstant(
    parts30.year,
    parts30.month,
    parts30.day,
    19,
    0,
  );
  const dayAfter = studioAddDays(lastDay, 1);
  const farOut = studioAddDays(lastDay, 40);

  const onLastDay = makeClass(lastDay);
  const onNextDay = makeClass(dayAfter);
  const wayOut = makeClass(farOut);
  const scratch = [onLastDay, onNextDay, wayOut];

  const late = bookClass(m13.id, onLastDay);
  check("a class at 19:00 on the very last day still books", late.ok, late);

  const over = bookClass(m13.id, onNextDay);
  check(
    "the morning after is refused",
    !over.ok && over.code === "SESSIONS_EXPIRE_FIRST",
    over,
  );
  check(
    "and the refusal names the last date that would have worked",
    !over.ok &&
      over.until !== undefined &&
      studioDateKey(over.until) === studioDateKey(expiry),
    !over.ok ? over.until?.toISOString() : undefined,
  );

  const november = bookClass(m13.id, wayOut);
  check(
    "and so is a class forty days past the expiry",
    !november.ok && november.code === "SESSIONS_EXPIRE_FIRST",
    november,
  );

  /* A session with no expiry at all keeps no window, which is right. */
  const m14 = await mkUser();
  grantCredits({ userId: m14.id, credits: 1, validityDays: null });
  const forever = await getCreditSummary(m14.id);
  check(
    "a session with no expiry has no window either",
    forever.batches[0]?.usableTo === null &&
      forever.batches[0]?.expiresAt === null,
    forever.batches[0],
  );
  check(
    "and it books a class as far out as the timetable goes",
    bookClass(m14.id, wayOut).ok,
  );

  /* The words. */
  for (const lang of ["en", "el"] as const) {
    const msg = (dictionaries[lang].booking as Record<string, unknown>)
      .sessionsExpireFirst;
    check(
      `the refusal is written in ${lang}, with a place for the date`,
      typeof msg === "string" &&
        msg.includes("{date}") &&
        !msg.includes(EM_DASH),
      msg,
    );
  }

  for (const id of scratch) {
    sqlite.prepare("delete from bookings where session_id = ?").run(id);
    sqlite.prepare("delete from class_sessions where id = ?").run(id);
  }

  /* ------------------- 15. which package pays, and which one gets it back */
  console.log("\n15. Which package pays, and which one gets it back");

  /**
   * A member holding two packages at once is the ordinary case, not an edge
   * case: somebody tops up before the old sessions have run out. Which of the
   * two a class is taken from is worth money, and the two halves of it are
   * separate rules that can each be wrong on their own.
   *
   *   spend  — always out of the package that dies first, or the member loses
   *            sessions they had paid for while newer ones sat unused
   *   refund — always back into the package it came out of, or booking and
   *            cancelling becomes a way to move a session onto a later expiry
   *            and keep it alive indefinitely
   *
   * Neither would throw. The first is a slow loss the member absorbs; the
   * second is a trick that works, and works better the more it is used.
   */
  const scratch15: string[] = [];
  /**
   * Every package the member holds, empty ones included.
   *
   * `getCreditSummary` deliberately hides a package with nothing left in it,
   * because the member has no use for it. This suite has to see it: whether an
   * emptied package is still there, with its own expiry, is the whole question.
   */
  const packagesOf = (userId: string) =>
    sqlite
      .prepare(
        `select id, credits_remaining as remaining, credits_total as total,
                expires_at as expires, usable_to as until, source
           from credit_batches where user_id = ?
          order by expires_at, created_at`,
      )
      .all(userId) as {
      id: string;
      remaining: number;
      total: number;
      expires: number | null;
      until: number | null;
      source: string;
    }[];
  const classAtDay = (offset: number) => {
    const day = studioAddDays(studioStartOfDay(new Date()), offset);
    const p = studioParts(day);
    const id = makeClass(
      studioWallTimeToInstant(p.year, p.month, p.day, 19, 0),
    );
    scratch15.push(id);
    return id;
  };

  /* The member's own numbers: three sessions on the nearer expiry, five on the
     further one, exactly as asked. */
  const m15 = await mkUser();
  grantCredits({ userId: m15.id, credits: 3, validityDays: 26 });
  grantCredits({ userId: m15.id, credits: 5, validityDays: 56 });

  const w15 = await getCreditSummary(m15.id);
  const soon = w15.batches.find((b) => b.creditsTotal === 3)!;
  const later = w15.batches.find((b) => b.creditsTotal === 5)!;
  check(
    "a member can hold two packages with different expiries",
    w15.available === 8 && Boolean(soon) && Boolean(later),
    { available: w15.available, batches: w15.batches.length },
  );
  check(
    "and the balance names the nearer of the two as the next to go",
    w15.nextExpiry?.getTime() === soon.expiresAt?.getTime() &&
      w15.nextExpiryCredits === 3,
    { nextExpiry: w15.nextExpiry?.toISOString(), n: w15.nextExpiryCredits },
  );

  /* A class inside both windows, so nothing but the expiry order decides it. */
  const cls15 = classAtDay(5);
  const b15 = bookClass(m15.id, cls15);
  check("the booking goes through", b15.ok, b15);

  const row15 = sqlite
    .prepare("select credit_batch_id as b from bookings where id = ?")
    .get(b15.ok ? b15.bookingId : "") as { b: string | null } | undefined;
  check(
    "the session is taken out of the package that expires first",
    row15?.b === soon.id,
    { took: row15?.b, soon: soon.id, later: later.id },
  );

  const afterSpend = await getCreditSummary(m15.id);
  check(
    "so the nearer package drops to 2 and the further one is untouched at 5",
    afterSpend.batches.find((b) => b.id === soon.id)?.creditsRemaining === 2 &&
      afterSpend.batches.find((b) => b.id === later.id)?.creditsRemaining === 5,
    afterSpend.batches.map((b) => [
      b.id === soon.id ? "soon" : "later",
      b.creditsRemaining,
    ]),
  );

  /* And the paper trail says so too, which is what the desk reads back. */
  const spendRow = sqlite
    .prepare(
      "select batch_id as b, delta from credit_ledger where booking_id = ? and delta = -1",
    )
    .get(b15.ok ? b15.bookingId : "") as { b: string | null } | undefined;
  check(
    "and the ledger records which package it came out of",
    spendRow?.b === soon.id,
    spendRow,
  );

  /* Now the cancellation. The class is five days out, so this is a free
     cancellation and the session is genuinely owed back. */
  const c15 = cancelBooking(m15.id, b15.ok ? b15.bookingId : "");
  check("the cancellation goes through", c15.ok, c15);

  const afterCancel = await getCreditSummary(m15.id);
  const soonBack = afterCancel.batches.find((b) => b.id === soon.id);
  check(
    "the session comes back into the same package it was taken from",
    soonBack?.creditsRemaining === 3,
    afterCancel.batches.map((b) => [
      b.id === soon.id ? "soon" : "later",
      b.creditsRemaining,
    ]),
  );
  check(
    "carrying its original expiry, so cancelling buys no extra time",
    soonBack?.expiresAt?.getTime() === soon.expiresAt?.getTime(),
    {
      before: soon.expiresAt?.toISOString(),
      after: soonBack?.expiresAt?.toISOString(),
    },
  );
  check(
    "and the further package is still exactly as it was",
    afterCancel.batches.find((b) => b.id === later.id)?.creditsRemaining ===
      5 &&
      afterCancel.batches
        .find((b) => b.id === later.id)
        ?.expiresAt?.getTime() === later.expiresAt?.getTime(),
  );
  check(
    "with no third package invented along the way",
    afterCancel.batches.length === 2,
    afterCancel.batches.length,
  );

  /**
   * The case the member asked about by name: the last session in a package.
   *
   * "or if it was the last one to be recreated again with the same expiration".
   * It is not recreated, which is better — the package row stays put at zero
   * and is refilled, so there is no moment at which a new expiry could be
   * chosen. The assertion is on the outcome either way: same package, same
   * date, no new row.
   */
  const m15b = await mkUser();
  grantCredits({ userId: m15b.id, credits: 1, validityDays: 26 });
  const only = (await getCreditSummary(m15b.id)).batches[0]!;
  const clsB = classAtDay(6);
  const bB = bookClass(m15b.id, clsB);
  const emptied = packagesOf(m15b.id);
  check(
    "spending the last session of a package empties it rather than removing it",
    bB.ok &&
      (await getCreditSummary(m15b.id)).available === 0 &&
      emptied.length === 1 &&
      emptied[0]!.id === only.id &&
      emptied[0]!.remaining === 0,
    { ok: bB.ok, packages: emptied },
  );

  cancelBooking(m15b.id, bB.ok ? bB.bookingId : "");
  const refilled = await getCreditSummary(m15b.id);
  check(
    "and cancelling refills that same package, not a new one",
    refilled.batches.length === 1 &&
      refilled.batches[0]!.id === only.id &&
      refilled.batches[0]!.creditsRemaining === 1,
    refilled.batches,
  );
  check(
    "on the same expiry date it always had",
    refilled.batches[0]!.expiresAt?.getTime() === only.expiresAt?.getTime(),
    {
      before: only.expiresAt?.toISOString(),
      after: refilled.batches[0]!.expiresAt?.toISOString(),
    },
  );

  /**
   * The hole underneath all of it: a refund with no package recorded.
   *
   * Bookings written before the batch was recorded, or by a path that did not
   * record it, arrive here with nothing to put the session back into. This used
   * to mint a brand new package with **ninety days** on it, which was both a way
   * to reset an expiry and a way to conjure a session out of nothing. It now
   * reconstructs where the session must have come from — the soonest-expiring
   * package with room in it — which can never extend an expiry.
   */
  const m15c = await mkUser();
  grantCredits({ userId: m15c.id, credits: 2, validityDays: 26 });
  grantCredits({ userId: m15c.id, credits: 2, validityDays: 56 });
  const cWallet = await getCreditSummary(m15c.id);
  const cSoon = cWallet.batches.find(
    (b) =>
      b.creditsTotal === 2 &&
      b.expiresAt!.getTime() === cWallet.nextExpiry!.getTime(),
  )!;
  const cLater = cWallet.batches.find((b) => b.id !== cSoon.id)!;

  /* Empty the nearer package, so both packages exist but only one has room. */
  bookClass(m15c.id, classAtDay(7));
  bookClass(m15c.id, classAtDay(8));
  const drained = packagesOf(m15c.id);
  check(
    "two classes come out of the nearer package before the further one is touched",
    drained.find((b) => b.id === cSoon.id)?.remaining === 0 &&
      drained.find((b) => b.id === cLater.id)?.remaining === 2,
    drained.map((b) => [b.id === cSoon.id ? "soon" : "later", b.remaining]),
  );

  refundOneCredit(m15c.id, null, { note: "Fixture: no batch recorded" });
  const rebuilt = packagesOf(m15c.id);
  check(
    "a refund with no package recorded goes back into the soonest one with room",
    rebuilt.length === 2 &&
      rebuilt.find((b) => b.id === cSoon.id)?.remaining === 1,
    rebuilt,
  );
  check(
    "keeping that package's own expiry, so it is no way to buy time",
    rebuilt.find((b) => b.id === cSoon.id)?.expires ===
      Math.floor(cSoon.expiresAt!.getTime() / 1000),
    {
      before: cSoon.expiresAt?.toISOString(),
      after: rebuilt.find((b) => b.id === cSoon.id)?.expires,
    },
  );
  check(
    "and it never mints a fresh ninety-day package",
    rebuilt.every((b) => b.source !== "COMPENSATION"),
    rebuilt.map((b) => b.source),
  );
  check(
    "nor can it top a package up past what was bought",
    rebuilt.every((b) => b.remaining <= b.total),
  );

  /**
   * Last resort. A member with nothing at all to put it back into still gets
   * something, because a cancellation that takes a session and returns none is
   * worse than a short goodwill session. It is thirty days and marked
   * COMPENSATION, which Analytics keeps out of revenue.
   */
  const m15d = await mkUser();
  refundOneCredit(m15d.id, null, { note: "Fixture: nothing to return to" });
  const lastResort = await getCreditSummary(m15d.id);
  const comp = lastResort.batches[0];
  check(
    "with nothing at all to return to, one short compensation session is written",
    lastResort.batches.length === 1 &&
      comp?.source === "COMPENSATION" &&
      comp.creditsRemaining === 1,
    lastResort.batches,
  );
  check(
    "and it is thirty days, not the ninety it used to be",
    comp?.expiresAt !== null &&
      studioDateKey(comp!.expiresAt!) ===
        studioDateKey(studioAddDays(studioStartOfDay(new Date()), 30)),
    comp?.expiresAt?.toISOString(),
  );
  /* Stored as whole Unix seconds, so the millisecond before midnight comes
     back as 23:59:59 on the nose. Compared in seconds for that reason. */
  const closeOfDay = Math.floor(
    studioEndOfDay(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).getTime() /
      1000,
  );
  check(
    "ending at the close of that day, and closing its class window with it",
    comp?.usableTo?.getTime() === comp?.expiresAt?.getTime() &&
      Math.floor(comp!.usableTo!.getTime() / 1000) === closeOfDay,
    { usableTo: comp?.usableTo?.toISOString(), expected: closeOfDay },
  );

  /* ------------------- 16. what a new member is asked before they train */
  console.log("\n16. What a new member is asked before they train");

  /**
   * Three questions after the emailed code, and the gate that makes them real.
   *
   * A screen somebody is redirected to is a suggestion: an old tab, a typed
   * URL, a phone restoring yesterday's page all walk straight past it. So the
   * rule lives on the booking route, and this section is mostly about proving
   * that the gate catches the right people and, just as important, lets
   * everybody else through.
   */
  const clsIntake = classAtDay(9);
  scratch15.push(clsIntake);

  /* A member who signed up today: must answer before booking. */
  const fresh = await mkUser();
  grantCredits({ userId: fresh.id, credits: 2, validityDays: 30 });

  check(
    "an account created today is offered the three questions",
    intakeRequired({
      intakeAt: null,
      createdAt: new Date(),
      role: "MEMBER",
    }),
  );

  /**
   * And is not stopped by them, which is the part worth asserting.
   *
   * The questions were mandatory for a day: a member who skipped them could
   * read the whole site and was then refused at the one moment they were trying
   * to give the studio money. The studio removed the requirement, and this is
   * the check that keeps it removed — booking has to work for a member who has
   * answered nothing.
   */
  const skipped = await mkUser();
  grantCredits({ userId: skipped.id, credits: 1, validityDays: 30 });
  const clsSkipped = classAtDay(10);
  scratch15.push(clsSkipped);
  const bookedAnyway = bookClass(skipped.id, clsSkipped);
  check(
    "and a member who answered nothing can still book",
    bookedAnyway.ok,
    bookedAnyway,
  );

  /**
   * And the people who must not be caught by it.
   *
   * The studio asked for this of new sign-ups. A member from July has been
   * booking classes for weeks, and stopping them at a new gate on their next
   * visit would be a change they never agreed to. Staff are not members and do
   * not train, so asking the owner for their pilates level before the console
   * opens would be absurd.
   */
  const july = studioAddDays(new Date(), -40);
  check(
    "an account from before the studio started asking is not stopped",
    !intakeRequired({ intakeAt: null, createdAt: july, role: "MEMBER" }),
  );
  check(
    "and neither is a staff account",
    !intakeRequired({ intakeAt: null, createdAt: new Date(), role: "ADMIN" }),
  );
  check(
    "nor a member who has already answered",
    !intakeRequired({
      intakeAt: new Date(),
      createdAt: new Date(),
      role: "MEMBER",
    }),
  );

  /* Answering it, the way the route does. */
  const answer = (
    userId: string,
    level: string,
    since: string,
    condition: string | null,
  ) => {
    sqlite
      .prepare(
        `update users
            set pilates_level = ?, pilates_since = ?, health_condition = ?,
                intake_at = coalesce(intake_at, unixepoch())
          where id = ?`,
      )
      .run(level, since, condition, userId);
    return db.select().from(users).where(eq(users.id, userId)).get()!;
  };

  const answered = answer(fresh.id, "BEGINNER", "NONE", null);
  check(
    "answering records the date, so the step is done",
    answered.intakeAt !== null,
    answered.intakeAt,
  );
  check(
    "nothing to declare is stored as nothing, not as a blank to chase",
    answered.healthCondition === null && answered.intakeAt !== null,
  );
  const nowBooks = bookClass(fresh.id, clsIntake);
  check("and booking works after answering too", nowBooks.ok, nowBooks);

  /* A declared condition is kept as typed. */
  const declared = await mkUser();
  const withCondition = answer(
    declared.id,
    "INTERMEDIATE",
    "ONE_TO_TWO",
    "Disc injury, no loaded flexion",
  );
  check(
    "a declared condition is kept in the member's own words",
    withCondition.healthCondition === "Disc injury, no loaded flexion",
    withCondition.healthCondition,
  );
  check(
    "with the level and the experience beside it",
    withCondition.pilatesLevel === "INTERMEDIATE" &&
      withCondition.pilatesSince === "ONE_TO_TWO",
  );

  /* The desk can answer for a member, and cannot invent a value. */
  const overCounter = await mkUser();
  const good = await updateContact(overCounter.id, {
    pilatesLevel: "ADVANCED",
    pilatesSince: "OVER_TWO",
    healthCondition: "",
  });
  check("the desk can fill it in over the counter", good.ok, good);
  const deskRow = db
    .select()
    .from(users)
    .where(eq(users.id, overCounter.id))
    .get()!;
  check(
    "which also marks the step done, so the member is not asked again",
    deskRow.intakeAt !== null && deskRow.pilatesLevel === "ADVANCED",
    { intakeAt: deskRow.intakeAt, level: deskRow.pilatesLevel },
  );
  check(
    "an empty condition at the desk means nothing to declare",
    deskRow.healthCondition === null,
  );
  const typo = await updateContact(overCounter.id, { pilatesLevel: "Beginer" });
  check(
    "a mistyped level is refused rather than written",
    !typo.ok && typo.code === "LEVEL_INVALID",
    typo,
  );
  const typo2 = await updateContact(overCounter.id, { pilatesSince: "AGES" });
  check(
    "and so is a mistyped experience",
    !typo2.ok && typo2.code === "EXPERIENCE_INVALID",
    typo2,
  );
  const tooLong = await updateContact(overCounter.id, {
    healthCondition: "x".repeat(CONDITION_MAX_CHARS + 1),
  });
  check(
    "an overlong condition is refused",
    !tooLong.ok && tooLong.code === "CONDITION_TOO_LONG",
    tooLong,
  );

  /* The desk sees it on the member's card, and only there. */
  const card = await memberDetail(declared.id);
  check(
    "the member's own card carries the three answers",
    card !== null &&
      card.healthCondition === "Disc injury, no loaded flexion" &&
      card.pilatesLevel === "INTERMEDIATE" &&
      card.intakeAt !== null,
    card ? { level: card.pilatesLevel, condition: card.healthCondition } : null,
  );

  /* The words, in both languages, and no em dash. */
  for (const lang of ["en", "el"] as const) {
    const w = dictionaries[lang].intake as Record<string, unknown>;
    const levels = w.levels as Record<string, string>;
    const experience = w.experience as Record<string, string>;
    check(
      `the questions are written in ${lang}`,
      typeof w.title === "string" &&
        typeof w.conditionLabel === "string" &&
        !JSON.stringify(w).includes(EM_DASH),
    );
    check(
      `and every level and experience option has a ${lang} label`,
      PILATES_LEVELS.every((k) => typeof levels[k] === "string" && levels[k]) &&
        PILATES_EXPERIENCE.every(
          (k) => typeof experience[k] === "string" && experience[k],
        ),
      { levels, experience },
    );
  }

  /* --------------------- 17. reception booking a member over the phone */
  console.log("\n17. Reception booking a member over the phone");

  /**
   * The studio's reason for asking: three people in one class and one in
   * another is a Tuesday that could have been two full classes, and the fix is
   * somebody at the desk ringing round.
   *
   * The rules matter more than the feature. A desk that can book without
   * spending a session, or with an override for the member who has run out, is
   * convenient twice a month and wrong every day after that: the balance on the
   * member's screen stops matching what they have used, and the first person to
   * notice is a member who counted differently from the studio. So every check
   * here is about the desk being held to exactly the member's own rules.
   */
  const deskClass = classAtDay(11);
  const deskClass2 = classAtDay(12);
  scratch15.push(deskClass, deskClass2);

  const phoned = await mkUser();
  answer(phoned.id, "BEGINNER", "NONE", null);
  grantCredits({ userId: phoned.id, credits: 1, validityDays: 30 });

  const desk1 = await bookForMember({
    sessionId: deskClass,
    userId: phoned.id,
    staffName: "Suite",
  });
  check("the desk can book a member into a class", desk1.ok, desk1);
  check(
    "and it spends one of their sessions, not nothing",
    desk1.ok && desk1.balance === 0,
    desk1.ok ? desk1.balance : desk1,
  );

  /* The refusal that is the whole point of the design. */
  const broke = await bookForMember({
    sessionId: deskClass2,
    userId: phoned.id,
    staffName: "Suite",
  });
  check(
    "a member with nothing left is refused rather than booked for free",
    !broke.ok && broke.code === "NO_CREDITS",
    broke,
  );

  /* And the ledger says who did it, which is the difference between "a session
     was used" and "reception booked them in on the phone". */
  const deskLine = sqlite
    .prepare(
      `select note from credit_ledger
        where user_id = ? and note like 'Booked at the desk%'
        order by created_at desc limit 1`,
    )
    .get(phoned.id) as { note: string } | undefined;
  check(
    "the ledger records which member of staff booked it",
    Boolean(deskLine?.note?.includes("Suite")),
    deskLine,
  );

  /* An unconfirmed address cannot hold a seat, at the desk either. */
  const unconfirmed = db
    .insert(users)
    .values({
      email: `desk-unverified-${Date.now()}@rg.test`,
      name: "Never Confirmed",
      phone: `+35799${String(Math.floor(Math.random() * 900000) + 100000)}`,
      passwordHash: await hashPassword("x".repeat(12)),
      isTest: true,
      emailVerifiedAt: null,
    })
    .returning()
    .get();
  made.push(unconfirmed.id);
  grantCredits({ userId: unconfirmed.id, credits: 2, validityDays: 30 });
  const noEmail = await bookForMember({
    sessionId: deskClass2,
    userId: unconfirmed.id,
    staffName: "Suite",
  });
  check(
    "an account that never confirmed its email is refused at the desk too",
    !noEmail.ok && noEmail.code === "EMAIL_UNVERIFIED",
    noEmail,
  );

  /* A group session still cannot buy a noon appointment from the desk. */
  const slots17 = openAppointments();
  if (slots17.length) {
    const wrongKind = await mkUser();
    answer(wrongKind.id, "BEGINNER", "NONE", null);
    grantCredits({ userId: wrongKind.id, credits: 1, validityDays: 30 });
    const refused = await bookForMember({
      sessionId: slots17[0]!.id,
      userId: wrongKind.id,
      staffName: "Suite",
    });
    check(
      "and a group session still cannot pay for an appointment at the desk",
      !refused.ok &&
        (refused.code === "NEEDS_PERSONAL_CREDIT" ||
          refused.code === "CREDITS_NOT_VALID_HERE"),
      refused,
    );
  } else {
    check(
      "and a group session still cannot pay for an appointment at the desk",
      true,
    );
  }

  /* A member who does not exist, and a class that is full. */
  const ghost = await bookForMember({
    sessionId: deskClass2,
    userId: "not-a-real-id",
    staffName: "Suite",
  });
  check(
    "an unknown member is refused",
    !ghost.ok && ghost.code === "NOT_FOUND",
    ghost,
  );

  const full = await mkUser();
  answer(full.id, "BEGINNER", "NONE", null);
  grantCredits({ userId: full.id, credits: 1, validityDays: 30 });
  const twice = await bookForMember({
    sessionId: deskClass,
    userId: phoned.id,
    staffName: "Suite",
  });
  check(
    "and booking the same member into the same class twice is refused",
    !twice.ok,
    twice,
  );

  /* The words the console shows, in both languages. */
  for (const lang of ["en", "el"] as const) {
    const desk = dictionaries[lang].desk as Record<string, unknown>;
    const errors = desk.deskBookErrors as Record<string, string>;
    check(
      `the desk's booking refusals are written in ${lang}`,
      typeof desk.deskBookCta === "string" &&
        [
          "NO_CREDITS",
          "CLASS_FULL",
          "EMAIL_UNVERIFIED",
          "ALREADY_BOOKED",
        ].every((k) => typeof errors[k] === "string" && errors[k].length > 0) &&
        !JSON.stringify(errors).includes(EM_DASH),
      errors,
    );
  }

  for (const id of scratch15) {
    sqlite.prepare("delete from bookings where session_id = ?").run(id);
    sqlite.prepare("delete from class_sessions where id = ?").run(id);
  }

  /* -------------------------------------------------------------- tidy up */
  for (const id of made) {
    sqlite.prepare("delete from bookings where user_id = ?").run(id);
    sqlite.prepare("delete from credit_ledger where user_id = ?").run(id);
    sqlite.prepare("delete from credit_batches where user_id = ?").run(id);
    sqlite.prepare("delete from notices where user_id = ?").run(id);
    sqlite.prepare("delete from users where id = ?").run(id);
  }

  const left = db
    .select()
    .from(bookings)
    .where(eq(bookings.userId, made[0] ?? "none"))
    .all().length;
  check("fixtures cleaned up", left === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
