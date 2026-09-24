import { NextResponse } from "next/server";
import { owner } from "@/lib/api-guard";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, listTeam, removePhoto, savePhoto } from "@/lib/team";

/**
 * Upload or remove an instructor's portrait. Owner only.
 *
 * POST multipart: `id` and `photo` (JPEG, PNG or WebP, resized in the browser
 * first). DELETE ?id= takes it off.
 */
export const dynamic = "force-dynamic";

const MAGIC: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const form = await req.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const file = form?.get("photo");
  if (!id || !(file instanceof File)) {
    return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  }
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: "PHOTO_TYPE" }, { status: 400 });
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: "PHOTO_TOO_LARGE" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const sig = MAGIC[file.type]!;
  if (!sig.every((b, i) => buf[i] === b)) {
    return NextResponse.json({ error: "PHOTO_TYPE" }, { status: 400 });
  }

  const result = savePhoto(id, file.type, buf);
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 404 });
  return NextResponse.json({ ok: true, member: result.member, team: listTeam() });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const result = removePhoto(id);
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 404 });
  return NextResponse.json({ ok: true, member: result.member, team: listTeam() });
}
