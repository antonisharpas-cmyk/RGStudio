import { NextResponse } from "next/server";
import { body, verified } from "@/lib/api-guard";
import {
  deviceCount,
  dropSubscription,
  saveSubscription,
} from "@/lib/messaging/push";

/**
 * One device, asking to be told things.
 *
 * The subscription belongs to the member who is signed in — it is taken from the
 * session, never from the request — so one member cannot register a device
 * against somebody else's account and read their notices.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await verified();
  if ("res" in gate) return gate.res;
  return NextResponse.json({ devices: deviceCount(gate.user.id) });
}

export async function POST(req: Request) {
  const gate = await verified();
  if ("res" in gate) return gate.res;

  const data = await body<{
    endpoint?: string;
    p256dh?: string;
    auth?: string;
  }>(req);

  if (!data?.endpoint || !data.p256dh || !data.auth) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  /* Push services are all https endpoints. Anything else is a mistake or a
     probe, and storing it would mean posting the notice somewhere unknown. */
  if (!/^https:\/\//.test(data.endpoint) || data.endpoint.length > 1000) {
    return NextResponse.json({ error: "BAD_ENDPOINT" }, { status: 400 });
  }

  saveSubscription({
    userId: gate.user.id,
    endpoint: data.endpoint,
    p256dh: data.p256dh,
    auth: data.auth,
    userAgent: req.headers.get("user-agent") ?? "",
  });

  return NextResponse.json({ ok: true, devices: deviceCount(gate.user.id) });
}

export async function DELETE(req: Request) {
  const gate = await verified();
  if ("res" in gate) return gate.res;

  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  dropSubscription(endpoint, gate.user.id);
  return NextResponse.json({ ok: true, devices: deviceCount(gate.user.id) });
}
