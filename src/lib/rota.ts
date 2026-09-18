/**
 * The weekly rota, in one place: which hours run a group class, and who teaches
 * each one.
 *
 * This is the single source of truth. The seed builds the weekly templates from
 * it, `timetable-repair` adds any a live database is missing, and the opening
 * hours shown on the site are *computed* from it rather than typed alongside it.
 * A class cannot appear on the timetable without appearing in the published
 * hours, because they are the same fact.
 *
 * ---
 *
 * **The schedule is now per day, not one weekday shape.**
 *
 * It used to be "every weekday, 06:00–12:00 and 15:00–20:00", one uniform block.
 * The studio's real timetable is not uniform: some afternoons are closed, the
 * instructor changes partway through a morning, and Saturday is shut. So the
 * rota is a list, per day, of `{ hour, instructor }` — the hour a class starts
 * and who teaches it. Everything else (the hours, the opening summary, the
 * templates) is derived from that one list, so the three can never drift apart.
 *
 * `instructor` is the name exactly as it appears in the instructor list in
 * `src/db/seed.ts`. The seed resolves the name to an instructor row and refuses
 * to seed if a name here has no match, so a typo is caught at build time rather
 * than becoming a class with nobody teaching it.
 *
 * Middle of the day (12:00 to 14:00, Monday to Thursday) is not here: those are the Personal
 * and Duet appointments, which are their own thing — see `lib/personal.ts` and
 * `timetable-repair.ts`.
 */

/** The instructors, by the name the seed uses. Kept here so the schedule below reads. */
const ANDREA = "Andrea";
const MARIA = "Maria";

/** A run of consecutive hours taught by one person, as a helper for the table below. */
function block(from: number, to: number, instructor: string) {
  const out: { hour: number; instructor: string }[] = [];
  for (let h = from; h < to; h++) out.push({ hour: h, instructor });
  return out;
}

export type Slot = { hour: number; instructor: string };

/**
 * The week, Sunday = 0. Each entry is the group classes that day, in order,
 * taken from the studio's published schedule card:
 *
 *   Mon to Thu   06:00 to 12:00 · 15:00 to 20:00
 *   Fri          06:00 to 11:00 · 13:00 to 14:00 · 15:00 to 20:00
 *   Sat          07:00 to 12:00
 *   Sun          closed
 *
 * "06 to 12" means classes starting at 06:00 through 11:00, the last finishing
 * at 12:00: the block ends an hour after the last class starts.
 *
 * TODO: who teaches which hour is a placeholder split between the two
 * instructors the studio's members name. Confirm the real rota with RG.
 */
export const WEEKLY_SCHEDULE: Record<number, readonly Slot[]> = {
  0: [],
  1: [...block(6, 12, MARIA), ...block(15, 20, ANDREA)],
  2: [...block(6, 12, ANDREA), ...block(15, 20, MARIA)],
  3: [...block(6, 12, MARIA), ...block(15, 20, ANDREA)],
  4: [...block(6, 12, ANDREA), ...block(15, 20, MARIA)],
  5: [...block(6, 11, MARIA), ...block(13, 14, ANDREA), ...block(15, 20, ANDREA)],
  6: [...block(7, 12, ANDREA)],
};

/**
 * Class levels the studio asked for, applied once to a live database.
 *
 * The level of a class lives in the database and is the desk's to change, so
 * this is not an ongoing source of truth like the rota above — it is the
 * *initial* value, applied by `applyLevelRules` on the first boot after the
 * feature ships and never again once the desk has touched that slot. Each rule
 * names a slot by weekday and hour, the level it should start at, and the date
 * from which it applies, so a change can skip the current week: "Thursday 10:00
 * is Beginners from the 21st" leaves this week's Thursday as it was.
 */
export type LevelRule = {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** The hour the class starts, 24h. */
  hour: number;
  /** ALL | BEGINNER | INTERMEDIATE | ADVANCED. */
  level: "ALL" | "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  /** First date it applies, YYYY-MM-DD in the studio's calendar. */
  from: string;
};

export const LEVEL_RULES: readonly LevelRule[] = [];

/** Which hours run a group class on a given day of the week, Sunday being 0. */
export function classHoursOn(dayOfWeek: number): number[] {
  return (WEEKLY_SCHEDULE[dayOfWeek] ?? []).map((s) => s.hour);
}

/** Who teaches the class at this day and hour, or null if there is no class then. */
export function instructorForSlot(dayOfWeek: number, hour: number): string | null {
  return (
    (WEEKLY_SCHEDULE[dayOfWeek] ?? []).find((s) => s.hour === hour)?.instructor ??
    null
  );
}

/**
 * The opening hours as a member reads them, worked out from a day's hours.
 *
 * A run of consecutive starting hours becomes one block, and the block ends an
 * hour after the last class starts rather than when it starts: a 19:00 class
 * means the studio is open until 20:00, and saying "until 19:00" would be both
 * wrong and discouraging.
 *
 *   [6,7,8,9,10,11,15,16,17,18,19]  ->  ["06:00 to 12:00", "15:00 to 20:00"]
 *   [6,7,8,9,10,11]                 ->  ["06:00 to 12:00"]
 *   []                              ->  []
 */
export function openingBlocks(hours: readonly number[]): string[] {
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const out: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;

  for (const h of [...hours].sort((a, b) => a - b)) {
    if (start === null) {
      start = h;
    } else if (previous !== null && h !== previous + 1) {
      out.push(`${hh(start)} to ${hh(previous + 1)}`);
      start = h;
    }
    previous = h;
  }
  if (start !== null && previous !== null) {
    out.push(`${hh(start)} to ${hh(previous + 1)}`);
  }
  return out;
}

/**
 * The whole week's opening hours, grouped so days with identical hours share a
 * line.
 *
 * Now that the days differ, a single "Monday to Friday" line would be wrong.
 * This walks the week in order and merges days whose opening blocks are the same
 * — for the current rota that is "Mon, Tue, Wed & Thu", "Fri", "Sat" and "Sun" (closed) — so the published hours
 * stay both accurate and tidy, and re-group themselves automatically the next
 * time the studio changes a day.
 *
 * Closed days are included, with empty `blocks`, so the display can list them as
 * closed rather than silently dropping them.
 */
export function openingSummary(): { days: number[]; blocks: string[] }[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { key: string; days: number[]; blocks: string[] }[] = [];
  for (const day of order) {
    const blocks = openingBlocks(classHoursOn(day));
    const key = blocks.join("|") || "closed";
    const existing = groups.find((g) => g.key === key);
    if (existing) existing.days.push(day);
    else groups.push({ key, days: [day], blocks });
  }
  return groups.map(({ days, blocks }) => ({ days, blocks }));
}

/**
 * "Mon", "Mon & Wed", "Tue, Thu & Fri" — a run of day numbers as words.
 *
 * `names` is a 7-entry array indexed by day number (0 = Sunday), passed in by
 * the caller so the labels are localised where they are shown rather than here.
 */
export function formatDayList(days: number[], names: readonly string[]): string {
  const labels = days.map((d) => names[d] ?? String(d));
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}
