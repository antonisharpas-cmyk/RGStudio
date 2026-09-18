/**
 * The reminder, proved rather than asserted.
 *
 *   npm run test:reminders
 *
 * A TLS server on a local port stands in for Google's push service, and the
 * test passes only if an encrypted payload actually lands on it. That is the
 * difference between reading the constant and watching the message leave: the
 * reminder is the one automatic message that has to reach somebody who is *not*
 * looking at the site, so "the code says push: true" is not good enough.
 *
 * It also checks the other three channels stayed shut. The studio's decision is
 * that a reminder costs nothing, and an SMS quietly switching itself on for
 * every booking is the failure worth guarding against.
 *
 * Needs `openssl` on PATH (it ships with Git for Windows) and the VAPID keys in
 * `.env` — without keys there is nothing to sign a push with, and the test says
 * so rather than reporting a mysterious zero.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";

/* web-push refuses a plain-http endpoint — correctly, since a push payload is
   encrypted but its delivery still must not be tampered with. So the stand-in
   for the phone's push service has to speak TLS. */
const dir = mkdtempSync(join(tmpdir(), "rg-push-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"),
  "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
const tls = {
  key: readFileSync(join(dir, "k.pem"), "utf8"),
  cert: readFileSync(join(dir, "c.pem"), "utf8"),
};
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { existsSync, readFileSync as readEnv } from "node:fs";
import { asc, eq, gt } from "drizzle-orm";

/* Read .env the way the server does, so this runs with no ceremony. */
if (existsSync(".env")) {
  for (const line of readEnv(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

/* Dynamic, because this file is ESM and the app compiles as CommonJS. */
const { db } = await import("../src/db");
const {
  bookingReminders,
  bookings,
  classSessions,
  notices,
  pushSubscriptions,
  users,
} = await import("../src/db/schema");
const { runDueReminders } = await import("../src/lib/messaging/events");

const hits: { path: string; bytes: number }[] = [];
const server = createServer(tls, (req, res) => {
  let n = 0;
  req.on("data", (c) => (n += c.length));
  req.on("end", () => {
    hits.push({ path: req.url ?? "", bytes: n });
    res.writeHead(201).end();
  });
});
const port: number = await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", () =>
    resolve((server.address() as { port: number }).port),
  ),
);

const user = db.select().from(users).limit(1).get()!;
/* A class that has not happened yet.
   The sweep deliberately drops a reminder for a class already under way — a
   "your class starts in two hours" arriving after it finished is worse than
   silence. `limit(1)` took the *oldest* session in the table, so this suite
   passed the week it was written and reported a mysterious stale:1 every week
   after, which reads as a broken reminder rather than a stale fixture. */
const session = db
  .select()
  .from(classSessions)
  .where(gt(classSessions.startsAt, new Date(Date.now() + 60 * 60_000)))
  .orderBy(asc(classSessions.startsAt))
  .limit(1)
  .get()!;
if (!session) {
  console.log("  ✗ no future class in the timetable — run npm run db:seed");
  process.exit(1);
}

const booking = db
  .insert(bookings)
  .values({ userId: user.id, sessionId: session.id, status: "CONFIRMED" })
  .returning()
  .get();

/* A real subscription shape, pointed at the server above. The keys are a valid
   P-256 point and a 16-byte auth secret, because the payload is genuinely
   encrypted before it is sent — a fake key fails inside the crypto, not at the
   network, and would look like the same zero. */
db.insert(pushSubscriptions)
  .values({
    userId: user.id,
    endpoint: `https://127.0.0.1:${port}/push/test-endpoint`,
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  })
  .run();

db.insert(bookingReminders)
  .values({
    bookingId: booking.id,
    userId: user.id,
    dueAt: new Date(Date.now() - 60_000),
    channels: "email,push",
  })
  .run();

const before = db.select().from(notices).where(eq(notices.userId, user.id)).all().length;
const result = await runDueReminders();
const after = db.select().from(notices).where(eq(notices.userId, user.id)).all().length;

console.log("");
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.log("  ✗ no VAPID keys in the environment — run npm run push:keys");
  process.exit(1);
}
console.log(`  sweep            ${JSON.stringify(result)}`);
console.log(`  in-app written   ${after - before}`);
console.log(`  push requests    ${hits.length}${hits.length ? ` → ${hits[0].path}, ${hits[0].bytes} encrypted bytes` : ""}`);
console.log("");

const ok =
  result.due === 1 &&
  after - before === 1 &&
  hits.length === 1 &&
  hits[0].bytes > 0 &&
  result.emailed === 0 &&
  result.texted === 0;

console.log(
  ok
    ? "  ✓ the reminder pushed, wrote the in-app copy, and sent no email or SMS"
    : "  ✗ not what was expected",
);

db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id)).run();
db.delete(bookingReminders).where(eq(bookingReminders.bookingId, booking.id)).run();
db.delete(bookings).where(eq(bookings.id, booking.id)).run();
server.close();
rmSync(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
