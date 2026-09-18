/**
 * The rules behind a member's own profile.
 *
 * Kept apart from the routes so the form, the API and the tests all agree on
 * one set of numbers rather than three copies that drift.
 */

/** Reminder lead time is chosen in half-hour steps, up to twelve hours. */
export const REMINDER_MIN_MINUTES = 0;
export const REMINDER_MAX_MINUTES = 720;
export const REMINDER_STEP_MINUTES = 30;
/** What a new member gets until they say otherwise: two hours before class. */
export const REMINDER_DEFAULT_MINUTES = 120;

export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_EDGE_PX = 512;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Sensible human bounds, wide enough not to argue with anyone. */
export const HEIGHT_MIN_CM = 100;
export const HEIGHT_MAX_CM = 250;
export const WEIGHT_MIN_KG = 30;
export const WEIGHT_MAX_KG = 250;
/** Under-16s train with a parent present, which is a conversation, not a form. */
export const MIN_AGE_YEARS = 16;
export const MAX_AGE_YEARS = 100;

export function isValidReminderMinutes(n: number) {
  return (
    Number.isInteger(n) &&
    n >= REMINDER_MIN_MINUTES &&
    n <= REMINDER_MAX_MINUTES &&
    n % REMINDER_STEP_MINUTES === 0
  );
}

/** Every value the slider is allowed to stop on. */
export function reminderChoices() {
  const out: number[] = [];
  for (
    let m = REMINDER_MIN_MINUTES;
    m <= REMINDER_MAX_MINUTES;
    m += REMINDER_STEP_MINUTES
  ) {
    out.push(m);
  }
  return out;
}

/** "0 min" reads as nothing; at zero the reminder lands as the class starts. */
export function formatLeadTime(
  minutes: number,
  locale: string = "en",
): string {
  if (minutes === 0) {
    if (locale === "el") return "Στην ώρα του";
    if (locale === "ru") return "К началу класса";
    return "At class time";
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hUnit = locale === "el" ? "ώ" : locale === "ru" ? "ч" : "h";
  const mUnit = locale === "ru" ? "мин" : "min";
  if (h === 0) return `${m} ${mUnit}`;
  if (m === 0) return `${h} ${hUnit}`;
  return `${h} ${hUnit} ${m} ${mUnit}`;
}

/* Weight is stored in grams so a decimal like 62.5 kg survives a round trip
   without floating-point drift in the database. */
export const kgToGrams = (kg: number) => Math.round(kg * 1000);
export const gramsToKg = (g: number) => Math.round(g / 100) / 10;

/** YYYY-MM-DD, validated as a real calendar date. */
export function parseBirthDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m! - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/** Age in whole years, from a YYYY-MM-DD string. */
export function ageFromBirthDate(
  value: string,
  today = new Date(),
): number | null {
  const born = parseBirthDate(value);
  if (!born) return null;
  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const hadBirthday =
    today.getUTCMonth() > born.getUTCMonth() ||
    (today.getUTCMonth() === born.getUTCMonth() &&
      today.getUTCDate() >= born.getUTCDate());
  if (!hadBirthday) age -= 1;
  return age;
}
