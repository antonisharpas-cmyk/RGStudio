import { NextResponse } from "next/server";
import { desk } from "@/lib/api-guard";
import { activeInstructors, daySessions, upcomingAppointments } from "@/lib/admin";

/**
 * One day's classes with their rosters.
 *
 * Any date, not only today: the desk is as often answering "who is in on
 * Saturday" as it is checking people in this morning.
 */
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const asked = new URL(req.url).searchParams.get("date");
  if (asked && !DAY.test(asked)) {
    return NextResponse.json({ error: "BAD_DAY" }, { status: 400 });
  }

  /* Midday keeps the parse inside the intended calendar day whatever the
     server's own timezone is; studioStartOfDay then anchors it to Larnaca. */
  const day = asked ? new Date(`${asked}T12:00:00Z`) : new Date();
  const [sessions, appointments, instructors] = await Promise.all([
    daySessions(day),
    /* Sent with every day, not only today. It is the same three weeks whichever
       date is on screen, it is small, and it is the thing on this screen that
       somebody has to act on. Making it a second request would mean a second
       loading state for a list of four rows. */
    upcomingAppointments(),
    /* The picker's options, sent with the day rather than fetched separately.
       Four names is smaller than the request that would ask for them. */
    activeInstructors(),
  ]);

  return NextResponse.json({
    date: asked,
    sessions: sessions.map((s) => ({
      ...s,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
    appointments: appointments.map((a) => ({
      ...a,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
    })),
    instructors,
  });
}
