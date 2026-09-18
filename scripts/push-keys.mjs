/**
 * The one pair of keys web push needs, written straight into .env.
 *
 *   npm run push:keys                 generate and write them
 *   npm run push:keys -- --print      print them instead, to paste by hand
 *   npm run push:keys -- --force      replace an existing pair (see the warning)
 *
 * There is no company to sign up with for push. The message goes straight from
 * this server to Google's, Apple's or Mozilla's push service, signed with a key
 * pair that belongs to the studio and nobody else. This makes it.
 *
 * It writes the file itself rather than printing instructions, because printing
 * instructions is exactly what went wrong the first time: the keys scrolled past
 * in a terminal, nothing was pasted, and the studio spent an evening wondering
 * why no notification arrived. A setup step that depends on somebody copying
 * three lines correctly is a setup step that fails.
 *
 * Generate the pair once and keep it. Changing it later silently invalidates
 * every device that has already subscribed — they do not error, they simply stop
 * arriving — so this refuses to overwrite an existing pair unless asked twice.
 */
import webpush from "web-push";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const printOnly = process.argv.includes("--print");
const force = process.argv.includes("--force");

const path = ".env";
const env = existsSync(path) ? readFileSync(path, "utf8") : "";
const has = (key) => new RegExp(`^${key}=.+$`, "m").test(env);

if (has("VAPID_PUBLIC_KEY") && !force) {
  console.log(`
  .env already has a VAPID key pair, and it is being left alone.

  Replacing it would cut off every device that has already allowed
  notifications — quietly, with no error anywhere. If that is really what you
  want:

      npm run push:keys -- --force
`);
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();

if (printOnly) {
  console.log(`
  Web push keys. Put these three lines in .env:

VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:info@rgpilatesstudio.com

  The public key is sent to browsers and is not a secret. The private key is:
  do not commit it, and do not paste it into a chat window.
`);
  process.exit(0);
}

if (!existsSync(path)) {
  console.error(`
  There is no .env file here. Run npm run setup first, then this.
`);
  process.exit(1);
}

/* Replace the lines if they exist but are blank; otherwise append. Blank keys
   are the common case — .env.example ships them empty. */
function upsert(text, key, value) {
  const line = `${key}=${value}`;
  const blank = new RegExp(`^${key}=\\s*$`, "m");
  if (blank.test(text)) return text.replace(blank, line);
  const filled = new RegExp(`^${key}=.*$`, "m");
  if (filled.test(text)) return text.replace(filled, line);
  return `${text.endsWith("\n") ? text : text + "\n"}${line}\n`;
}

let next = env;
if (!/# notifications/.test(next)) {
  next =
    (next.endsWith("\n") ? next : next + "\n") +
    "\n# ---------------------------------------------------------------- notifications\n" +
    "# Web push. Generated on this machine; the private key has never left it.\n" +
    "# Regenerating these cuts off every device already subscribed.\n";
}
next = upsert(next, "VAPID_PUBLIC_KEY", keys.publicKey);
next = upsert(next, "VAPID_PRIVATE_KEY", keys.privateKey);
next = upsert(next, "VAPID_SUBJECT", "mailto:info@rgpilatesstudio.com");

/* The reminder sweep needs a secret to be woken from outside. Generated here
   too, so there is one fewer thing to remember. */
if (!has("CRON_SECRET")) {
  next = upsert(next, "CRON_SECRET", randomBytes(24).toString("base64url"));
}
if (!has("REMINDER_CHANNELS")) {
  next = upsert(next, "REMINDER_CHANNELS", "push");
}

writeFileSync(path, next);

console.log(`
  Written to .env. Nothing to copy.

    VAPID_PUBLIC_KEY    ${keys.publicKey.length} characters
    VAPID_PRIVATE_KEY   ${keys.privateKey.length} characters — secret, never commit it
    VAPID_SUBJECT       mailto:info@rgpilatesstudio.com
    CRON_SECRET         for waking the reminder sweep

  Next:

    1. Restart the server            npm run dev
    2. Sign in, then My account → Notifications → "Enable on this device"
       and allow notifications when the browser asks
    3. Book a class. The confirmation should arrive within a second or two.

  npm run doctor will tell you if any of the three is still missing.
`);
