import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { assignInstructor } from "@/lib/reception";

/**
 * Who is teaching one class.
 *
 * One class rather than the weekly template, which is the point: the rota says
 * Elena has Tuesdays at 18:00, and this Tuesday Elena is ill. See
 * lib/reception.ts for when the members booked into it are told.
 *
 * `instructorId: null` clears the slot, which is how a midday appointment starts
 * life and how a mistake is undone.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{
    sessionId?: string;
    instructorId?: string | null;
  }>(req);

  if (!data?.sessionId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = await assignInstructor({
    sessionId: data.sessionId,
    instructorId: data.instructorId ?? null,
    staffName: gate.user.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  return NextResponse.json(result);
}
