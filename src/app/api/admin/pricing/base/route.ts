import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import { resetListPrice, setListPrice } from "@/lib/pricing";

/**
 * A pack's list price, set by the owner. Distinct from the offer rules in the
 * parent route: this is the normal price, the number an offer discounts from.
 */
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const data = await body<{ packageId?: string; priceCents?: number }>(req);
  if (!data?.packageId) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const result = setListPrice(data.packageId, Number(data.priceCents));
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code },
      { status: result.code === "NOT_FOUND" ? 404 : 400 },
    );
  }
  return NextResponse.json({ ok: true, priceCents: result.priceCents });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const packageId = new URL(req.url).searchParams.get("packageId");
  if (!packageId) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  const changed = resetListPrice(packageId);
  if (!changed) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
