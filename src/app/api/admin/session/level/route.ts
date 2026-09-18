import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { setClassLevel } from "@/lib/reception";

/**
 * The level a class is aimed at.
 *
 * `desk()` because it is an ordinary front-of-house edit, the same reach as
 * assigning an instructor or cancelling a class. `applyToUpcoming` is the answer
 * to the dialog the console shows: false changes this one class, true changes
 * the recurring slot from today on. See `setClassLevel` for the rules.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{
    sessionId?: string;
    level?: string;
    applyToUpcoming?: boolean;
  }>(req);

  if (!data?.sessionId || typeof data.level !== "string") {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = setClassLevel({
    sessionId: data.sessionId,
    level: data.level,
    applyToUpcoming: Boolean(data.applyToUpcoming),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  return NextResponse.json(result);
}
