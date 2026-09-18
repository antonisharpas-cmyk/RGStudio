import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import { closeDay, reopenDay, upcomingClosures } from "@/lib/closures";

/**
 * Days the studio is shut.
 *
 * Closing one cancels every class on it and puts the sessions back on the
 * members' accounts, then answers with the list of who was affected so the desk
 * can tell them — by phone, or with a notice from the Notices tab.
 */
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  return NextResponse.json({ closures: upcomingClosures() });
}

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const data = await body<{
    day?: string;
    reasonEn?: string;
    reasonEl?: string;
  }>(req);

  if (!data?.day || !DAY.test(data.day)) {
    return NextResponse.json({ error: "BAD_DAY" }, { status: 400 });
  }

  const result = closeDay({
    day: data.day,
    reasonEn: (data.reasonEn ?? "").trim(),
    reasonEl: (data.reasonEl ?? "").trim(),
    staffId: gate.user.id,
  });

  return NextResponse.json({
    ok: true,
    ...result,
    affected: result.affected.map((a) => ({
      ...a,
      startsAt: a.startsAt.toISOString(),
    })),
  });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const day = new URL(req.url).searchParams.get("day");
  if (!day || !DAY.test(day)) {
    return NextResponse.json({ error: "BAD_DAY" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...reopenDay(day) });
}
