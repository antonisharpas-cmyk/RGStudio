import { NextResponse } from "next/server";
import { body, verified } from "@/lib/api-guard";
import { markRead, unreadCount } from "@/lib/notices";

/** A member marking one notice read, or all of them. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await verified();
  if ("res" in gate) return gate.res;

  const data = await body<{ noticeId?: string }>(req);
  const marked = markRead(gate.user.id, data?.noticeId);

  return NextResponse.json({
    ok: true,
    marked,
    unread: unreadCount(gate.user.id),
  });
}
