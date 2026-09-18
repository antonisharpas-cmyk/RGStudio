import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function euro(cents: number) {
  return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Hours before a class starts when cancellation closes. Cancel before this and
 * the session returns to the member's balance; after it the booking is locked,
 * because the reformer is held and the class is capped at five.
 */
export const FREE_CANCELLATION_HOURS = 12;
/**
 * Minutes before class start when booking closes.
 *
 * One, because the studio's rule is that the only reasons you cannot book are
 * that the day is closed or the class is full. It used to be thirty, which shut
 * an empty 19:00 class at 18:30 and read as a fault rather than a policy.
 *
 * One rather than zero so a booking cannot land in the same second the class
 * begins: a 19:00 class takes bookings until 18:58:59 and closes at 18:59:00.
 */
export const BOOKING_CUTOFF_MINUTES = 1;

export function isFreeCancellation(startsAt: Date, now = new Date()) {
  return (
    startsAt.getTime() - now.getTime() >
    FREE_CANCELLATION_HOURS * 60 * 60 * 1000
  );
}

export function isBookable(startsAt: Date, now = new Date()) {
  return (
    startsAt.getTime() - now.getTime() > BOOKING_CUTOFF_MINUTES * 60 * 1000
  );
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based start of week */
export function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(x, diff);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Local-time YYYY-MM-DD key (never shifts day the way toISOString can). */
export function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
