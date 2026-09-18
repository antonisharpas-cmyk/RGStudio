/**
 * The reminder queue, and why anything in it has not gone out.
 *
 *   npm run reminders            what is pending, overdue, and sent
 *   npm run reminders -- --run   sweep now, then show the result
 *
 * Written because "I booked a class and never got a reminder" had four possible
 * causes and no way to tell them apart: the sweep not running, the member having
 * no lead time set, the member having no device registered, or the class having
 * been booked inside its own lead time so no reminder was ever scheduled. Each
 * needs a different fix and none of them is visible from the website.
 */
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const { db, sqlite } = await import("../src/db");
const S = await import("../src/db/schema");
const { STUDIO } = await import("../src/lib/studio");
const { eq, sql } = await import("drizzle-orm");

const now = new Date();
const local = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: STUDIO.timezone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

console.log("");
console.log(`  now  ${local(now)}  (${STUDIO.timezone})`);
console.log("");

/* Every reminder row, with the class it belongs to and who it is for. */
const rows = sqlite
  .prepare(
    `select r.id, r.due_at, r.sent_at, r.channels,
            u.email, u.reminder_minutes,
            s.starts_at,
            (select count(*) from push_subscriptions p where p.user_id = u.id) as devices
       from booking_reminders r
       join users u on u.id = r.user_id
       join bookings b on b.id = r.booking_id
       join class_sessions s on s.id = b.session_id
      order by r.due_at desc`,
  )
  .all() as {
  id: string;
  due_at: number;
  sent_at: number | null;
  channels: string;
  email: string;
  reminder_minutes: number | null;
  starts_at: number;
  devices: number;
}[];

if (rows.length === 0) {
  console.log("  No reminders scheduled at all.");
  console.log("");
  console.log("  That is expected if nobody has booked a future class. If somebody");
  console.log("  has, the likely reason is a lead time of null — check the slider on");
  console.log("  My account → Notifications.");
  process.exit(0);
}

const waiting: typeof rows = [];
const overdue: typeof rows = [];
const stale: typeof rows = [];
const sent: typeof rows = [];

for (const r of rows) {
  const due = new Date(r.due_at * 1000);
  const starts = new Date(r.starts_at * 1000);
  if (r.sent_at) sent.push(r);
  else if (starts <= now) stale.push(r);
  else if (due <= now) overdue.push(r);
  else waiting.push(r);
}

const line = (r: typeof rows[number]) => {
  const due = new Date(r.due_at * 1000);
  const starts = new Date(r.starts_at * 1000);
  const lead = Math.round((starts.getTime() - due.getTime()) / 60_000);
  const device =
    r.devices === 0
      ? "  ⚠ no device registered — no pop-up possible"
      : `  ${r.devices} device${r.devices === 1 ? "" : "s"}`;
  return `    ${local(due)} → class ${local(starts)}  (${lead}m lead)  ${r.email}${device}`;
};

if (overdue.length) {
  console.log(`  ${overdue.length} OVERDUE — due, class still ahead, not sent`);
  overdue.forEach((r) => console.log(line(r)));
  console.log("");
  console.log("    These should have gone already. If the number does not drop within");
  console.log("    a minute of the server running, the sweep is not running — the");
  console.log("    server log should say [reminders] sweeping every 60s at startup.");
  console.log("");
}

if (waiting.length) {
  console.log(`  ${waiting.length} waiting`);
  waiting.slice(0, 12).forEach((r) => console.log(line(r)));
  if (waiting.length > 12) console.log(`    … and ${waiting.length - 12} more`);
  console.log("");
}

if (stale.length) {
  console.log(`  ${stale.length} too late to send (the class has already started)`);
  stale.slice(0, 6).forEach((r) => console.log(line(r)));
  console.log("");
  console.log("    The sweep closes these without sending. A reminder for a class that");
  console.log("    has begun is not a reminder, and telling somebody their Tuesday");
  console.log("    class starts \"now\" on Thursday is worse than saying nothing.");
  console.log("");
}

console.log(`  ${sent.length} sent`);
console.log("");

/* The two things that silently stop a reminder existing at all. */
const noLead = db
  .select({ email: S.users.email })
  .from(S.users)
  .where(sql`${S.users.reminderMinutes} is null`)
  .all();
if (noLead.length) {
  console.log(`  ${noLead.length} account${noLead.length === 1 ? "" : "s"} with no lead time — these get no reminder at all:`);
  noLead.forEach((u) => console.log(`    ${u.email}`));
  console.log("");
}

const devices = sqlite
  .prepare(
    `select u.email, count(p.id) as n
       from users u left join push_subscriptions p on p.user_id = u.id
      group by u.id order by n desc`,
  )
  .all() as { email: string; n: number }[];
console.log("  Devices registered for push, by account:");
devices.forEach((d) =>
  console.log(`    ${d.n === 0 ? "⚠" : "·"} ${String(d.n).padStart(2)}  ${d.email}`),
);
console.log("");
console.log("    A pop-up needs a device. Pressing Enable on this device while signed");
console.log("    in as one member does not register it for another — sign in as the");
console.log("    member you are testing with and open My account → Notifications.");
console.log("");

if (process.argv.includes("--run")) {
  const { runDueReminders } = await import("../src/lib/messaging/events");
  const result = await runDueReminders();
  console.log(`  swept: ${JSON.stringify(result)}`);
  console.log("");
}
