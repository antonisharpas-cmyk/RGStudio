import { NextResponse } from "next/server";
import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { notifyContact } from "@/lib/messaging/events";
import { clientIp, hit, tooMany } from "@/lib/rate-limit";
import { contactSchema } from "@/lib/validation";

/**
 * An enquiry from the public contact form.
 *
 * Saved as a row first, so the record survives whatever the mail server does,
 * then emailed two ways: the enquiry to the studio's mailbox, and an
 * acknowledgement back to the sender. The row is the durable copy; the emails
 * are the courtesy, which is why a mail failure is logged inside notifyContact
 * rather than failing the request the visitor is waiting on.
 */
export async function POST(req: Request) {
  /* Unauthenticated and it writes a row, so it is throttled per address: ten
     messages an hour is more than anyone with something to say will send. */
  const rl = hit("contact", clientIp(req), 10, 60 * 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  const parsed = contactSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message" },
      { status: 400 },
    );
  }

  db.insert(contactMessages)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      message: parsed.data.message,
    })
    .run();

  /* Awaited, not fired and forgotten: this runs in a serverless function that
     may be frozen the instant the response is sent, and notifyContact never
     throws (it settles both sends and logs a failure), so waiting costs the
     visitor a second at most and guarantees both emails actually leave. */
  await notifyContact({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone || null,
    message: parsed.data.message,
  });

  return NextResponse.json({ ok: true });
}
