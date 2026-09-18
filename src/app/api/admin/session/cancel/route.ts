import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { cancelSession, restoreSession } from "@/lib/closures";
import { notifyCancelled } from "@/lib/messaging/events";

/**
 * Call off one class, from the desk.
 *
 * The studio is opening late, closing early, or a reformer is down for the
 * morning: one hour has to come off the timetable and the people booked into it
 * put back where they were. Unlike closing a whole day, which is the owner's
 * call, this is a `desk()` action — an instructor reporting the fault is the
 * ordinary way it starts. See `cancelSession` for the rules; they are the
 * day-closure's rules applied to a single slot.
 *
 * Every affected member is told, after the cancellation has committed, that
 * their class is off and their session is back. Fired and not awaited, exactly
 * as a booking's own cancellation is: the refund is already done in the
 * database, and a slow mail server must not hold up the desk's next action.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{ sessionId?: string }>(req);
  if (!data?.sessionId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = cancelSession({ sessionId: data.sessionId });
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }

  for (const a of result.affected) {
    void notifyCancelled(a.bookingId, true).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    sessionId: result.sessionId,
    refunded: result.refunded,
  });
}

/**
 * Undo a cancellation: put the class back on the timetable.
 *
 * A DELETE on the cancellation rather than on the class — the class is not being
 * removed, its "off" state is. Same `desk()` reach as the cancel above, because
 * whoever can take an hour off can put it back. The members who were refunded
 * are not re-booked (see restoreSession), so there is nobody to tell: the hour
 * simply becomes bookable again.
 */
export async function DELETE(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = restoreSession({ sessionId });
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }

  return NextResponse.json({ ok: true, sessionId: result.sessionId });
}
