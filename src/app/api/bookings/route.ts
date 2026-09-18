import { NextResponse } from "next/server";
import { bookClass, countMyBookings, listMyBookings } from "@/lib/booking";
import { notVerified } from "@/lib/api-guard";
import { currentUser } from "@/lib/auth";
import { getAvailableCredits } from "@/lib/credits";
import { notifyBooked, nudgeReminders } from "@/lib/messaging/events";
import { scheduleReminder } from "@/lib/reminders";
import { bookSchema } from "@/lib/validation";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  /* Any page view is a chance to push the reminder queue along, in case the
     scheduled sweep is not running. Never awaited. */
  nudgeReminders();
  const bookings = await listMyBookings(user.id);
  return NextResponse.json({
    ...bookings,
    credits: await getAvailableCredits(user.id),
  });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  /* An account whose email has never been confirmed cannot take a place in a
     class. The seat is real and finite, and the studio has no way to tell the
     holder it has moved. */
  const stop = notVerified(user);
  if (stop) return stop;

  /**
   * The three welcome questions are NOT checked here, on purpose.
   *
   * They were for a day. The gate did what a gate does: a member who skipped
   * past the questions could read the whole site and then be refused at the one
   * moment they were trying to give the studio money, which is the worst
   * possible place to put an obstacle. The studio's decision, and it is the
   * right one: the emailed code is the only mandatory step, and everything
   * after it is an invitation.
   *
   * The answers are still asked for straight after the code, still editable in
   * the member's profile, and still fillable by the desk. They are simply not a
   * condition of using the site. If that is ever revisited, `notOnboarded` in
   * lib/api-guard.ts is the check and this is where it went.
   */

  const parsed = bookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = bookClass(user.id, parsed.data.sessionId, {
    guestName: parsed.data.guestName ?? null,
  });
  if (!result.ok) {
    /* The three "you are holding the wrong kind of session" answers are 402
       alongside NO_CREDITS, because from the client's point of view they are the
       same class of problem: something has to be bought before this can work. */
    const needsPayment =
      result.code === "NO_CREDITS" ||
      result.code === "NEEDS_PERSONAL_CREDIT" ||
      result.code === "NEEDS_DUET_CREDIT" ||
      result.code === "DUET_IS_FOR_TWO";
    return NextResponse.json(
      {
        error: result.code,
        credits: await getAvailableCredits(user.id),
        /* Only ever set on SESSIONS_EXPIRE_FIRST, where the refusal is only
           useful if it can name the last date that would have worked. */
        until: result.until?.toISOString(),
      },
      { status: needsPayment ? 402 : 409 },
    );
  }

  /* Queue the reminder outside the booking transaction: a reminder that fails
     to schedule must never cost someone their booking. */
  let reminderAt: string | null = null;
  try {
    reminderAt = scheduleReminder(result.bookingId)?.dueAt.toISOString() ?? null;
  } catch {
    reminderAt = null;
  }

  /* The confirmation goes out on its own time. Deliberately not awaited: a
     push service being slow must not make the member wait to see their booking,
     and a push that fails must not read as a booking that failed. */
  void notifyBooked(result.bookingId).catch(() => {});

  return NextResponse.json({
    ok: true,
    bookingId: result.bookingId,
    reminderAt,
    credits: await getAvailableCredits(user.id),
    /* True only when this is the member's first ever booking, for the one-time
       "top up your sessions" nudge on the timetable. Read after the booking is
       written, so the row it created is counted. */
    firstBooking: countMyBookings(user.id) === 1,
  });
}
