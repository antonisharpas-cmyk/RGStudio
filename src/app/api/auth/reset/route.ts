import { NextResponse } from "next/server";
import { completeReset, lookupReset } from "@/lib/password-reset";
import { clientIp, hit, tooMany } from "@/lib/rate-limit";

/** Is the link in the address bar still good? The page asks before drawing the form. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const found = lookupReset(token);
  return NextResponse.json(found.ok ? { ok: true } : { ok: false, error: found.code });
}

/** The new password, twice. */
export async function POST(req: Request) {
  const gate = hit("reset", clientIp(req), 20, 15 * 60 * 1000);
  if (!gate.ok) return tooMany(gate.retryAfter);

  const body = (await req.json().catch(() => null)) as
    | { token?: unknown; password?: unknown; confirm?: unknown }
    | null;
  const result = await completeReset(
    String(body?.token ?? ""),
    String(body?.password ?? ""),
    String(body?.confirm ?? ""),
  );
  if (!result.ok) {
    const status = result.code === "PASSWORD_SHORT" || result.code === "MISMATCH" ? 400 : 410;
    return NextResponse.json({ error: result.code }, { status });
  }
  return NextResponse.json({ ok: true });
}
