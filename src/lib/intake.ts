import { studioWallTimeToInstant } from "./time";

/**
 * What the studio asks a new member before they train, in one place.
 *
 * Three questions, asked once, straight after the emailed code: how much pilates
 * they have done, where they would put themselves, and whether there is anything
 * to be careful of. None of it is idle curiosity — five people on reformers with
 * one instructor means whoever is teaching has to know who is new and who has a
 * shoulder before the class starts, not during it.
 *
 * **They are asked, never required.** For a day they blocked booking, and the
 * shape of that was wrong: a member could read the whole site and then be
 * refused at the one moment they were trying to give the studio money. The
 * emailed code is the only mandatory step. These come with a way past them, and
 * skipping records nothing.
 *
 * The answers are the member's own and they can change them whenever they want,
 * which is the other reason they live on the account rather than in a form the
 * studio fills in: a condition that cleared up six months ago should not follow
 * somebody around, and only they know when it did.
 */

export const PILATES_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export type PilatesLevel = (typeof PILATES_LEVELS)[number];

/**
 * How long they have been doing pilates.
 *
 * Buckets rather than a number of years, because the honest answer to "how long
 * have you done pilates" is usually "on and off, a while", and a box demanding a
 * figure gets a made-up one. `NONE` is a real and common answer and is first for
 * that reason.
 */
export const PILATES_EXPERIENCE = [
  "NONE",
  "UNDER_6M",
  "UNDER_1Y",
  "ONE_TO_TWO",
  "OVER_TWO",
] as const;
export type PilatesExperience = (typeof PILATES_EXPERIENCE)[number];

export function isPilatesLevel(v: unknown): v is PilatesLevel {
  return typeof v === "string" && (PILATES_LEVELS as readonly string[]).includes(v);
}

export function isPilatesExperience(v: unknown): v is PilatesExperience {
  return (
    typeof v === "string" &&
    (PILATES_EXPERIENCE as readonly string[]).includes(v)
  );
}

/** How much somebody may write about a condition. Generous, but bounded. */
export const CONDITION_MAX_CHARS = 600;

/**
 * How much the desk may write about a member, in its own notes field.
 *
 * Three times the member's own box, because the use is different: a member
 * describes one thing once, while a staff note accretes over a year of classes
 * — "prefers the window reformer", "shoulder still stiff in March", "books for
 * her daughter too". Bounded anyway, because an unbounded text column is how a
 * database ends up with somebody's life story pasted into it.
 *
 * Here rather than in `reception.ts` for a mechanical reason worth knowing:
 * `MemberDesk` is a client component and this limit is the `maxLength` on its
 * textarea, so the constant has to come from a module the browser can be given.
 * `reception.ts` imports the database, which imports `better-sqlite3`, which
 * imports `node:fs` — and importing that into a client component fails the
 * build outright. This file has no such imports, and it is where the box next
 * to it already gets its limit from.
 */
export const STAFF_NOTES_MAX_CHARS = 2000;

/**
 * When the studio started asking.
 *
 * The instruction was that this is for new sign-ups: members who already had
 * accounts are not to be shown a new screen on their next visit. A date does
 * that on its own, and better than a flag would — an account created before this
 * moment is never sent to the welcome step, an account created after it is, and
 * there is no list of exceptions to maintain.
 *
 * Everybody can answer from their profile whenever they like, and the desk can
 * fill it in for anybody over the counter.
 */
export const INTAKE_REQUIRED_FROM = studioWallTimeToInstant(2026, 9, 2, 0, 0);

/**
 * Whether this account should still be *offered* the questions.
 *
 * Offered, not required. Answering them is optional: the emailed code is the
 * only mandatory step in signing up, and a member who skips these can book, pay
 * and cancel like anybody else. This decides who sees the welcome screen once,
 * and nothing else.
 *
 * Deliberately not "is `intakeAt` null". A member from July with no answers on
 * file is not in an incomplete state; they are in the state everybody was in
 * before the questions existed, and putting a new screen in front of them on
 * their next visit would be a change they never asked for.
 */
export function intakeRequired(user: {
  intakeAt?: Date | null;
  createdAt?: Date | null;
  role?: string | null;
}) {
  /* Staff accounts are not members and do not train. Asking the owner for their
     pilates level before they can open the console would be absurd. */
  if (user.role && user.role !== "MEMBER") return false;
  if (user.intakeAt) return false;
  if (!user.createdAt) return false;
  return user.createdAt.getTime() >= INTAKE_REQUIRED_FROM.getTime();
}

/** Where a member with unanswered questions is sent, carrying their destination. */
export function intakePath(next?: string | null) {
  const to = next && /^\/[^/\\]/.test(next) ? next : "/timetable";
  return `/welcome?next=${encodeURIComponent(to)}`;
}
