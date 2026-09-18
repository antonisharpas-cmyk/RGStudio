import { NextResponse } from "next/server";
import { notVerified } from "@/lib/api-guard";
import { currentUser } from "@/lib/auth";
import { MAX_REPEAT_WEEKS, repeatWeekly } from "@/lib/booking-repeat";
import { getAvailableCredits } from "@/lib/credits";
import { notifyRepeatBooked } from "@/lib/messaging/events";
import { scheduleReminder } from "@/lib/reminders";

/**
 * Book one weekly slot for several weeks at once.
 *
 * The studio sells three-month packs and members train on a fixed slot, so
 * booking a term of Mondays used to be twelve separate visits to the timetable.
 *
 * Answers 200 with a summary rather than an error when some weeks could not be
 * taken. That is not laxness: a run of twelve classes where the fourth is full
 * has eleven perfectly good bookings in it, and the useful answer names the one
 * that failed instead of throwing away the eleven. The caller shows the count
 * and the dates. Every individual booking still goes through the same rules as a
 * single one — see lib/booking-repeat.ts.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const stop = notVerified(user);
  if (stop) return stop;

  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown;
    weeks?: unknown;
  } | null;

  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const weeks = Number(body?.weeks);
  if (!sessionId || !Number.isFinite(weeks)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = repeatWeekly({ userId: user.id, sessionId, weeks });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, maxWeeks: MAX_REPEAT_WEEKS },
      { status: result.code === "SESSION_NOT_FOUND" ? 404 : 400 },
    );
  }

  /**
   * The reminders and the confirmations, once each booking is safely written.
   *
   * Outside the booking work and never allowed to fail it, exactly as the single
   * booking route does — a push service being slow must not turn eleven
   * successful bookings into an error on somebody's screen.
   *
   * A reminder per class and one confirmation for the run. The two are not the
   * same shape and should not be: a reminder is per class by definition, and a
   * confirmation is about the press. Twelve confirmations for one press is a
   * phone buzzing twelve times, which is how somebody learns to turn
   * notifications off.
   *
   * `notifyRepeatBooked` is given the whole run rather than the first booking,
   * because it used to be given the first booking and the message that came out
   * described one class out of twelve. See its own note.
   */
  for (const id of result.bookingIds) {
    try {
      scheduleReminder(id);
    } catch {
      /* A reminder that will not schedule must not cost somebody their class. */
    }
  }
  void notifyRepeatBooked(result).catch(() => {});

  return NextResponse.json({
    ok: true,
    booked: result.booked,
    alreadyHad: result.alreadyHad,
    /* Only what went wrong, and why, so the screen can name the dates. */
    failed: result.failed,
    credits: await getAvailableCredits(user.id),
  });
}
