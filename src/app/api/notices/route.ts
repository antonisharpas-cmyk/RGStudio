import { NextResponse } from "next/server";
import { member } from "@/lib/api-guard";
import { noticesFor, unreadCount } from "@/lib/notices";

/**
 * The member's own notices.
 *
 * Only what they are allowed to see: studio and timetable notices always, and
 * offers only if they accepted offers — checked on the way out, so withdrawing
 * that consent hides the ones already sent rather than leaving them sitting
 * there.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await member();
  if ("res" in gate) return gate.res;

  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "el" ? "el" : "en";

  const asked = url.searchParams.get("filter");
  const filter =
    asked === "unread" || asked === "read" ? asked : ("all" as const);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);

  const result = noticesFor(gate.user.id, locale, { filter, page });

  return NextResponse.json({
    ...result,
    /* Kept as `notices` as well as `rows` so nothing that reads the old shape
       breaks on the way past. */
    notices: result.rows.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    rows: result.rows.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    filter,
    unread: unreadCount(gate.user.id),
  });
}
