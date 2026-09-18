import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import { activeRules, clearAllRules, clearRule, setRule } from "@/lib/pricing";

/**
 * The offer running on the price list.
 *
 * A rule with no packageId is the whole list; one with a packageId overrides it
 * for that pack. Setting a rule replaces any live rule on the same scope rather
 * than stacking on top of it, so two presses of "20% off" is still 20% off.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  return NextResponse.json({ rules: activeRules() });
}

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const data = await body<{
    packageId?: string | null;
    kind?: "PERCENT" | "FLAT";
    value?: number;
    labelEn?: string;
    labelEl?: string;
  }>(req);

  const kind = data?.kind === "FLAT" ? "FLAT" : "PERCENT";
  const value = Number(data?.value);

  /* Bounds that stop a slip of the finger giving the studio away: at most 90%
     off, and at most €500 off. */
  const sane =
    Number.isFinite(value) &&
    value > 0 &&
    (kind === "PERCENT" ? value <= 90 : value <= 50000);
  if (!sane) return NextResponse.json({ error: "BAD_VALUE" }, { status: 400 });

  setRule({
    packageId: data?.packageId ?? null,
    kind,
    value: Math.round(value),
    labelEn: data?.labelEn,
    labelEl: data?.labelEl,
    staffId: gate.user.id,
  });

  return NextResponse.json({ ok: true, rules: activeRules() });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const params = new URL(req.url).searchParams;
  if (params.get("all") === "1") {
    return NextResponse.json({ ok: true, cleared: clearAllRules(), rules: [] });
  }
  const packageId = params.get("packageId");
  return NextResponse.json({
    ok: true,
    cleared: clearRule(packageId ?? null),
    rules: activeRules(),
  });
}
