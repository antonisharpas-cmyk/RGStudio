import { NextResponse } from "next/server";
import { owner } from "@/lib/api-guard";
import { studioStats } from "@/lib/admin";

/**
 * The front-screen numbers over a chosen period.
 *
 *   /api/admin/stats                          all time
 *   /api/admin/stats?from=2026-08-01          from that day onwards
 *   /api/admin/stats?from=…&to=…              both ends, both inclusive
 *
 * A malformed date is not an error, it is simply not a bound: the desk gets all
 * time rather than an error page where its takings should be. The range that was
 * actually applied comes back in the answer, so the screen can label the cards
 * with the period it really got instead of the one it asked for.
 */
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | null) => (v && DAY.test(v) ? v : null);

export async function GET(req: Request) {
  /* The owner's, not reception's: members and takings are the studio's
     business, and the desk stands in a public room. */
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const q = new URL(req.url).searchParams;
  let from = clean(q.get("from"));
  let to = clean(q.get("to"));

  /* A backwards range is a slip of the hand, not a request for nothing. Read it
     the way it was obviously meant. */
  if (from && to && from > to) [from, to] = [to, from];

  return NextResponse.json({
    from,
    to,
    stats: await studioStats({ from, to }),
  });
}
