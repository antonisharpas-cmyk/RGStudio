/**
 * Seed script — `npm run db:seed`
 *
 * Creates the class catalogue, credit packs, instructors, the weekly timetable
 * templates (taken from the studio's published hours) and 6 weeks of bookable
 * sessions. Also creates the two desk accounts and a demo member so you can click through
 * the whole booking flow immediately.
 *
 * Safe to re-run: it upserts by slug/email and never duplicates sessions.
 *
 * NOTE: instructor names and bios are placeholders — replace them with the real
 * studio team before going live.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { repairCatalogue } from "@/lib/catalogue-repair";
import { PACKS } from "@/lib/packs";
import { INSTRUCTOR_ROSTER, reconcileRoster } from "@/lib/roster";
import { WEEKLY_SCHEDULE } from "@/lib/rota";
import { REMINDER_DEFAULT_MINUTES } from "@/lib/profile";
import { STUDIO } from "@/lib/studio";
import { db, sqlite } from "./index";
import {
  classTemplates,
  classTypes,
  creditPackages,
  users,
} from "./schema";

/* ------------------------------------------------------------------ helpers */

const hash = (p: string) => bcrypt.hashSync(p, 11);

function upsertUser(row: {
  email: string;
  name: string;
  password: string;
  role: string;
  phone?: string;
}) {
  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, row.email))
    .get();
  if (existing) {
    db.update(users)
      .set({
        name: row.name,
        role: row.role,
        phone: row.phone,
        /* Seeded accounts predate the consent and reminder columns, so give
           them the same starting point a new member gets. Only fills what is
           missing: a real member's own choices are never overwritten. */
        serviceOptInAt: existing.serviceOptInAt ?? new Date(),
        reminderMinutes: existing.reminderMinutes ?? REMINDER_DEFAULT_MINUTES,
        /* Seeded accounts are verified by definition: the person who created
           them was sitting at this machine typing the command, and there is no
           mailbox in that story to send a code to. Only filled if missing, so a
           member who verified for themselves keeps their own date. */
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
      })
      .where(eq(users.id, existing.id))
      .run();
    return db.select().from(users).where(eq(users.id, existing.id)).get()!;
  }
  return db
    .insert(users)
    .values({
      email: row.email,
      name: row.name,
      phone: row.phone,
      role: row.role,
      passwordHash: hash(row.password),
      serviceOptInAt: new Date(),
      notifyEmail: true,
      reminderMinutes: REMINDER_DEFAULT_MINUTES,
      emailVerifiedAt: new Date(),
    })
    .returning()
    .get();
}

/* ------------------------------------------------------------- class types */

const CLASS_TYPES = [
  {
    slug: "foundations",
    nameEn: "Reformer Foundations",
    nameEl: "Reformer Foundations",
    descEn:
      "Your entry point. A full sixty minute class at an introductory pace: spring settings, footbar, straps and the six core positions explained before you load them. Leave knowing exactly what your body is doing.",
    descEl:
      "Το σημείο εκκίνησης. Πλήρες μάθημα 60 λεπτών σε εισαγωγικό ρυθμό: ρυθμίσεις ελατηρίων, μπάρα ποδιών, λουριά και οι έξι βασικές θέσεις, εξηγημένες πριν προστεθεί φορτίο. Φεύγεις γνωρίζοντας τι κάνει το σώμα σου.",
    level: "BEGINNER",
    intensity: 1,
    focusEn: "Technique · Alignment · Confidence",
    focusEl: "Τεχνική · Ευθυγράμμιση · Αυτοπεποίθηση",
    sortOrder: 1,
  },
  {
    slug: "flow",
    nameEn: "Reformer Flow",
    nameEl: "Reformer Flow",
    descEn:
      "The classic. Continuous sequences, led by the breath, that move through the whole body with controlled spring resistance. Suitable for anyone comfortable with the basics.",
    descEl:
      "Το κλασικό. Συνεχείς ακολουθίες με οδηγό την αναπνοή, που κινούν όλο το σώμα με ελεγχόμενη αντίσταση ελατηρίων. Κατάλληλο για όποιον έχει τα βασικά.",
    level: "ALL",
    intensity: 2,
    focusEn: "Core · Mobility · Control",
    focusEl: "Κορμός · Κινητικότητα · Έλεγχος",
    sortOrder: 2,
  },
  {
    slug: "sculpt",
    nameEn: "Reformer Sculpt",
    nameEl: "Reformer Sculpt",
    descEn:
      "Higher spring load, longer holds, more repetitions. Built around glutes, back and arms for muscular endurance and shape without impact.",
    descEl:
      "Μεγαλύτερο φορτίο, πιο μεγάλες παύσεις, περισσότερες επαναλήψεις. Δουλεύει γλουτούς, πλάτη και χέρια για μυϊκή αντοχή χωρίς επιβάρυνση.",
    level: "INTERMEDIATE",
    intensity: 3,
    focusEn: "Strength · Endurance · Glutes",
    focusEl: "Δύναμη · Αντοχή · Γλουτοί",
    sortOrder: 3,
  },
  {
    slug: "jumpboard",
    nameEn: "Jumpboard Cardio",
    nameEl: "Jumpboard Cardio",
    descEn:
      "Cardio without the pounding. Horizontal jumping on the jumpboard raises your heart rate while your spine stays supported. Intervals, music, sweat.",
    descEl:
      "Cardio χωρίς κραδασμούς. Οριζόντια άλματα στο jumpboard ανεβάζουν τους σφυγμούς με τη σπονδυλική στήλη υποστηριγμένη. Ιντερβάλ, μουσική, ιδρώτας.",
    level: "INTERMEDIATE",
    intensity: 3,
    focusEn: "Cardio · Power · Legs",
    focusEl: "Cardio · Ισχύς · Πόδια",
    sortOrder: 4,
  },
  {
    slug: "restore",
    nameEn: "Stretch & Restore",
    nameEl: "Stretch & Restore",
    descEn:
      "Low springs, long lines, deep breath. Assisted mobility for hips, thoracic spine and shoulders, the class your desk week is asking for.",
    descEl:
      "Χαμηλά ελατήρια, μακριές γραμμές, βαθιά αναπνοή. Υποβοηθούμενη κινητικότητα για ισχία, θωρακική μοίρα και ώμους, το μάθημα που ζητά η εβδομάδα στο γραφείο.",
    level: "ALL",
    intensity: 1,
    focusEn: "Mobility · Recovery · Breath",
    focusEl: "Κινητικότητα · Αποκατάσταση · Αναπνοή",
    sortOrder: 5,
  },
  {
    slug: "athletic",
    nameEn: "Athletic Reformer",
    nameEl: "Athletic Reformer",
    descEn:
      "For the gym floor crowd. Unilateral loading, rotation and deceleration work that makes your lifts and your sport safer. Advanced control required.",
    descEl:
      "Για όσους προπονούνται. Μονόπλευρη φόρτιση, στροφική κίνηση και έλεγχος επιβράδυνσης που κάνουν τις άρσεις και το άθλημά σου ασφαλέστερα. Απαιτεί προχωρημένο έλεγχο.",
    level: "ADVANCED",
    intensity: 3,
    focusEn: "Rotation · Unilateral · Performance",
    focusEl: "Στροφή · Μονόπλευρα · Απόδοση",
    sortOrder: 6,
  },
] as const;

/* ------------------------------------------------------------- credit packs */

const PACKAGES = PACKS;

/*
 * The studio's instructors live in lib/roster.ts now, not here, because the
 * roster has to be reconciled on every boot and not only on a fresh seed — see
 * that file. The seed calls reconcileRoster() below, which upserts the team and
 * switches off anyone no longer on it, and hands back the name → id map the
 * templates need.
 */

/* ---------------------------------------------------------------- timetable */

/* Class length and capacity, from the one place they are defined. */
const CLASS_LENGTH_MIN = STUDIO.classLengthMinutes;
const CLASS_CAPACITY = STUDIO.capacity;

/*
 * The whole timetable — which hours run and who teaches them — lives in
 * lib/rota.ts (WEEKLY_SCHEDULE), so a live database can be repaired to match it
 * without being re-seeded. See the note at the top of that file.
 *
 * Every group class is Reformer Flow. The studio runs one kind of group class,
 * so the slot's type is always "flow"; the other class types remain in the
 * catalogue but are not put on the timetable.
 */
const GROUP_TYPE_SLUG = "flow";

/* --------------------------------------------------------------------- run */

async function main() {
  console.log("→ seeding RG Pilates Studio…");

  /* Class types */
  for (const ct of CLASS_TYPES) {
    const found = db
      .select()
      .from(classTypes)
      .where(eq(classTypes.slug, ct.slug))
      .get();
    if (found) {
      db.update(classTypes)
        .set({ ...ct })
        .where(eq(classTypes.id, found.id))
        .run();
    } else {
      db.insert(classTypes)
        .values({ ...ct })
        .run();
    }
  }
  console.log(`  ✓ ${CLASS_TYPES.length} class types`);

  /* Credit packages */
  for (const p of PACKAGES) {
    const found = db
      .select()
      .from(creditPackages)
      .where(eq(creditPackages.slug, p.slug))
      .get();
    if (found) {
      db.update(creditPackages)
        .set({ ...p })
        .where(eq(creditPackages.id, found.id))
        .run();
    } else {
      db.insert(creditPackages)
        .values({ ...p })
        .run();
    }
  }
  /* Packs the studio no longer sells are deactivated rather than deleted:
     past purchases and credit batches still point at those rows. Shared with
     the read path so both agree on what is on sale. */
  const sync = repairCatalogue();
  console.log(
    `  ✓ ${PACKAGES.length} credit packs` +
      (sync.withdrawn ? `, ${sync.withdrawn} withdrawn from sale` : ""),
  );

  /* Instructors — upserted and reconciled from the roster, which also switches
     off anyone no longer on the team. Returns the name → id map used below. */
  const instructorByName = reconcileRoster();
  console.log(`  ✓ ${INSTRUCTOR_ROSTER.length} instructors`);

  /* Weekly templates — wiped and rebuilt so the rota always matches this file */
  const typeIds = new Map(
    db
      .select()
      .from(classTypes)
      .all()
      .map((c) => [c.slug, c.id] as const),
  );

  /* The rota in this file is the studio's published timetable, so it is always
     reconciled. Previously it was only written into an empty database, which
     meant a change here (60 minutes instead of 50, five reformers instead of
     eight) never reached an installation that had already been seeded.
     Rows are matched on day + start time and updated in place rather than
     deleted and recreated: generated classes carry a template_id, so wiping the
     table trips the foreign key. Slots no longer in the rota are deactivated,
     which also keeps their history intact. */
  const existingTemplates = db.select().from(classTemplates).all();
  const keptTemplateIds = new Set<string>();
  let n = 0;

  /* Every group slot is Reformer Flow. */
  const flowTypeId = typeIds.get(GROUP_TYPE_SLUG);
  if (!flowTypeId) {
    throw new Error(`seed: the "${GROUP_TYPE_SLUG}" class type is missing.`);
  }

  /* The instructor named in the schedule, resolved to a row. Every name in
     WEEKLY_SCHEDULE must match one of the roster instructors; a mismatch is a
     typo that would otherwise become a class with nobody teaching it, so it
     stops the seed rather than shipping quietly. */
  const instructorId = (name: string) => {
    const id = instructorByName.get(name);
    if (!id) {
      throw new Error(
        `seed: the schedule names an instructor "${name}" who is not in the instructor list.`,
      );
    }
    return id;
  };

  /* Build every day's templates straight from WEEKLY_SCHEDULE (lib/rota.ts):
     the hours it lists, each taught by the named instructor, all Reformer Flow.
     Saturday and Sunday have no entries, so no group templates. */
  for (let day = 0; day <= 6; day++) {
    for (const slot of WEEKLY_SCHEDULE[day] ?? []) {
      const hour = slot.hour;
      const values = {
        classTypeId: flowTypeId,
        instructorId: instructorId(slot.instructor),
        dayOfWeek: day,
        startMinutes: hour * 60,
        durationMin: CLASS_LENGTH_MIN,
        capacity: CLASS_CAPACITY,
        active: true,
      };
      const match = existingTemplates.find(
        (x) => x.dayOfWeek === day && x.startMinutes === hour * 60,
      );
      if (match) {
        db.update(classTemplates)
          .set(values)
          .where(eq(classTemplates.id, match.id))
          .run();
        keptTemplateIds.add(match.id);
      } else {
        keptTemplateIds.add(
          db.insert(classTemplates).values(values).returning().get().id,
        );
      }
      n++;
    }
  }
  for (const tpl of existingTemplates) {
    if (keptTemplateIds.has(tpl.id)) continue;
    db.update(classTemplates)
      .set({ active: false })
      .where(eq(classTemplates.id, tpl.id))
      .run();
  }
  console.log(`  ✓ ${n} weekly timetable slots`);

  /* Bring already-generated future classes back in line with the rota above.
     generateSessions() only ever adds missing slots, so without this a class
     created under the old 50-minute, 8-place rota would keep those numbers for
     as long as it sat in the database. Classes nobody has booked are dropped
     and regenerated; classes with bookings are corrected in place, and their
     capacity is never lowered below the number of people already in them. */
  const now = Math.floor(Date.now() / 1000);
  const stale = sqlite
    .prepare(
      `select s.id,
              (select count(*) from bookings b
                where b.session_id = s.id and b.status = 'CONFIRMED') as booked
         from class_sessions s
        where s.starts_at > ?
          and (s.capacity != ? or (s.ends_at - s.starts_at) != ?)`,
    )
    .all(now, CLASS_CAPACITY, CLASS_LENGTH_MIN * 60) as {
    id: string;
    booked: number;
  }[];

  let dropped = 0;
  let repaired = 0;
  for (const row of stale) {
    if (row.booked === 0) {
      sqlite.prepare("delete from class_sessions where id = ?").run(row.id);
      dropped++;
    } else {
      sqlite
        .prepare(
          `update class_sessions
              set ends_at = starts_at + ?,
                  capacity = max(?, ?)
            where id = ?`,
        )
        .run(CLASS_LENGTH_MIN * 60, CLASS_CAPACITY, row.booked, row.id);
      repaired++;
    }
  }
  if (dropped || repaired) {
    console.log(
      `  ✓ realigned future classes to ${CLASS_LENGTH_MIN} min / ${CLASS_CAPACITY} places` +
        ` (${dropped} regenerated, ${repaired} corrected in place)`,
    );
  }

  /* Users
     ----
     Two accounts open the console, and they are not the same account. Reception
     runs the desk: sessions in and out, bookings, closures, notices, prices.
     The owner has all of that plus the numbers — what the studio has taken and
     how many members it has — because the reception computer sits in a public
     room and those figures should not be on it.

     The passwords here are development defaults, and the seed says so out loud.
     Real ones are set on the studio's own machine with `npm run staff`, so they
     never travel through a chat window or a git history. */
  const ownerEmail = (
    process.env.SEED_OWNER_EMAIL ?? "owner@rgpilatesstudio.com"
  )
    .trim()
    .toLowerCase();
  const receptionEmail = (
    process.env.SEED_RECEPTION_EMAIL ?? "reception@rgpilatesstudio.com"
  )
    .trim()
    .toLowerCase();

  /* A default password must never reach a live database. In production the seed
     credentials have to come from the environment — as the first-boot guard and
     go-live already require — rather than falling back to owner@… / ownerdev123,
     which is a working ADMIN login written in a public repository. Refuse the
     seed rather than create it. */
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.SEED_OWNER_PASSWORD || !process.env.SEED_RECEPTION_PASSWORD)
  ) {
    throw new Error(
      "Refusing to seed default owner/reception passwords in production. " +
        "Set SEED_OWNER_PASSWORD and SEED_RECEPTION_PASSWORD first.",
    );
  }

  const owner = upsertUser({
    email: ownerEmail,
    name: "Studio Owner",
    password: process.env.SEED_OWNER_PASSWORD ?? "ownerdev123",
    role: "ADMIN",
  });

  /**
   * The same address for both is a mistake, and it used to be a silent one.
   *
   * `upsertUser` matches on email, and reception is written second, so two
   * identical addresses produced *one* account: created as the owner, then
   * immediately overwritten to reception. The studio ended up with a console
   * they could open, no Analytics tab anywhere, and nothing to explain why —
   * the owner account did not exist and the logs said both had been created.
   * That happened on the live database.
   *
   * Reception is the one that gives way. An owner account is the one you cannot
   * work without: it can do everything reception can, and it is the only thing
   * that can promote another account afterwards. A studio with only an owner is
   * inconvenienced; a studio with only a reception account is locked out of its
   * own figures with no way in.
   */
  if (receptionEmail === ownerEmail) {
    console.error(
      `\n  ✗ SEED_OWNER_EMAIL and SEED_RECEPTION_EMAIL are both ${ownerEmail}.\n` +
        `    They must be different addresses: one account cannot be both.\n` +
        `    Keeping ${ownerEmail} as the OWNER and creating no reception account.\n` +
        `    Add one afterwards:  npm run staff -- add desk@your-studio.cy "Reception" reception\n`,
    );
  } else {
    upsertUser({
      email: receptionEmail,
      name: "Reception",
      password: process.env.SEED_RECEPTION_PASSWORD ?? "receptiondev123",
      role: "STAFF",
    });
  }
  /**
   * The demo member exists so the booking flow is clickable with no Stripe and
   * no real person to sign up. It has a password written in this file and ten
   * free sessions, which is precisely what must not exist on a live website: it
   * is an account anybody who has read this repository can sign into.
   *
   * So it is created for a development database and skipped for a production
   * one. `SEED_DEMO_MEMBER=true` forces it back for a staging site that wants a
   * clickable demo, and `=false` refuses it anywhere.
   */
  const wantDemo =
    process.env.SEED_DEMO_MEMBER === "true" ||
    (process.env.SEED_DEMO_MEMBER !== "false" &&
      process.env.NODE_ENV !== "production");

  const member = wantDemo
    ? upsertUser({
        email: "member@example.com",
        name: "Demo Member",
        password: "member123",
        role: "MEMBER",
        phone: "+357 99 000 000",
      })
    : null;

  /* The old single admin account, with its password written in this file and in
     the README, is retired. Anything it did stays in the ledger under its name;
     it simply can no longer open the console. */
  const legacy = db
    .select()
    .from(users)
    .where(eq(users.email, "admin@rgpilatesstudio.com"))
    .get();
  if (legacy && legacy.role !== "MEMBER") {
    db.update(users)
      .set({ role: "MEMBER" })
      .where(eq(users.id, legacy.id))
      .run();
    console.log("  ✓ retired admin@rgpilatesstudio.com — it can no longer open /admin");
  }

  /* Never print a password that came from the environment: on a hosted service
     this output is a build log somebody else can read. Only the development
     defaults, which are written in this file anyway, are named out loud. */
  const ownerPass = process.env.SEED_OWNER_PASSWORD
    ? "(from SEED_OWNER_PASSWORD)"
    : "ownerdev123";
  const receptionPass = process.env.SEED_RECEPTION_PASSWORD
    ? "(from SEED_RECEPTION_PASSWORD)"
    : "receptiondev123";
  const seeded = process.env.SEED_OWNER_PASSWORD && process.env.SEED_RECEPTION_PASSWORD;

  console.log(
    seeded
      ? "  ✓ desk accounts (passwords taken from the environment):"
      : "  ✓ desk accounts (development passwords, change before going live):",
  );
  console.log(`           ${owner.email} / ${ownerPass}        owner, everything`);
  if (receptionEmail !== ownerEmail) {
    console.log(
      `           ${receptionEmail} / ${receptionPass}   the desk, no analytics`,
    );
  }
  if (member) console.log("           member@example.com / member123   demo member");
  else console.log("           no demo member on this database, which is right for a live one");
  console.log("    → npm run staff   to set the real ones on this machine");

  /* Give the demo member a pack so the booking flow is clickable with no Stripe.
     No demo member, no free sessions: see above. */
  const { grantCredits, getAvailableCredits } = await import("@/lib/credits");
  const balance = member ? await getAvailableCredits(member.id) : -1;
  if (member && balance === 0) {
    grantCredits({
      userId: member.id,
      credits: 10,
      validityDays: 90,
      source: "GRANT",
      reason: "ADMIN_GRANT",
      note: "Seed data, demo pack",
    });
    console.log("  ✓ demo member granted 10 credits");
  }

  /* The whole timetable horizon, from the constant the pages read. Seeding
     fewer weeks than the timetable shows leaves a fresh install with a strip
     that ends in empty days. */
  const { generateSessions, TIMETABLE_WEEKS } = await import("@/lib/schedule");
  const gen = generateSessions(TIMETABLE_WEEKS);
  console.log(
    `  ✓ sessions generated: ${gen.created} new, ${gen.skipped} already existed/past`,
  );

  console.log(`\n✓ seed complete. Owner id ${owner.id}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
