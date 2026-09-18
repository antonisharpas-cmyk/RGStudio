import { NextResponse } from "next/server";
import { notVerified } from "@/lib/api-guard";
import { currentUser } from "@/lib/auth";
import { cancelBooking } from "@/lib/booking";
import { getAvailableCredits } from "@/lib/credits";
import { notifyCancelled } from "@/lib/messaging/events";
import { cancelReminder } from "@/lib/reminders";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const stop = notVerified(user);
  if (stop) return stop;

  const body = (await req.json().catch(() => null)) as {
    bookingId?: string;
    /**
     * The member has read "your session will not be refunded" and pressed yes.
     *
     * Absent, a booking past the free window is refused with
     * TOO_LATE_TO_CANCEL exactly as before — which is what the screen uses to
     * decide whether to ask the question at all. Present, the cancel goes
     * through and the session is kept by the studio.
     *
     * It cannot be used to *avoid* a refund inside the window: `cancelBooking`
     * refunds whenever the window is open, whatever this says. See the note
     * there.
     */
    forfeit?: boolean;
  } | null;
  if (!body?.bookingId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = cancelBooking(user.id, body.bookingId, new Date(), {
    forfeit: body.forfeit === true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 409 });
  }

  /* The class is no longer booked, so the reminder is no longer owed. */
  cancelReminder(body.bookingId);

  /* Told before the row is forgotten, and told whether the session came back —
     that is the part a member actually wants confirmed. */
  void notifyCancelled(body.bookingId, result.refunded).catch(() => {});

  return NextResponse.json({
    ok: true,
    refunded: result.refunded,
    credits: await getAvailableCredits(user.id),
  });
}
