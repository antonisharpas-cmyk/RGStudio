import { sqlite } from "@/db";
import { PERSONAL_DURATION_MINUTES } from "./personal";
import { LEVEL_RULES } from "./rota";
import { STUDIO } from "./studio";
import { studioStartOfDay } from "./time";
import { repairTimetableOnce } from "./timetable-repair";

/**
 * Bring the generated timetable in line with the studio's actual room.
 *
 * The number of reformers and the length of a class are studio facts, not
 * per-class ones, but they are copied onto every generated class row. So a
 * database seeded when the studio was described as 50 minutes and eight places
 * keeps serving those numbers to the timetable for as long as those rows exist,
 * however many times the constants are corrected in code. This is not
 * hypothetical: the studio corrected the class length from an hour to fifty
 * minutes after six weeks of classes had already been generated.
 *
 * Rather than make people remember to re-seed, this repairs the data on the
 * first read after boot:
 *
 *   - every class from the start of today onwards is corrected, because that
 *     is the whole window the timetable shows. A class that finished two hours
 *     ago is still on today's page, and leaving it on the old rota was enough
 *     to make the entire class type read 50 minutes;
 *   - capacity is never dropped below the number of people already booked, so
 *     nobody is silently un-booked;
 *   - earlier days are left exactly as they were, because they are history.
 *
 * It is idempotent and costs one indexed UPDATE per process, so it is safe to
 * call from anywhere that reads the schedule.
 */

let done = false;

export function repairScheduleOnce() {
  if (done) return;
  done = true;
  /* Shape first, numbers second. The structural repair can move classes onto
     the single class name and write in the appointment slots, and correcting
     capacities before that would only have to be done again. */
  repairTimetableOnce();
  repairSchedule();
  /* Levels last: the slots and their future classes exist by now, so the initial
     level for each configured slot can be written onto them. */
  applyLevelRules();
}

/**
 * Write the studio's initial class levels, once, onto a live database.
 *
 * The level of a class is the desk's to change and lives in the database, so
 * this only ever *initialises* a slot that no one has set yet: it writes a
 * template's level and stamps its coming classes only while the template's level
 * is still absent. The moment the desk sets that slot to anything — including
 * back to All levels — the guard below stops matching and this never touches it
 * again. Applied from each rule's own date, so the current week can be left as
 * it is while next week changes.
 *
 * Only the slot's own future classes are stamped, and only where the class has
 * no level of its own yet, so a one-off change the desk already made to a single
 * date survives. Pure updates, nothing deleted, no booking touched.
 */
export function applyLevelRules(now = new Date()) {
  let changed = 0;
  for (const rule of LEVEL_RULES) {
    const startMinutes = rule.hour * 60;
    /* Only a slot nobody has set yet. `level is null` is the whole guard: once
       the desk has chosen a level for this slot, this rule is done forever. */
    const tpl = sqlite
      .prepare(
        `select t.id from class_templates t
           join class_types ct on ct.id = t.class_type_id
          where t.day_of_week = ? and t.start_minutes = ?
            and t.active = 1 and ct.kind = 'GROUP' and t.level is null
          limit 1`,
      )
      .get(rule.dayOfWeek, startMinutes) as { id: string } | undefined;
    if (!tpl) continue;

    sqlite
      .prepare(`update class_templates set level = ? where id = ?`)
      .run(rule.level, tpl.id);

    /* From the rule's date, in the studio's calendar, so a mid-week change does
       not rewrite classes that have already run this week. */
    const from = Math.floor(
      studioStartOfDay(new Date(`${rule.from}T12:00:00Z`)).getTime() / 1000,
    );
    changed += sqlite
      .prepare(
        `update class_sessions set level = ?
          where template_id = ? and starts_at >= ? and level is null`,
      )
      .run(rule.level, tpl.id, from).changes;
  }
  return changed;
}

/** Exposed for the seed and for tests; returns how many rows it touched. */
export function repairSchedule(now = new Date()) {
  const cutoff = Math.floor(studioStartOfDay(now).getTime() / 1000);
  const length = STUDIO.classLengthMinutes * 60;

  /**
   * Group classes only.
   *
   * An appointment is one reformer and one booking, so five is exactly the
   * wrong number for it. Without this clause the repair would widen every noon
   * slot to five places on the first read after boot and the studio would be
   * selling four seats in a one to one.
   */
  const info = sqlite
    .prepare(
      `update class_sessions
          set ends_at  = starts_at + ?,
              capacity = max(
                ?,
                (select count(*) from bookings b
                  where b.session_id = class_sessions.id
                    and b.status = 'CONFIRMED')
              )
        where starts_at >= ?
          and class_type_id in (select id from class_types where kind = 'GROUP')
          and (capacity != ? or (ends_at - starts_at) != ?)`,
    )
    .run(length, STUDIO.capacity, cutoff, STUDIO.capacity, length);

  /**
   * The appointment slots, which have their own length and their own capacity.
   *
   * Kept apart from the clause above rather than folded into it, because every
   * number in it is different: one reformer instead of five, and its own
   * duration. Sharing the statement would mean a CASE per column and a reader
   * having to hold both rotas in their head at once.
   */
  const personalLength = PERSONAL_DURATION_MINUTES * 60;
  const appointments = sqlite
    .prepare(
      `update class_sessions
          set ends_at = starts_at + ?
        where starts_at >= ?
          and class_type_id in (select id from class_types where kind = 'PERSONAL')
          and (ends_at - starts_at) != ?`,
    )
    .run(personalLength, cutoff, personalLength);

  /**
   * And the templates the next six weeks will be generated from.
   *
   * Without this the repair is a treadmill: it corrects today's rows, the weekly
   * roll-forward reads a template that still says the old length, and the next
   * batch of classes arrives wrong for the repair to fix again. The class rows
   * are the symptom and the template is the cause, so both are put right.
   */
  const templates = sqlite
    .prepare(
      `update class_templates
          set duration_min = ?
        where duration_min != ?
          and class_type_id in (select id from class_types where kind = 'GROUP')`,
    )
    .run(STUDIO.classLengthMinutes, STUDIO.classLengthMinutes);

  return info.changes + appointments.changes + templates.changes;
}
