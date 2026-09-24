import { NextResponse } from "next/server";
import { readPhoto } from "@/lib/team";

/** An instructor's portrait, public: it is shown on the studio page. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = readPhoto(id);
  if (!row) return new NextResponse(null, { status: 404 });
  const body = Buffer.from(row.data, "base64");
  return new NextResponse(body, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(body.byteLength),
      /* The URL carries ?v=<updated>, so a new upload is a new address and
         this one can be cached hard. */
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
