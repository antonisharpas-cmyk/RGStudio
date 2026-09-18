/**
 * How far ahead the studio's timetable reaches, and how much of it is on screen.
 *
 * ---
 *
 * **Why these are in a file of their own.**
 *
 * They lived in `schedule.ts`, which is the right home for them conceptually
 * and the wrong one mechanically: `schedule.ts` imports the database, the
 * database imports `better-sqlite3`, and that imports `node:fs`. So the moment
 * `validation.ts` needed the horizon to bound `generateSchema`, the build broke
 * with `UnhandledSchemeError: Reading from "node:fs"` — because `validation.ts`
 * is bundled into the browser for form checks, and had just been handed a
 * native module.
 *
 * Two numbers with no imports cannot do that to anybody. `schedule.ts`
 * re-exports them so nothing that already reads them had to change.
 *
 * ---
 *
 * **`BOOKING_HORIZON_DAYS` — how far ahead a class exists at all.**
 *
 * A year. The studio sells twelve-month packs, and somebody who has paid for a
 * year of classes must be able to book the Monday in month eleven. This is what
 * the generator works to, what the calendar picker will not let you past, and
 * what a repeat run of 52 weeks needs classes to reach.
 *
 * **`TIMETABLE_DAYS` — how many days the strip shows at once.**
 *
 * Thirty. Not a limit on booking: a window onto it, and the arrows page through
 * the year a window at a time.
 *
 * ---
 *
 * **Why the window exists rather than one horizon for both.**
 *
 * Rendering the whole year was tried and measured. A year is 3,968 classes, and
 * the timetable page came to **1.3 MB of HTML, 130 kB gzipped, with 365 chips in
 * the date strip** — against 339 kB and 39 kB for ninety days. Nearly four times
 * the payload, on the one page a member opens on a phone, standing up, deciding
 * whether to train tomorrow.
 *
 * And it buys nothing. The strip is for this week and the next few; nobody
 * scrolls three hundred chips, or ninety.
 *
 * So thirty, and the far end of the strip is a door rather than a wall: land on
 * the last day and the arrow offers the next thirty days, again and again to the
 * end of the year. The calendar is still there for jumping straight to a date.
 * Both move the window by asking the server for a different thirty days
 * (`/timetable?date=…`), so a member can book any day inside a year and the page
 * is a third of the size it was.
 *
 * The two are kept side by side because the failure mode is them disagreeing: a
 * generator behind the window shows a strip whose last fortnight is quietly
 * empty.
 */
export const BOOKING_HORIZON_DAYS = 365;

/** How many days of that horizon the date strip shows at once. */
export const TIMETABLE_DAYS = 30;

/**
 * The horizon in the weeks `generateSessions` counts in.
 *
 * Deliberately derived from the *booking* horizon, not the window: classes have
 * to exist as far ahead as anybody can book, which is a year, even though only
 * ninety days of them are ever on screen together.
 */
export const TIMETABLE_WEEKS = Math.ceil(BOOKING_HORIZON_DAYS / 7);
