import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import {
  createPromoCode,
  deletePromoCode,
  listPromoCodes,
  setPromoActive,
} from "@/lib/promo-codes";
import { studioEndOfDay, studioWallTimeToInstant } from "@/lib/time";

/**
 * Promo codes, from the desk. The owner's alone, like the price list.
 *
 * Dates arrive as `YYYY-MM-DD` from a date field and are read as the start of
 * that day (valid from) and the end of it (valid until), in the studio's own
 * calendar, so "until 31 October" includes the 31st.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  return NextResponse.json({ codes: listPromoCodes() });
}

function dayStart(s?: string | null) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  return studioWallTimeToInstant(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0);
}
function dayEnd(s?: string | null) {
  const start = dayStart(s);
  return start ? studioEndOfDay(start) : start;
}

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const data = await body<{
    code?: string;
    kind?: "PERCENT" | "FLAT";
    value?: number;
    packageId?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
    maxUses?: number | null;
  }>(req);
  if (!data?.code) return NextResponse.json({ error: "BAD_CODE" }, { status: 400 });

  const from = dayStart(data.validFrom);
  const until = dayEnd(data.validUntil);
  if (from === undefined || until === undefined) {
    return NextResponse.json({ error: "BAD_DATES" }, { status: 400 });
  }

  const result = createPromoCode({
    code: data.code,
    kind: data.kind === "FLAT" ? "FLAT" : "PERCENT",
    value: Number(data.value),
    packageId: data.packageId || null,
    validFrom: from,
    validUntil: until,
    maxUses: data.maxUses ? Number(data.maxUses) : null,
    staffId: gate.user.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 });
  return NextResponse.json({ ok: true, code: result.code, codes: listPromoCodes() });
}

export async function PATCH(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const data = await body<{ id?: string; active?: boolean }>(req);
  if (!data?.id || typeof data.active !== "boolean") {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const changed = setPromoActive(data.id, data.active);
  if (!changed) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, codes: listPromoCodes() });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  const changed = deletePromoCode(id);
  if (!changed) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, codes: listPromoCodes() });
}
