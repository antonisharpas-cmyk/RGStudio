import { NextResponse } from "next/server";
import { currentUser, isStaff } from "@/lib/auth";
import { dueReminders, markSent } from "@/lib/reminders";

/**
 * The reminders that are due to go out.
 *
 * To be clear about what this is and is not: **nothing here sends a message**.
 * No email or SMS provider is configured in this project, so wiring a sender
 * would mean inventing credentials the studio has not given. What exists is the
 * queue, correctly scheduled and correctly emptied — GET tells a sender what is
 * owed, POST closes the rows once it has delivered them.
 *
 * To finish the feature, point a scheduler (cron, a platform scheduled job)
 * at GET every few minutes, hand each row to Resend / Twilio / a push service,
 * then POST back the ids that went out. Until then the queue simply grows and
 * is visible to staff, which is honest and inspectable.
 *
 * Staff only, and additionally by shared secret when REMINDER_CRON_SECRET is
 * set, so a scheduler can call it without a session.
 */
function authorised(req: Request, staff: boolean) {
  if (staff) return true;
  const secret = process.env.REMINDER_CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!authorised(req, isStaff(user))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const due = dueReminders();
  return NextResponse.json({
    ok: true,
    count: due.length,
    /* Said plainly in the payload too, so nobody integrating against this
       assumes a message already went out. */
    delivery: "NOT_CONFIGURED",
    reminders: due.map((r) => ({
      id: r.id,
      bookingId: r.bookingId,
      dueAt: r.dueAt.toISOString(),
      startsAt: r.startsAt.toISOString(),
      channels: r.channels.split(","),
      name: r.userName,
      email: r.userEmail,
      phone: r.userPhone,
    })),
  });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!authorised(req, isStaff(user))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body!.ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "NO_IDS" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, marked: markSent(ids) });
}
