import { desc } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { classSessions } from "@/db/schema";
import {
  PERSONAL_DURATION_MINUTES,
  PERSONAL_SLOT_DAYS,
  PERSONAL_SLOT_HOURS,
} from "./personal";
import { classHoursOn, instructorForSlot } from "./rota";
import { reconcileRoster } from "./roster";
import { generateSessions, TIMETABLE_WEEKS } from "./schedule";
import { STUDIO } from "./studio";
import { studioStartOfDay } from "./time";

/**
 * The timetable's own shape, repaired on the first read after boot.
 *
 * Two structural facts about the studio changed at once, and both of them live
 * in rows rather than in code, so neither could be fixed by editing a constant.
 *
 * **One class, one name.** The rota was seeded with six class types —
 * Foundations, Flow, Sculpt, Jumpboard, Restore, Athletic — and the studio does
 * not teach six different things. It teaches Reformer Flow, and a member reading
 * six names was being asked to choose between distinctions the room does not
 * make. The templates are moved onto Flow, the classes still to come are moved
 * with them, and the other five are withdrawn.
 *
 * Days already past are left alone. A member's history saying they attended
 * Reformer Sculpt in July is true, and rewriting it would be the site editing
 * somebody's own record to match a decision taken afterwards.
 *
 * **The midday appointments.** Personal and duet sessions need a class type of
 * their own and fifteen weekly slots, and neither can be a constant either: the
 * generator reads templates out of the database. So they are written in here,
 * matched on the day and the hour, and adding them is a no-op on the second run.
 *
 * Idempotent, cheap, and reported so a boot that changed something says so.
 */

let done = false;

export function repairTimetableOnce() {
  if (done) return;
  done = true;
  try {
    repairTimetable();
  } catch (err) {
    /* A repair that fails must not take the timetable down with it. The old
       names are wrong; a 500 is worse. */
    console.error("[timetable] repair failed", err);
  }
}

export type TimetableSync = {
  /** Templates moved onto the single class name. */
  templatesMoved: number;
  /** Classes still to come, moved with them. */
  sessionsMoved: number;
  /** Class types withdrawn because the studio no longer names them. */
  withdrawn: number;
  /** Weekly appointment slots written in. */
  personalTemplates: number;
  /** Group class slots the rota calls for that the database was missing. */
  classTemplates: number;
  /** Group templates switched off because their hour is no longer in the rota. */
  staleTemplates: number;
  /** Future classes removed because their hour left the rota (unbooked only). */
  sessionsPruned: number;
  /** Future classes whose instructor was brought back in line with the rota. */
  sessionsReassigned: number;
};

/** The one name every group class on the timetable carries. */
const FLOW = {
  slug: "flow",
  nameEn: "Reformer Flow",
  nameEl: "Reformer Flow",
  descEn:
    "Fifty minutes on the reformer, five people, one instructor watching all five. The work is built to your day rather than to a level printed on a timetable.",
  descEl:
    "Πενήντα λεπτά στο reformer, πέντε άτομα, ένας εκπαιδευτής που βλέπει και τα πέντε. Η άσκηση προσαρμόζεται στη μέρα σου και όχι σε ένα επίπεδο τυπωμένο σε ένα πρόγραμμα.",
  focusEn: "Strength, control, alignment",
  focusEl: "Δύναμη, έλεγχος, ευθυγράμμιση",
} as const;

/** The appointment slot, which is a class type because the generator needs one. */
const PERSONAL = {
  slug: "personal-session",
  nameEn: "Personal or Duet",
  nameEl: "Ατομικό ή Δυάδα",
  descEn:
    "The room to yourself, or to the two of you. Fifty minutes on whatever you want to work on, booked by the end of the day before so an instructor can be there for it.",
  descEl:
    "Ο χώρος δικός σου, ή των δυο σας. Πενήντα λεπτά πάνω σε ό,τι θέλεις να δουλέψεις, με κράτηση μέχρι το τέλος της προηγούμενης μέρας ώστε να είναι εκεί εκπαιδευτής για εσένα.",
  focusEn: "One to one attention",
  focusEl: "Προσοχή ένας προς έναν",
} as const;

export function repairTimetable(now = new Date()): TimetableSync {
  const out: TimetableSync = {
    templatesMoved: 0,
    sessionsMoved: 0,
    withdrawn: 0,
    personalTemplates: 0,
    classTemplates: 0,
    staleTemplates: 0,
    sessionsPruned: 0,
    sessionsReassigned: 0,
  };

  /* Nothing to repair before the schema exists. */
  const hasTypes = sqlite
    .prepare("select name from sqlite_master where type='table' and name='class_types'")
    .get();
  if (!hasTypes) return out;

  /* Bring the instructors in line with the roster first, and keep the
     name → id map: the schedule below names who teaches each hour, and this is
     what turns those names into the ids the templates carry. Done outside the
     transaction because reconcileRoster opens its own and better-sqlite3 will
     not nest one inside another. */
  const instructorByName = reconcileRoster();

  sqlite.transaction(() => {
    /* ------------------------------------------------ the single class name */
    let flow = sqlite
      .prepare("select id from class_types where slug = ?")
      .get(FLOW.slug) as { id: string } | undefined;

    if (!flow) {
      const id = crypto.randomUUID();
      sqlite
        .prepare(
          `insert into class_types
             (id, slug, name_en, name_el, desc_en, desc_el, level, intensity,
              focus_en, focus_el, kind, active, sort_order)
           values (?, ?, ?, ?, ?, ?, 'ALL', 2, ?, ?, 'GROUP', 1, 1)`,
        )
        .run(
          id,
          FLOW.slug,
          FLOW.nameEn,
          FLOW.nameEl,
          FLOW.descEn,
          FLOW.descEl,
          FLOW.focusEn,
          FLOW.focusEl,
        );
      flow = { id };
    } else {
      sqlite
        .prepare(
          `update class_types
              set name_en = ?, name_el = ?, desc_en = ?, desc_el = ?,
                  focus_en = ?, focus_el = ?, level = 'ALL', kind = 'GROUP',
                  active = 1, sort_order = 1
            where id = ?`,
        )
        .run(
          FLOW.nameEn,
          FLOW.nameEl,
          FLOW.descEn,
          FLOW.descEl,
          FLOW.focusEn,
          FLOW.focusEl,
          flow.id,
        );
    }

    out.templatesMoved = sqlite
      .prepare(
        `update class_templates set class_type_id = ?
          where class_type_id != ?
            and class_type_id in (select id from class_types where kind = 'GROUP')`,
      )
      .run(flow.id, flow.id).changes;

    /* From the start of today, because that is the window the timetable shows.
       Yesterday is history and history is left as it happened. */
    const cutoff = Math.floor(studioStartOfDay(now).getTime() / 1000);
    out.sessionsMoved = sqlite
      .prepare(
        `update class_sessions set class_type_id = ?
          where starts_at >= ?
            and class_type_id != ?
            and class_type_id in (select id from class_types where kind = 'GROUP')`,
      )
      .run(flow.id, cutoff, flow.id).changes;

    out.withdrawn = sqlite
      .prepare(
        `update class_types set active = 0
          where kind = 'GROUP' and slug != ? and active = 1`,
      )
      .run(FLOW.slug).changes;

    /* ----------------------------------------------- the midday appointments */
    let personal = sqlite
      .prepare("select id from class_types where slug = ?")
      .get(PERSONAL.slug) as { id: string } | undefined;

    if (!personal) {
      const id = crypto.randomUUID();
      sqlite
        .prepare(
          `insert into class_types
             (id, slug, name_en, name_el, desc_en, desc_el, level, intensity,
              focus_en, focus_el, kind, active, sort_order)
           values (?, ?, ?, ?, ?, ?, 'ALL', 2, ?, ?, 'PERSONAL', 1, 2)`,
        )
        .run(
          id,
          PERSONAL.slug,
          PERSONAL.nameEn,
          PERSONAL.nameEl,
          PERSONAL.descEn,
          PERSONAL.descEl,
          PERSONAL.focusEn,
          PERSONAL.focusEl,
        );
      personal = { id };
    } else {
      sqlite
        .prepare(
          `update class_types
              set name_en = ?, name_el = ?, desc_en = ?, desc_el = ?,
                  focus_en = ?, focus_el = ?, kind = 'PERSONAL', active = 1,
                  sort_order = 2
            where id = ?`,
        )
        .run(
          PERSONAL.nameEn,
          PERSONAL.nameEl,
          PERSONAL.descEn,
          PERSONAL.descEl,
          PERSONAL.focusEn,
          PERSONAL.focusEl,
          personal.id,
        );
    }

    const exists = sqlite.prepare(
      `select id from class_templates
        where class_type_id = ? and day_of_week = ? and start_minutes = ?`,
    );
    const insert = sqlite.prepare(
      `insert into class_templates
         (id, class_type_id, instructor_id, day_of_week, start_minutes,
          duration_min, capacity, active)
       values (?, ?, null, ?, ?, ?, 1, 1)`,
    );
    const fix = sqlite.prepare(
      `update class_templates
          set duration_min = ?, capacity = 1, active = 1
        where id = ?`,
    );

    for (const day of PERSONAL_SLOT_DAYS) {
      for (const hour of PERSONAL_SLOT_HOURS) {
        const minutes = hour * 60;
        const row = exists.get(personal.id, day, minutes) as
          | { id: string }
          | undefined;
        if (row) {
          fix.run(PERSONAL_DURATION_MINUTES, row.id);
          continue;
        }
        insert.run(
          crypto.randomUUID(),
          personal.id,
          day,
          minutes,
          PERSONAL_DURATION_MINUTES,
        );
        out.personalTemplates++;
      }
    }

    /* No instructor is named on an appointment template, and none should be:
       who teaches it is decided when the studio rings round after the booking
       lands. A name printed on the slot before anybody has agreed to work it is
       a promise the site is not in a position to make. */

    /**
     * The rota, made authoritative for the group timetable.
     *
     * The rota used to exist only inside the seed, so changing it reached a live
     * database by re-seeding — which nobody will do to a database holding real
     * bookings. And the studio's rota genuinely changed: from one uniform weekday
     * shape, open six days a week, to a per-day schedule with a named instructor
     * for each hour, closed on Saturday and Sunday. Adding the new hours was not
     * enough — the old hours the studio no longer runs (Saturday classes, the
     * old uniform afternoons) were still in the table, still generating classes a
     * member could see and book at a time the studio is shut, and every class
     * still carried whichever instructor first taught it.
     *
     * So the rota is reconciled, not merely topped up:
     *
     *   - every hour the rota calls for exists as a group template, with the
     *     instructor the rota names for that hour;
     *   - a group template at an hour the rota no longer mentions is switched
     *     off — this is a weekly recurring slot, which the rota owns; a one-off
     *     class the desk adds for a single date is a session, not a template, so
     *     it is untouched by this;
     *   - the future classes are brought with the templates: those at a dropped
     *     hour are removed if nobody has booked them, and the rest have their
     *     instructor set back to whoever the rota now names.
     *
     * Days already past are never touched: a class that has happened is history.
     */
    const flowType = sqlite
      .prepare("select id from class_types where slug = ? limit 1")
      .get(FLOW.slug) as { id: string } | undefined;

    if (flowType) {
      /* The id the rota's instructor name resolves to, or null for an hour the
         rota leaves unstaffed. A name in the rota with no matching instructor
         row would be a bug caught upstream; here it simply leaves the slot
         unassigned rather than throwing on a page render. */
      const instructorFor = (day: number, hour: number): string | null => {
        const name = instructorForSlot(day, hour);
        return name ? (instructorByName.get(name) ?? null) : null;
      };

      const findSlot = sqlite.prepare(
        `select id from class_templates
          where day_of_week = ? and start_minutes = ?
            and class_type_id in (select id from class_types where kind = 'GROUP')
          limit 1`,
      );
      const addSlot = sqlite.prepare(
        `insert into class_templates
           (id, class_type_id, instructor_id, day_of_week, start_minutes,
            duration_min, capacity, active)
         values (?, ?, ?, ?, ?, ?, ?, 1)`,
      );
      const setSlot = sqlite.prepare(
        `update class_templates
            set class_type_id = ?, instructor_id = ?, duration_min = ?,
                capacity = ?, active = 1
          where id = ?`,
      );

      /* Which (day, minute) pairs the rota actually calls for, so a group
         template outside the set can be recognised as stale. */
      const valid = new Set<string>();

      for (let day = 0; day <= 6; day++) {
        for (const hour of classHoursOn(day)) {
          const minutes = hour * 60;
          valid.add(`${day}:${minutes}`);
          const instructorId = instructorFor(day, hour);
          const row = findSlot.get(day, minutes) as { id: string } | undefined;
          if (row) {
            setSlot.run(
              flowType.id,
              instructorId,
              STUDIO.classLengthMinutes,
              STUDIO.capacity,
              row.id,
            );
          } else {
            addSlot.run(
              crypto.randomUUID(),
              flowType.id,
              instructorId,
              day,
              minutes,
              STUDIO.classLengthMinutes,
              STUDIO.capacity,
            );
            out.classTemplates++;
          }
        }
      }

      /* Switch off group templates the rota no longer mentions. */
      const activeGroup = sqlite
        .prepare(
          `select id, day_of_week, start_minutes from class_templates
            where active = 1
              and class_type_id in (select id from class_types where kind = 'GROUP')`,
        )
        .all() as { id: string; day_of_week: number; start_minutes: number }[];
      const deactivate = sqlite.prepare(
        "update class_templates set active = 0 where id = ?",
      );
      const staleIds: string[] = [];
      for (const t of activeGroup) {
        if (!valid.has(`${t.day_of_week}:${t.start_minutes}`)) {
          deactivate.run(t.id);
          staleIds.push(t.id);
          out.staleTemplates++;
        }
      }

      /* Bring the future classes with them. From the start of today, because
         that is the window the timetable shows; yesterday is history. */
      const cutoff = Math.floor(studioStartOfDay(now).getTime() / 1000);

      /* Classes at a dropped hour that nobody has booked are removed; a booked
         one is left for the desk to cancel, because un-booking someone silently
         is worse than an extra row. */
      if (staleIds.length > 0) {
        const marks = staleIds.map(() => "?").join(", ");
        out.sessionsPruned = sqlite
          .prepare(
            `delete from class_sessions
              where starts_at >= ?
                and template_id in (${marks})
                and id not in (
                  select session_id from bookings where status = 'CONFIRMED'
                )`,
          )
          .run(cutoff, ...staleIds).changes;
      }

      /* Every remaining future group class takes its instructor from its
         template, which the rota has just corrected. Without this a class
         generated under the old rota keeps the old instructor's name on it for
         as long as the row exists. */
      out.sessionsReassigned = sqlite
        .prepare(
          `update class_sessions
              set instructor_id = (
                select t.instructor_id from class_templates t
                 where t.id = class_sessions.template_id
              )
            where starts_at >= ?
              and template_id is not null
              and class_type_id in (select id from class_types where kind = 'GROUP')`,
        )
        .run(cutoff).changes;
    }
  })();

  /**
   * And then roll them forward, because a template is not a bookable hour.
   *
   * The generator turns templates into real dated classes, and it is normally
   * run from the desk. Leaving it at that here would have shipped fifteen
   * weekly slots that appear nowhere until somebody thinks to press a button
   * they have no reason to connect with a feature they have just been told is
   * live. The studio would have concluded, correctly, that it did not work.
   *
   * Only when something was actually written, so this costs one transaction once
   * and nothing on every boot after. `generateSessions` is idempotent, so even
   * the pathological case of it running twice creates nothing twice.
   */
  /**
   * The horizon has to move on its own, not only when a template changes.
   *
   * `generateSessions` writes a fixed span of weeks from the day it runs, so the
   * furthest class stays put while the calendar advances underneath it. Rolling
   * it forward only on a template change — which is what this used to do — meant
   * a studio that never edited its rota kept whatever horizon it was first
   * generated with: a database seeded under a ninety-day horizon still ended in
   * December long after the booking window became a year, and a member trying to
   * book January was told the studio had no classes. So the furthest class is
   * compared to where it should reach, and the generator runs whenever it falls
   * short — with a week of slack so a boot a day later does not redo it for the
   * sake of one missing day.
   */
  const furthest = db
    .select({ startsAt: classSessions.startsAt })
    .from(classSessions)
    .orderBy(desc(classSessions.startsAt))
    .limit(1)
    .get();
  const wantThroughMs =
    now.getTime() + (GENERATE_WEEKS * 7 - 7) * 24 * 60 * 60 * 1000;
  const horizonBehind = (furthest?.startsAt?.getTime() ?? 0) < wantThroughMs;

  if (
    out.personalTemplates > 0 ||
    out.classTemplates > 0 ||
    out.staleTemplates > 0 ||
    out.sessionsPruned > 0 ||
    horizonBehind
  ) {
    try {
      generateSessions(GENERATE_WEEKS, now);
    } catch (err) {
      console.error("[timetable] could not roll the new slots forward", err);
    }
  }

  return out;
}

/**
 * How far ahead to roll the new appointment slots.
 *
 * The same horizon the timetable shows, from the same constant. These were two
 * different numbers once — six weeks generated against four weeks displayed —
 * and the day the display caught up with the generator was the day the last
 * fortnight of the strip went blank.
 */
const GENERATE_WEEKS = TIMETABLE_WEEKS;
