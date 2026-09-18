import { NextResponse } from "next/server";
import { body, desk } from "@/lib/api-guard";
import { isOwner } from "@/lib/auth";
import { isDeskAccount, sellSessions } from "@/lib/reception";

/**
 * Sessions sold at the desk, or taken back.
 *
 * Positive credits with a method of cash or card_at_desk record a payment as
 * well as the sessions, so the takings add up. "adjustment" moves the balance
 * without pretending money changed hands.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const data = await body<{
    userId?: string;
    credits?: number;
    validityDays?: number;
    amountCents?: number;
    method?: "cash" | "card_at_desk" | "adjustment";
    note?: string;
    kind?: "CLASS" | "PERSONAL" | "DUET";
  }>(req);

  if (!data?.userId || typeof data.credits !== "number") {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

/* Reception acts for members, not for colleagues: only the owner may touch an
   account that can open this console. Otherwise the person at the counter could
   reset the owner's password and take the whole desk with it. */
  if (!isOwner(gate.user) && isDeskAccount(data.userId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const result = await sellSessions({
    userId: data.userId,
    credits: data.credits,
    validityDays: data.validityDays,
    amountCents: data.amountCents,
    method: data.method,
    note: data.note,
    staffId: gate.user.id,
    staffName: gate.user.name,
    /* Validated against the three names rather than passed through, so a
       malformed body cannot write a kind nothing knows how to spend. */
    kind:
      data.kind === "PERSONAL" || data.kind === "DUET" ? data.kind : "CLASS",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  return NextResponse.json(result);
}
