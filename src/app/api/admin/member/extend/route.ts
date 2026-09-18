import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { extendBatch } from "@/lib/credits";

/**
 * More time on a member's sessions. Any desk account may do this: it is the
 * kind of favour reception grants at the counter, and it moves no money.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{ userId?: string; batchId?: string; days?: number }>(req);
  if (!data?.userId || !data.batchId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = extendBatch({
    userId: data.userId,
    batchId: data.batchId,
    days: Number(data.days),
    staffName: gate.user.name,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code },
      { status: result.code === "NOT_FOUND" ? 404 : 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    expiresAt: result.expiresAt.toISOString(),
    creditsRemaining: result.creditsRemaining,
  });
}
