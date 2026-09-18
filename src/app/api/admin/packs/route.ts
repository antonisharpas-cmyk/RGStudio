import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import { createPack, listPacks, updatePack, type PackPatch } from "@/lib/catalogue-desk";

/**
 * The packs on sale, from the desk. The owner's alone.
 *
 * GET lists every pack, on sale or not. POST creates one. PATCH edits any of
 * name, sessions, validity, list price, heading, or whether it is on sale. A
 * pack is never deleted: switch it off instead, so members who bought it keep
 * a record of what they bought.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  return NextResponse.json({ packs: listPacks() });
}

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const data = await body<PackPatch>(req);
  if (!data) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  const result = createPack(data);
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 });
  return NextResponse.json({ ok: true, pack: result.pack, packs: listPacks() });
}

export async function PATCH(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const data = await body<PackPatch & { id?: string }>(req);
  if (!data?.id) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  const { id, ...patch } = data;
  const result = updatePack(id, patch);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code },
      { status: result.code === "NOT_FOUND" ? 404 : 400 },
    );
  }
  return NextResponse.json({ ok: true, pack: result.pack, packs: listPacks() });
}
