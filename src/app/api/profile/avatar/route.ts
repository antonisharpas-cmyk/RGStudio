import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { notVerified } from "@/lib/api-guard";
import { db } from "@/db";
import { userAvatars } from "@/db/schema";
import { currentUser, isStaff } from "@/lib/auth";
import { AVATAR_MAX_BYTES, AVATAR_TYPES } from "@/lib/profile";

/**
 * The member's own profile photograph.
 *
 * The browser resizes and re-encodes before uploading (see ProfilePanel), so
 * what arrives here is already a small square JPEG. The server does not trust
 * that: it checks the declared type against the file's own magic bytes, caps
 * the size again, and stores the result as base64 in SQLite.
 *
 * Photographs are not public. GET serves your own, or anyone's if you are
 * studio staff, and nothing otherwise — a profile photo is personal data, and
 * a URL that guesses a user id should not be a way to enumerate faces.
 */

const MAGIC: Record<string, number[][]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  /* RIFF....WEBP — the middle four bytes are the length, so check either end. */
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
};

function looksLike(type: string, bytes: Uint8Array) {
  const sigs = MAGIC[type];
  if (!sigs) return false;
  const ok = sigs.some((sig) => sig.every((b, i) => bytes[i] === b));
  if (!ok) return false;
  if (type === "image/webp") {
    const tag = String.fromCharCode(...bytes.slice(8, 12));
    return tag === "WEBP";
  }
  return true;
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const target = new URL(req.url).searchParams.get("userId") ?? user.id;
  if (target !== user.id && !isStaff(user)) {
    return new NextResponse(null, { status: 403 });
  }

  const row = db
    .select()
    .from(userAvatars)
    .where(eq(userAvatars.userId, target))
    .get();
  if (!row) return new NextResponse(null, { status: 404 });

  const body = Buffer.from(row.data, "base64");
  return new NextResponse(body, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(body.byteLength),
      /* Private: it is one person's face, not a shared asset. The updatedAt
         ETag means a new photo is picked up immediately rather than after the
         cache expires. */
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: `"${row.updatedAt.getTime()}"`,
    },
  });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const stop = notVerified(user);
  if (stop) return stop;

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  }

  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: "AVATAR_TYPE" }, { status: 400 });
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json({ error: "AVATAR_TOO_LARGE" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  /* Check the bytes, not the label: a content type is whatever the client
     claims it is. */
  if (!looksLike(file.type, new Uint8Array(buf.subarray(0, 16)))) {
    return NextResponse.json({ error: "AVATAR_NOT_IMAGE" }, { status: 400 });
  }
  if (buf.byteLength > AVATAR_MAX_BYTES) {
    return NextResponse.json({ error: "AVATAR_TOO_LARGE" }, { status: 400 });
  }

  const values = {
    userId: user.id,
    contentType: file.type,
    bytes: buf.byteLength,
    data: buf.toString("base64"),
    updatedAt: new Date(),
  };

  const existing = db
    .select({ userId: userAvatars.userId })
    .from(userAvatars)
    .where(eq(userAvatars.userId, user.id))
    .get();

  if (existing) {
    db.update(userAvatars)
      .set(values)
      .where(eq(userAvatars.userId, user.id))
      .run();
  } else {
    db.insert(userAvatars).values(values).run();
  }

  return NextResponse.json({ ok: true, bytes: buf.byteLength });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const stop = notVerified(user);
  if (stop) return stop;

  const removed = db
    .delete(userAvatars)
    .where(eq(userAvatars.userId, user.id))
    .run().changes;

  return NextResponse.json({ ok: true, removed });
}
