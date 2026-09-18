import { and, eq, gte } from "drizzle-orm";
import { openingSummary } from "./rota";
import { db } from "@/db";
import { bookings, classSessions, classTemplates } from "@/db/schema";
import { TIMETABLE_WEEKS } from "./horizon";
import {
  studioAddDays,
  studioDateKey,
  studioDayOfWeek,
  studioParts,
  studioStartOfDay,
  studioWallTimeToInstant,
} from "./time";

/**
 * The horizon constants live in `./horizon`, which imports nothing.
 *
 * Re-exported here because this is where everything already looked for them,
 * and because a module that reaches the database cannot be imported by
 * `validation.ts` — that file is bundled into the browser, and the build fails
 * with `UnhandledSchemeError: node:fs` the moment it is. See horizon.ts.
 */
export {
  BOOKING_HORIZON_DAYS,
  TIMETABLE_DAYS,
  TIMETABLE_WEEKS,
} from "./horizon";

/**
 * Turn the weekly templates into real bookable sessions.
 *
 * The weekly rota — "Reformer Flow, Mondays at 06:00" — is a template. A member
 * cannot book a template; they book a class on a date. This walks forward the
 * number of weeks asked for and writes a real class for every day a template
 * falls on, which is what puts it on the timetable.
 *
 * Times are studio wall-clock times, so a 06:00 template produces a class at
 * 06:00 in Nicosia no matter what timezone the server runs in.
 *
 * **Idempotent, which is the important property.** (templateId, startsAt) is
 * unique, so running it twice never doubles a class up: the second run reports
 * everything as skipped and changes nothing. Pressing the button by accident is
 * therefore not a mistake that needs undoing — but the ids of what it did create
 * are returned anyway, so that a run which went further ahead than intended can
 * be taken back. See `removeGeneratedSessions`.
 */
export function generateSessions(
  weeksAhead = TIMETABLE_WEEKS,
  from = new Date(),
) {
  const templates = db
    .select()
    .from(classTemplates)
    .where(eq(classTemplates.active, true))
    .all();

  const start = studioStartOfDay(from);
  const days = weeksAhead * 7;
  const createdIds: string[] = [];
  let created = 0;
  let skipped = 0;

  db.transaction(() => {
    for (let i = 0; i < days; i++) {
      const dayInstant = studioAddDays(start, i);
      const dow = studioDayOfWeek(dayInstant);
      const p = studioParts(dayInstant);

      for (const tpl of templates) {
        if (tpl.dayOfWeek !== dow) continue;

        const startsAt = studioWallTimeToInstant(
          p.year,
          p.month,
          p.day,
          Math.floor(tpl.startMinutes / 60),
          tpl.startMinutes % 60,
        );

        if (startsAt.getTime() < from.getTime()) {
          skipped++;
          continue;
        }
        const endsAt = new Date(startsAt.getTime() + tpl.durationMin * 60_000);

        const row = db
          .insert(classSessions)
          .values({
            classTypeId: tpl.classTypeId,
            instructorId: tpl.instructorId,
            templateId: tpl.id,
            startsAt,
            endsAt,
            capacity: tpl.capacity,
            /* Inherit the slot's level, so a class the rota generates next month
               already carries the level the desk set on the slot. A one-off
               change to a single class overrides this on the session. */
            level: tpl.level,
          })
          .onConflictDoNothing()
          .returning({ id: classSessions.id })
          .get();
        if (row) {
          created++;
          createdIds.push(row.id);
        } else skipped++;
      }
    }
  });

  return { created, skipped, templates: templates.length, createdIds };
}

/**
 * Keep the far end of the timetable full, without anybody remembering to.
 *
 * `generateSessions` writes a fixed number of weeks from *today*, which means
 * the horizon does not move on its own: every day that passes, the last
 * bookable day gets one day closer, and after three months of nobody pressing
 * Generate at the desk the timetable simply stops. That was survivable while
 * the page showed four weeks of a six-week horizon — two weeks of slack nobody
 * saw. It is not survivable now the page shows the whole ninety days, because
 * the shortfall is on screen as a run of empty days at the end of the strip.
 *
 * The page's own window is computed from today on every request, so it already
 * advances daily: today it ends on 1 December, tomorrow on the 2nd. This is what
 * keeps the *classes* level with it.
 *
 * ---
 *
 * **Once per studio day, and the marker is a date rather than a countdown.**
 *
 * The obvious implementation compares the furthest class against the horizon and
 * generates when it falls short. It does not work, and the way it fails is
 * instructive: the studio is shut on Sundays, so the furthest class is often a
 * day or two behind the furthest *day*, and a naive comparison finds itself
 * permanently short — generating, creating nothing, and finding itself short
 * again on the next sweep, forever.
 *
 * So the question asked here is not "how far ahead are we" but "have we already
 * done this today". That cannot spin: it runs once, sets the marker, and does
 * nothing for the rest of the day. Generation is idempotent and skips everything
 * that already exists, so the cost of the one run is a single transaction of
 * about eight hundred no-ops — a few milliseconds, once a day.
 *
 * The marker lives in memory, which means a restart earns one extra run. That is
 * the right trade: an extra idempotent run costs nothing, and the alternative is
 * a row in the database to remember something that does not matter.
 */
let lastRollDay = "";

export function rollTimetableForward(now = new Date()) {
  const today = studioDateKey(now);
  if (lastRollDay === today) {
    return { rolled: false, created: 0, day: today };
  }
  /* Set before the work, not after. A generation that throws must not leave
     this retrying on every sweep for the rest of the day. */
  lastRollDay = today;

  const gen = generateSessions(TIMETABLE_WEEKS, now);
  if (gen.created > 0) {
    console.log(
      `[timetable] rolled forward for ${today}: ${gen.created} classes created`,
    );
  }
  return { rolled: true, created: gen.created, day: today };
}

/**
 * The same thing, safe to call from a page render.
 *
 * The cron sweep is the proper home for this, and it is what a hosted studio
 * will use. This is the belt to that braces, for the same reason
 * `nudgeReminders` exists: if nobody has scheduled the cron, the one page that
 * cares about a short horizon is the timetable, and it is opened dozens of times
 * a day. Never awaited and never allowed to throw — the timetable renders
 * whether or not its far end got topped up.
 */
export function nudgeTimetable(now = new Date()) {
  if (lastRollDay === studioDateKey(now)) return;
  try {
    rollTimetableForward(now);
  } catch (err) {
    console.error("[timetable] could not roll forward", err);
  }
}

/**
 * Undo one roll-forward.
 *
 * Only the classes that run passed back, and only the ones nobody has booked:
 * a class with a member on it is not an accident to be tidied away, it is a
 * commitment. Those are reported as kept rather than silently ignored, so the
 * desk is told why the numbers do not match.
 *
 * There is no time limit on this and no need for one — the ids are the whole
 * scope, and a class that has since been booked protects itself.
 */
export function removeGeneratedSessions(ids: string[]) {
  if (ids.length === 0) return { removed: 0, kept: 0 };

  let removed = 0;
  let kept = 0;

  db.transaction(() => {
    for (const id of ids) {
      const taken = db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(eq(bookings.sessionId, id), eq(bookings.status, "CONFIRMED")),
        )
        .all().length;

      if (taken > 0) {
        kept++;
        continue;
      }
      removed += db
        .delete(classSessions)
        .where(eq(classSessions.id, id))
        .run().changes;
    }
  });

  return { removed, kept };
}

export async function countUpcomingSessions(from = new Date()) {
  const rows = await db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(
      and(
        gte(classSessions.startsAt, from),
        eq(classSessions.status, "SCHEDULED"),
      ),
    );
  return rows.length;
}

/**
 * Studio opening hours, used by the marketing pages and the footer.
 *
 * Computed from the rota rather than written out, so the hours a member reads
 * cannot disagree with the classes they can actually book. See lib/rota.ts.
 */
export const STUDIO_HOURS = openingSummary().map((g) => ({
  days: g.days,
  blocks: g.blocks,
}));
