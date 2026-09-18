/**
 * A class's level: who it is aimed at, said as a label and nothing more.
 *
 * Four values. `ALL` is "all levels", the default the whole timetable launched
 * with, and what a null column reads as. It is deliberately not a booking rule:
 * a member is never refused a class because of their own level. The studio sets
 * it so members can choose a class that suits them, and so a beginners' hour can
 * be named as one.
 */
export const CLASS_LEVELS = ["ALL", "BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

export type ClassLevel = (typeof CLASS_LEVELS)[number];

export function isClassLevel(v: unknown): v is ClassLevel {
  return typeof v === "string" && (CLASS_LEVELS as readonly string[]).includes(v);
}

/** A stored value turned into a level, with anything unknown or absent read as ALL. */
export function classLevel(v: unknown): ClassLevel {
  return isClassLevel(v) ? v : "ALL";
}
