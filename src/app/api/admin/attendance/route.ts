import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { desk } from "@/lib/api-guard";
import { attendanceSchema } from "@/lib/validation";

/** Marking who turned up. Behind the desk lock, like everything else here. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await desk();
  if ("res" in gate) return gate.res;

  const parsed = attendanceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  db.update(bookings)
    .set({ status: parsed.data.status })
    .where(eq(bookings.id, parsed.data.bookingId))
    .run();

  return NextResponse.json({ ok: true });
}
