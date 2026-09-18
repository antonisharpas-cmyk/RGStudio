import { NextResponse } from "next/server";
import { lockDesk } from "@/lib/auth";

/** Locks the desk console without signing the staff member out of the site. */
export const dynamic = "force-dynamic";

export async function POST() {
  await lockDesk();
  return NextResponse.json({ ok: true });
}
