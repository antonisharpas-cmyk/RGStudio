import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import {
  bookForMember,
  cancelForMember,
  repeatForMember,
} from "@/lib/reception";
import { MAX_REPEAT_WEEKS } from "@/lib/booking-repeat";

/**
 * The desk's two ends of a booking.
 *
 * POST cancels one, PUT creates one. Splitting them by method rather than by
 * route because they are the same object from the same screen, and a desk that
 * can cancel from one place and book from another is a desk where somebody
 * eventually cancels the wrong class looking for the booking button.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{
    bookingId?: string;
    refund?: boolean;
    note?: string;
  }>(req);

  if (!data?.bookingId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = await cancelForMember({
    bookingId: data.bookingId,
    refund: data.refund !== false,
    note: data.note,
    staffName: gate.user.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  return NextResponse.json(result);
}

/**
 * Book a class for a member, over the telephone. One week, or a term of them.
 *
 * Every rule the member's own screen applies, applied here: the session comes
 * out of the package that expires soonest, a group session cannot buy a noon
 * appointment, a full class is full, and a member with nothing left is refused
 * rather than booked for free. See `bookForMember` for why that last one is not
 * negotiable.
 *
 * `weeks` turns it into a run of the same slot — same class, same weekday, same
 * hour — which is what a member asking reception for "every Monday until
 * Christmas" wants. One route rather than two, for the reason at the top of this
 * file: it is the same object from the same screen, and one press away from each
 * other in the console.
 *
 * A run answers **200 with a summary even when some weeks failed**, and that is
 * the deliberate part. Eight weeks where the fourth is full is seven good
 * bookings and one fact to read back down the telephone; throwing all seven away
 * to return a clean error would be worse for everybody, and booking seven while
 * saying nothing about the eighth would be worse still.
 *
 * The refusal codes go back untranslated so the console can say the useful
 * sentence: "no sessions left" and "that class is full" send the person at the
 * desk in completely different directions.
 */
export async function PUT(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{
    sessionId?: string;
    userId?: string;
    guestName?: string | null;
    /** Two or more turns this into a run of the same slot. Absent means one. */
    weeks?: number;
  }>(req);

  if (!data?.sessionId || !data.userId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const weeks = Number(data.weeks ?? 1);
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS) {
    return NextResponse.json(
      { error: "BAD_WEEKS", maxWeeks: MAX_REPEAT_WEEKS },
      { status: 400 },
    );
  }

  if (weeks > 1) {
    const run = await repeatForMember({
      sessionId: data.sessionId,
      userId: data.userId,
      weeks,
      staffName: gate.user.name,
    });
    if (!run.ok) {
      return NextResponse.json({ error: run.code }, { status: 400 });
    }
    return NextResponse.json(run);
  }

  const result = await bookForMember({
    sessionId: data.sessionId,
    userId: data.userId,
    guestName: data.guestName ?? null,
    staffName: gate.user.name,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, until: result.until?.toISOString() },
      { status: 400 },
    );
  }
  return NextResponse.json(result);
}
