/**
 * Send one real email, and say exactly what happened.
 *
 *   npm run email:test -- you@example.com
 *
 * This exists because "the email did not arrive" has about six causes and the
 * app cannot tell you which — it hands the message to a mail server and moves
 * on. So this does the same send on its own, in the foreground, and prints the
 * entire conversation with the server when it fails. A wrong app password says
 * `535`, sending as the wrong mailbox says `550`, a blocked port says nothing at
 * all and times out. Each of those has a different fix and they are impossible
 * to tell apart from an empty inbox.
 *
 * It sends the real template, not "test 123", so what lands in the inbox is what
 * a member would actually receive.
 */
import { existsSync, readFileSync } from "node:fs";

/* Read .env the way the server does, so this reports on what the app will do
   rather than on an empty environment. Anything already set wins, which is what
   lets EMAIL_PROVIDER=log npm run email:test rehearse without sending. */
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const { emailTransport } = await import("../src/lib/messaging/email");
const { addressOf } = await import("../src/lib/messaging/smtp");

const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error("Which address? \n\n  npm run email:test -- you@example.com\n");
  process.exit(1);
}

const provider = (process.env.EMAIL_PROVIDER ?? "log").toLowerCase();
const from = process.env.EMAIL_FROM ?? "(EMAIL_FROM is not set)";
const transport = emailTransport();

console.log("");
console.log(`  provider   ${provider}`);
console.log(`  transport  ${transport.name}`);
console.log(`  from       ${from}`);
console.log(`  to         ${to}`);
console.log("");

if (provider === "log") {
  console.log(
    "  EMAIL_PROVIDER is 'log', so nothing is sent anywhere. That is the\n" +
      "  default and it is not a fault — it is how the pipeline is tested\n" +
      "  without a mailbox. Set EMAIL_PROVIDER=smtp (or resend/brevo) in .env\n" +
      "  to send for real. See docs/notifications.md.\n",
  );
}

if (!transport.ready) {
  console.error(`  ✗ not configured: ${transport.name}\n`);
  process.exit(1);
}

/* The mistake that costs the most time: a mail server will not send as a mailbox
   you have not signed in as, and the error it gives for that ("550 not allowed")
   reads like a problem with the recipient. Caught here, before the send. */
if (provider === "smtp") {
  const user = process.env.SMTP_USER ?? "";
  const sender = addressOf(from);
  if (user && sender && user.toLowerCase() !== sender.toLowerCase()) {
    console.log(
      `  ! SMTP_USER is ${user} but EMAIL_FROM sends as ${sender}.\n` +
        "    Most mail servers refuse that. If the send fails with 550 or 553,\n" +
        "    this is why — make them the same mailbox.\n",
    );
  }
}

const msg = {
  subject: "Your class is confirmed",
  body:
    "This is the studio's own email, sent by RG Pilates Studio rather than by Stripe.\n\n" +
    "Reformer Flow — Saturday 29 August at 18:00. See you at the studio.\n\n" +
    "If you are reading this, the email channel works: booking confirmations, " +
    "payment receipts and anything the desk sends from the Notices tab will all " +
    "arrive this way.",
};

const started = Date.now();

if (transport.trace) {
  const result = await transport.trace(to, msg);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (result.ok) {
    console.log(`  ✓ accepted by the mail server in ${seconds}s\n`);
  } else {
    console.error(`  ✗ refused after ${seconds}s\n`);
    console.error(`    ${result.error}\n`);
  }

  console.log("  The conversation:\n");
  for (const line of result.log) console.log(`    ${line}`);
  console.log("");

  if (!result.ok) {
    console.error(hint(result.error ?? ""));
    process.exit(1);
  }
} else {
  const result = await transport.send(to, msg);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.ok) {
    console.log(`  ✓ accepted in ${seconds}s${result.id ? ` (id ${result.id})` : ""}\n`);
  } else {
    console.error(`  ✗ refused after ${seconds}s\n    ${result.error}\n`);
    console.error(hint(result.error));
    process.exit(1);
  }
}

console.log(
  "  Accepted means the mail server took it, not that it reached the inbox.\n" +
    "  Check the inbox, then check spam. If it is in spam, that is the sending\n" +
    "  domain's reputation rather than anything in this app.\n",
);

/** The server's code, turned into the thing to actually go and do. */
function hint(error: string) {
  if (/\b535\b|Username and Password not accepted|BadCredentials/i.test(error)) {
    return (
      "  The password was rejected.\n\n" +
      "  Google will not accept the account's own password over SMTP. You need an\n" +
      "  app password: myaccount.google.com → Security → 2-Step Verification must\n" +
      "  be on → App passwords → create one → the 16 characters go in SMTP_PASS.\n" +
      "  Spaces in it are fine to remove.\n"
    );
  }
  if (/\b55[03]\b|not allowed|does not match|sender/i.test(error)) {
    return (
      "  The server refused the sender.\n\n" +
      "  SMTP_USER and the address inside EMAIL_FROM have to be the same mailbox,\n" +
      "  or an alias that mailbox owns. Sending as somebody else is the one thing\n" +
      "  every mail server exists to prevent.\n"
    );
  }
  if (/timed out|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND/i.test(error)) {
    return (
      "  Could not reach the mail server at all.\n\n" +
      "  Either SMTP_HOST is wrong, or something between here and it is blocking\n" +
      "  the port — office networks and some ISPs block 465 and 587 outbound.\n" +
      "  Try the other port (465 for TLS, 587 for STARTTLS). If both are blocked,\n" +
      "  use EMAIL_PROVIDER=resend instead: it is an ordinary HTTPS call and\n" +
      "  nothing blocks 443.\n"
    );
  }
  if (/certificate|self.signed|CERT_/i.test(error)) {
    return (
      "  The mail server's certificate did not check out.\n\n" +
      "  On a real provider this is worth investigating rather than working\n" +
      "  around. On a mail server inside the building, SMTP_TLS_INSECURE=1 skips\n" +
      "  the check — never set that against Google or any provider on the\n" +
      "  internet.\n"
    );
  }
  return "  See docs/notifications.md for what each setting does.\n";
}
