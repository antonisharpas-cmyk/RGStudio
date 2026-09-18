import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { bookingReminders, bookings, classSessions, users } from "@/db/schema";
import { REMINDER_STEP_MINUTES, isValidReminderMinutes } from "./profile";

/**
 * Booking reminders: scheduling and the due queue.
 *
 * This module decides *when* a member should be reminded and on which channels,
 * and nothing else. It does not send: `dueReminders()` hands the list over and
 * `markSent()` closes the rows once somebody has. The sending lives in
 * src/lib/messaging/events.ts, which is also where the studio's own limit on
 * which channels an automatic message may use is applied.
 *
 * The lead time is copied onto the row when the reminder is scheduled rather
 * than read from the member at send time. If someone changes their preference
 * from two hours to ten minutes, classes they have already booked keep the
 * reminder they were promised; only new bookings use the new setting.
 */

export type ReminderChannels = {
  email: boolean;
  sms: boolean;
  push: boolean;
};

function activeChannels(u: {
  notifyEmail: boolean;
  notifySms: boolean;
  notifyPush: boolean;
}): string[] {
  const out: string[] = [];
  if (u.notifyEmail) out.push("email");
  if (u.notifySms) out.push("sms");
  if (u.notifyPush) out.push("push");
  return out;
}

/**
 * Queue the reminder for a booking. Safe to call twice: the booking id is
 * unique in the table, so a re-book replaces rather than duplicates.
 *
 * Returns the row, or null when there is nothing to schedule — reminders off,
 * every channel muted, or the lead time already passed.
 */
export function scheduleReminder(bookingId: string, now = new Date()) {
  const booking = db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .get();
  if (!booking) return null;

  const user = db
    .select()
    .from(users)
    .where(eq(users.id, booking.userId))
    .get();
  const session = db
    .select()
    .from(classSessions)
    .where(eq(classSessions.id, booking.sessionId))
    .get();
  if (!user || !session) return null;

  const lead = user.reminderMinutes;
  if (lead === null || !isValidReminderMinutes(lead)) return null;

  const channels = activeChannels(user);
  if (channels.length === 0) return null;

  const dueAt = new Date(session.startsAt.getTime() - lead * 60_000);
  /* A class booked inside its own lead time gets no reminder: sending one
     immediately, or worse for a time already past, is noise. */
  if (dueAt.getTime() <= now.getTime()) return null;

  cancelReminder(bookingId);

  return db
    .insert(bookingReminders)
    .values({
      bookingId,
      userId: user.id,
      dueAt,
      channels: channels.join(","),
    })
    .returning()
    .get();
}

/** Drop a booking's reminder. Called on cancellation. */
export function cancelReminder(bookingId: string) {
  return db
    .delete(bookingReminders)
    .where(eq(bookingReminders.bookingId, bookingId))
    .run().changes;
}

/** Reminders that are due and not yet sent, oldest first. */
export function dueReminders(now = new Date(), limit = 200) {
  return db
    .select({
      id: bookingReminders.id,
      bookingId: bookingReminders.bookingId,
      dueAt: bookingReminders.dueAt,
      channels: bookingReminders.channels,
      userId: bookingReminders.userId,
      userName: users.name,
      userEmail: users.email,
      userPhone: users.phone,
      /* Read now rather than looked up per row when the sweep composes the
         message. A sweep is up to 200 rows and this is one join column. */
      userLocale: users.locale,
      startsAt: classSessions.startsAt,
    })
    .from(bookingReminders)
    .innerJoin(users, eq(bookingReminders.userId, users.id))
    .innerJoin(bookings, eq(bookingReminders.bookingId, bookings.id))
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .where(
      and(isNull(bookingReminders.sentAt), lte(bookingReminders.dueAt, now)),
    )
    .orderBy(asc(bookingReminders.dueAt))
    .limit(limit)
    .all();
}

export function markSent(ids: string[], now = new Date()) {
  let n = 0;
  for (const id of ids) {
    n += db
      .update(bookingReminders)
      .set({ sentAt: now })
      .where(and(eq(bookingReminders.id, id), isNull(bookingReminders.sentAt)))
      .run().changes;
  }
  return n;
}

/** Re-queue reminders after a member changes their lead time or channels. */
export function rescheduleUpcoming(userId: string, now = new Date()) {
  const upcoming = db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .where(and(eq(bookings.userId, userId), eq(bookings.status, "CONFIRMED")))
    .all()
    .filter(() => true);

  let scheduled = 0;
  for (const b of upcoming) {
    cancelReminder(b.id);
    if (scheduleReminder(b.id, now)) scheduled++;
  }
  return scheduled;
}

export { REMINDER_STEP_MINUTES };
