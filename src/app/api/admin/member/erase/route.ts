import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import { erasePersonalData } from "@/lib/erasure";

/**
 * Erase a member's personal details, keeping their account and its payments.
 *
 * Behind `owner()` rather than `desk()`. Reception can correct a phone number
 * and sell a pack; this is irreversible, it is the studio's answer to a legal
 * request, and it needs to be somebody's decision rather than a button on the
 * screen everybody uses all day. A receptionist gets the same 403 a member
 * would — the route does not explain that the capability exists.
 *
 * What it actually does, and why it is not a delete, is in lib/erasure.ts.
 */
export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const data = await body<{ userId?: string; confirmEmail?: string }>(req);
  if (!data?.userId || !data?.confirmEmail) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const result = await erasePersonalData(data.userId, data.confirmEmail, {
    id: gate.user.id,
    name: gate.user.name,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code },
      { status: result.code === "NOT_FOUND" ? 404 : 409 },
    );
  }

  return NextResponse.json(result);
}
