import { NextResponse } from "next/server";
import { verified } from "@/lib/api-guard";
import { pushToUser } from "@/lib/messaging/events";
import { deviceCount, pushReady } from "@/lib/messaging/push";

/**
 * "Did that work?" — a notification to your own devices, and nobody else's.
 *
 * Worth its own route because the alternative is booking a real class to find
 * out whether push is set up, and then cancelling it. The recipient is always
 * the signed-in member, taken from the session, so this cannot be pointed at
 * anybody else however it is called.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const gate = await verified();
  if ("res" in gate) return gate.res;

  if (!pushReady()) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  const devices = deviceCount(gate.user.id);
  if (devices === 0) {
    return NextResponse.json({ error: "NO_DEVICES" }, { status: 409 });
  }

  const sent = await pushToUser(gate.user.id, {
    subject: "RG Pilates Studio",
    body: "Notifications are working. This is the only test you will get.",
    url: "/account?tab=notifications",
  });

  return NextResponse.json({ ok: true, devices, sent });
}
