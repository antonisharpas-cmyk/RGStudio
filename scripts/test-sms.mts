/**
 * What a text message costs, and whether it actually leaves.
 *
 *   npm run test:sms
 *
 * Two halves, and the first one is the one that matters.
 *
 * **The arithmetic.** An SMS is billed per segment, and how many segments a
 * piece of text becomes depends on which alphabet it forces: 160 characters of
 * Latin, or 70 the moment one Greek letter appears. Every number the desk sees
 * before pressing send comes from `smsCost`, so if that function is wrong the
 * studio is quoted a price it will not be charged. There is no way to notice
 * that except by testing it, because the disagreement only shows up on an
 * invoice a month later.
 *
 * **The transport.** A local server stands in for api.sms.to, so the test can
 * assert what we actually put on the wire — the endpoint, the bearer token, the
 * sender ID, the message — without an account, a key, or a cent. The thing being
 * guarded against is a silent success: a transport that returns `ok` while
 * sending the wrong field name would look identical from the outside.
 *
 * Nothing here needs the app running or the database.
 */
import { createServer } from "node:http";

const { smsCost, smsEncoding, smsBodyFor, smsSendCost } = await import(
  "../src/lib/messaging/segments"
);

let pass = 0,
  fail = 0;
const check = (label: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass++;
    console.log("  ✓ " + label);
  } else {
    fail++;
    console.log("  ✗ " + label, extra ?? "");
  }
};

/* ------------------------------------------------------------------ 1 */
console.log("\n1. Which alphabet the text forces");
check("plain English is the cheap one", smsEncoding("Studio closed Monday") === "gsm7");
check("digits and punctuation too", smsEncoding("Class at 18:00 — no") === "unicode",
  "an em dash is not in GSM-7, which is worth knowing");
check("a plain hyphen is fine", smsEncoding("Class at 18:00 - yes") === "gsm7");
check("Greek is the expensive one", smsEncoding("Το στούντιο είναι κλειστό") === "unicode");
check(
  "one Greek letter in an English sentence is enough to do it",
  smsEncoding("Studio closed Δευτέρα") === "unicode",
);
check(
  "the Greek capitals that share glyphs stay cheap",
  smsEncoding("ΔΦΓΛΩΠΨΣΘΞ") === "gsm7",
  "these ten are genuinely in the GSM-7 table",
);

/* ------------------------------------------------------------------ 2 */
console.log("\n2. The boundaries, where the bill changes");
const latin = (n: number) => "a".repeat(n);
check("160 Latin characters is one message", smsCost(latin(160)).segments === 1, smsCost(latin(160)));
check("161 is two", smsCost(latin(161)).segments === 2, smsCost(latin(161)));
check("306 is two", smsCost(latin(306)).segments === 2, smsCost(latin(306)));
check("307 is three", smsCost(latin(307)).segments === 3, smsCost(latin(307)));

const greek = (n: number) => "α".repeat(n);
check("70 Greek characters is one message", smsCost(greek(70)).segments === 1, smsCost(greek(70)));
check("71 is two", smsCost(greek(71)).segments === 2, smsCost(greek(71)));
check("134 is two", smsCost(greek(134)).segments === 2, smsCost(greek(134)));
check("135 is three", smsCost(greek(135)).segments === 3, smsCost(greek(135)));

check("nothing typed costs nothing", smsCost("").segments === 0);

/* The number the desk acts on: how much to cut to get back to one message. */
check("161 characters is 1 over", smsCost(latin(161)).overBy === 1, smsCost(latin(161)));
check("182 characters is 22 over", smsCost(latin(182)).overBy === 22, smsCost(latin(182)));
check("and something that fits is 0 over", smsCost(latin(120)).overBy === 0);
check("in Greek the ceiling is 70, so 71 is 1 over", smsCost(greek(71)).overBy === 1, smsCost(greek(71)));
check(
  "cutting exactly that much really does make it one message",
  smsCost(latin(182 - smsCost(latin(182)).overBy)).segments === 1,
);
check(
  "and the same holds in Greek",
  smsCost(greek(100 - smsCost(greek(100)).overBy)).segments === 1,
);

/* The euro sign is in the extension table, so it costs two slots rather than
   one. A studio writing about prices runs into this and nothing else explains
   why 159 characters became two messages. */
check("the euro sign costs two characters", smsCost("€").units === 2, smsCost("€"));
check(
  "so 80 euro signs is one message and 81 is two",
  smsCost("€".repeat(80)).segments === 1 && smsCost("€".repeat(81)).segments === 2,
);

/* ------------------------------------------------------------------ 3 */
console.log("\n3. The claim the studio was given: Greek costs three times more");
const announcement =
  "The studio will be closed on Monday 14 September for maintenance. All classes are cancelled and your sessions have been returned.";
const announcementEl =
  "Το στούντιο θα είναι κλειστό τη Δευτέρα 14 Σεπτεμβρίου για συντήρηση. Όλα τα μαθήματα ακυρώνονται και οι συνεδρίες σας επιστράφηκαν.";

const en1 = smsCost(announcement);
const el1 = smsCost(announcementEl);
console.log(`     English  ${en1.units} chars → ${en1.segments} segment(s)`);
console.log(`     Greek    ${el1.units} chars → ${el1.segments} segment(s)`);
check("the English version is one message", en1.segments === 1, en1);
/* Asserted as a ratio rather than a number, because the number depends on where
   the sentence happens to fall: this one is 132 characters and so is two
   segments, where 135 would be three. The claim that survives every length is
   the ratio — Greek is always at least twice the English, because the segment
   is less than half the size. */
check("the same thing in Greek costs at least twice as much", el1.segments >= en1.segments * 2, el1);
check(
  "and a slightly longer one is three",
  smsCost(announcementEl + " Ευχαριστούμε.").segments === 3,
  smsCost(announcementEl + " Ευχαριστούμε."),
);

/* And the counter-intuitive one, which is the reason the desk gets a warning:
   both languages in one message is not double, because the Greek half drags the
   English half into the expensive alphabet with it. */
const both = smsBodyFor(
  "both",
  { subject: "Closed Monday", body: announcement },
  { subject: "Κλειστά τη Δευτέρα", body: announcementEl },
);
const bothCost = smsCost(both);
console.log(`     Both     ${bothCost.units} chars → ${bothCost.segments} segment(s)`);
check(
  "both languages together costs more than the two sent separately",
  bothCost.segments > en1.segments + el1.segments - 1,
  { both: bothCost.segments, en: en1.segments, el: el1.segments },
);
check("and it is charged at Greek prices throughout", bothCost.encoding === "unicode");

/* ------------------------------------------------------------------ 4 */
console.log("\n4. Which words go out");
const en = { subject: "Closed Monday", body: "No classes." };
const el = { subject: "Κλειστά", body: "Χωρίς μαθήματα." };

check("English by default", smsBodyFor("en", en, el).startsWith("Closed Monday"));
check("Greek when asked", smsBodyFor("el", en, el).startsWith("Κλειστά"));
check("both when asked", /Closed Monday[\s\S]*Κλειστά/.test(smsBodyFor("both", en, el)));
check(
  "asking for Greek that was never typed falls back to English, not to silence",
  smsBodyFor("el", en, undefined) === "Closed Monday. No classes.",
  smsBodyFor("el", en, undefined),
);
check(
  "both, with no Greek typed, sends the English once rather than twice",
  smsBodyFor("both", en, undefined) === "Closed Monday. No classes.",
  smsBodyFor("both", en, undefined),
);
check(
  "a hand-written short version wins over the notice body",
  smsBodyFor("en", en, el, { en: "Shut Mon. No classes." }) === "Shut Mon. No classes.",
);
check(
  "an empty override is ignored rather than sending nothing",
  smsBodyFor("en", en, el, { en: "   " }) === "Closed Monday. No classes.",
);

/* The bug the desk found by using it: Greek typed straight into the box, with no
   Greek half on the notice, was silently ignored and the English went out
   instead. The override is the more specific instruction and has to win. */
check(
  "Greek typed by hand is used even when the notice has no Greek",
  smsBodyFor("el", en, undefined, { el: "Κλειστά σήμερα" }) === "Κλειστά σήμερα",
  smsBodyFor("el", en, undefined, { el: "Κλειστά σήμερα" }),
);
check(
  "and it is measured as Greek, not as the English it replaced",
  smsCost(smsBodyFor("el", en, undefined, { el: "Κλειστά σήμερα" })).encoding ===
    "unicode",
);
check(
  "both, with only a hand-written Greek, carries both halves",
  smsBodyFor("both", en, undefined, { el: "Κλειστά σήμερα" }) ===
    "Closed Monday. No classes.\n\nΚλειστά σήμερα",
  smsBodyFor("both", en, undefined, { el: "Κλειστά σήμερα" }),
);
check(
  "both, hand-written on each side, uses both",
  smsBodyFor("both", en, el, { en: "Shut today", el: "Κλειστά" }) ===
    "Shut today\n\nΚλειστά",
  smsBodyFor("both", en, el, { en: "Shut today", el: "Κλειστά" }),
);
check(
  "a hand-written Greek also overrides a Greek notice that does exist",
  smsBodyFor("el", en, el, { el: "Κάτι άλλο" }) === "Κάτι άλλο",
);
/* Found by looking at the screen: a desk that has typed nothing yet was being
   shown a preview of a text message containing a single full stop. */
check(
  "nothing typed previews as nothing, not as a full stop",
  smsBodyFor("en", { subject: "", body: "" }) === "",
  JSON.stringify(smsBodyFor("en", { subject: "", body: "" })),
);
check(
  "a title with no body yet reads as the title",
  smsBodyFor("en", { subject: "Closed Monday", body: "" }) === "Closed Monday",
);
check(
  "and a body with no title reads as the body",
  smsBodyFor("en", { subject: "", body: "No classes." }) === "No classes.",
);

/* ------------------------------------------------------------------ 5 */
console.log("\n5. The whole send, priced");
const send = smsSendCost(announcementEl, 187, 0.02);
console.log(`     ${send.segments} × 187 people = ${send.total} messages ≈ €${send.money!.toFixed(2)}`);
check("segments are multiplied by people", send.total === el1.segments * 187, send);
check("and the money follows", Math.abs((send.money ?? 0) - send.total * 0.02) < 1e-9);
check(
  "no price configured means no price invented",
  smsSendCost(announcement, 100).money === null,
);
check("nobody to send to costs nothing", smsSendCost(announcement, 0, 0.02).total === 0);

/* ------------------------------------------------------------------ 6 */
console.log("\n6. The SMS.to transport, against a server we control");

type Seen = { url: string; auth: string | undefined; body: unknown };
const seen: Seen[] = [];
let reply: { status: number; body: string } = {
  status: 200,
  body: JSON.stringify({ success: true, message_id: "fake-1" }),
};

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {}
    seen.push({ url: req.url ?? "", auth: req.headers.authorization, body: parsed });
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(reply.body);
  });
});
const port: number = await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", () =>
    resolve((server.address() as { port: number }).port),
  ),
);

process.env.SMSTO_API_BASE = `http://127.0.0.1:${port}`;
process.env.SMS_PROVIDER = "smsto";
process.env.SMSTO_API_KEY = "test-key-not-a-real-one";
process.env.SMS_SENDER = "RGPILATES";

/* Imported after the environment is set, because the module reads it at load. */
const { smsTransport, toE164 } = await import("../src/lib/messaging/sms");
const t = smsTransport();
check("the transport says it is SMS.to", t.name === "SMS.to", t.name);
check("and that it is ready", t.ready === true);

const sent = await t.send("+35799123456", { subject: "x", body: "Closed Monday" });
check("a send reports success", sent.ok === true, sent);
check("and carries the provider's id back", sent.ok && sent.id === "fake-1", sent);
check("it posted to /sms/send", seen[0]?.url === "/sms/send", seen[0]?.url);
check(
  "with the key as a bearer token",
  seen[0]?.auth === "Bearer test-key-not-a-real-one",
  seen[0]?.auth,
);
const b = seen[0]?.body as Record<string, string>;
check("the number in `to`", b?.to === "+35799123456", b);
check("the words in `message`", b?.message === "Closed Monday", b);
check("and the sender name in `sender_id`", b?.sender_id === "RGPILATES", b);
check(
  "no phone number is sent as the sender",
  !/^\+?\d+$/.test(b?.sender_id ?? ""),
  "an alphanumeric sender is the whole point — it costs nothing",
);

/* Greek must survive the trip intact. JSON escaping it wrongly is the kind of
   fault that shows up as mojibake on a member's phone and nowhere else. */
await t.send("+35799123456", { subject: "x", body: "Κλειστά τη Δευτέρα" });
check(
  "Greek arrives unmangled",
  (seen[1]?.body as Record<string, string>)?.message === "Κλειστά τη Δευτέρα",
  seen[1]?.body,
);

/* A refusal has to be reported as one. A transport that swallowed a 401 would
   have the desk reporting "sent 187" for messages nobody received. */
reply = { status: 401, body: JSON.stringify({ message: "Unauthenticated." }) };
const refused = await t.send("+35799123456", { subject: "x", body: "hello" });
check("a rejected send is a failure, not a success", refused.ok === false, refused);
check(
  "and the reason survives for the desk to read",
  !refused.ok && /401/.test(refused.error),
  refused,
);

/* Success with an unfamiliar body shape must still count as sent. */
reply = { status: 200, body: "OK" };
const odd = await t.send("+35799123456", { subject: "x", body: "hello" });
check("a 2xx with no JSON is still a success", odd.ok === true, odd);

/* Missing credentials must be inert rather than throwing at send time. */
delete process.env.SMSTO_API_KEY;
const bare = smsTransport();
check("no key means not ready", bare.ready === false, bare.name);
const nope = await bare.send("+35799123456", { subject: "x", body: "hello" });
check("and sending says so instead of crashing", nope.ok === false, nope);

/* ------------------------------------------------------------------ 7 */
console.log("\n7. Numbers as members actually type them");
check("a local Cyprus number gains the country code", toE164("99 123456") === "+35799123456");
check("a leading zero is dropped", toE164("099123456") === "+35799123456");
check("an international number is left alone", toE164("+44 7700 900123") === "+447700900123");
check("a number already carrying 357 is not doubled", toE164("357 99 123456") === "+35799123456");
check("nonsense is refused rather than dialled", toE164("abc") === null);
check("nothing is refused", toE164("") === null);

/* ------------------------------------------------------------------ 8 */
console.log("\n8. SMS_DEFAULT_COUNTRY, however it is written");
/**
 * `render.yaml` shipped `SMS_DEFAULT_COUNTRY: CY`, and the value is pasted in
 * front of the number, so a member who typed 99649052 was sent to +CY99649052.
 * The gateway refused it and the only trace was a failed send in the notices
 * panel — and only for members whose stored number had no `+` in front of it,
 * which is the hardest version of this to spot.
 *
 * `dialCode` is asserted directly rather than through `toE164`, because
 * `DEFAULT_CC` is read once when the module loads and cannot be changed
 * afterwards. That is correct for the sender and useless for a test, so the
 * resolution is its own exported function.
 */
{
  const { dialCode } = await import("../src/lib/messaging/sms");

  for (const [given, want] of [
    ["357", "357"],
    ["+357", "357"],
    ["00357", "357"],
    ["CY", "357"],
    ["cy", "357"],
    ["GR", "30"],
    ["", "357"],
  ] as const) {
    const got = dialCode(given);
    check(
      `"${given || "(unset)"}" means +${want}`,
      got.cc === want && got.ok,
      got,
    );
  }

  const bad = dialCode("nonsense");
  check(
    "a value that is not a code at all is refused, not concatenated",
    bad.ok === false && bad.cc === "357",
    bad,
  );
  check(
    "and the refusal is what stops +nonsense99649052 reaching a gateway",
    /^\+357\d+$/.test(`+${bad.cc}99649052`),
  );
}

server.close();
console.log(
  `\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`,
);
process.exit(fail === 0 ? 0 : 1);
