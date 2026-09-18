import { NextResponse } from "next/server";
import { desk } from "@/lib/api-guard";
import { findMembers, memberDetail } from "@/lib/reception";

/**
 * Search the membership, or read one member in full with ?id=.
 *
 * The studio's own accounts are in the list for everybody at the desk, so
 * reception can see who works here and put sessions on a colleague's account.
 * What reception cannot do to those accounts is change them: the password and
 * contact routes still refuse a non owner for any desk account.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const detail = await memberDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ member: detail });
  }

  const asked = url.searchParams.get("filter");
  const filter =
    asked === "test" || asked === "real" ? asked : ("all" as const);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);

  const found = await findMembers(url.searchParams.get("q") ?? "", {
    includeDesk: true,
    filter,
    page,
  });

  return NextResponse.json({
    /* `members` is the rows, as it always was, with the paging alongside. */
    members: found.rows,
    total: found.total,
    page: found.page,
    pages: found.pages,
    counts: found.counts,
    filter,
  });
}
