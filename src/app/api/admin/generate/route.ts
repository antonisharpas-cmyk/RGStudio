import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import { generateSessions, removeGeneratedSessions } from "@/lib/schedule";
import { generateSchema, MAX_GENERATE_WEEKS } from "@/lib/validation";

/**
 * Rolls the weekly rota forward, and takes one roll-forward back.
 *
 * Behind the desk lock. DELETE undoes a run by the ids it created — see
 * removeGeneratedSessions, which refuses to remove a class somebody has booked.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  /**
   * An out-of-range request is refused, not quietly rewritten.
   *
   * This used to fall back to six weeks whenever the schema rejected the body,
   * and answer `ok: true`. So asking for seventy weeks generated six, created
   * nothing new, and reported success — which is exactly how a test asserting
   * "it rolls forward" passed while asserting nothing at all. A caller that
   * asked for something impossible needs to be told, not accommodated.
   *
   * A missing or unparseable body still means the old default: pressing the
   * button with nothing to say is a request for a sensible amount.
   */
  const raw = await req.json().catch(() => ({ weeks: 6 }));
  const parsed = generateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "BAD_WEEKS", maxWeeks: MAX_GENERATE_WEEKS },
      { status: 400 },
    );
  }

  const result = generateSessions(parsed.data.weeks);
  return NextResponse.json({ ok: true, ...result });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const data = await body<{ ids?: string[] }>(req);
  const ids = (data?.ids ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0 || ids.length > 5000) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, ...removeGeneratedSessions(ids) });
}
