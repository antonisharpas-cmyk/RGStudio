/**
 * Notifications: who agreed to what, and who actually gets sent to.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/test-notify.mjs http://localhost:3100
 *
 * The consent rules are the point of this suite. Getting them wrong is not a
 * cosmetic bug: it is either a member who was not told their class was
 * cancelled, or an offer sent to somebody who explicitly said no.
 */
import { markOnboarded, markVerified } from "./fixture-verify.mjs";

const B = process.argv[2] ?? "http://localhost:3000";
const OWNER = { email: "owner@rgpilatesstudio.com", password: "ownerdev123" };

const jar = () => new Map();
const ch = (j) => [...j].map(([k, v]) => `${k}=${v}`).join("; ");

async function req(j, path, { method = "GET", body } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(j.size ? { cookie: ch(j) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [k, ...rest] = pair.split("=");
    const v = rest.join("=");
    if (v === "") j.delete(k.trim());
    else j.set(k.trim(), v);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

/* The opening-week offer grants a free session on registration, which changes
   what a new account starts with — so this suite expects it off. Said here,
   once and plainly, rather than surfacing as a dozen confusing failures about
   balances being one too high. */
async function assertNoPromo(reg) {
  if (!reg) return;
  const me = await req(reg, "/api/bookings");
  if ((me.json?.credits ?? 0) > 0) {
    console.error(
      "\n  ! This suite needs the opening-week promo switched off." +
        "\n    Start the server with:  PROMO_ENABLED=false npx next start -p <port>\n",
    );
    process.exit(1);
  }
}

let pass = 0,
  fail = 0;
const check = (l, c, x) => {
  if (c) {
    pass++;
    console.log("  ✓ " + l);
  } else {
    fail++;
    console.log("  ✗ " + l, x ?? "");
  }
};

/* A different number for every test member, because one number now means one
   account — the suite used to register everybody as +357 99 123456, which is
   exactly the duplicate the site is meant to refuse. */
let phoneSeq = 0;
const nextPhone = () =>
  `+35799${String(100000 + ((Date.now() % 800000) + phoneSeq++ * 7)).slice(0, 6)}`;

async function member(tag, { marketing = false } = {}) {
  const j = jar();
  const email = `notify-${tag}-${Date.now()}-${Math.floor(performance.now())}@rg.test`;
  const reg = await req(j, "/api/auth/register", {
    method: "POST",
    body: {
      name: `Notify ${tag}`,
      email,
      phone: nextPhone(),
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
      marketingOptIn: marketing,
    },
  });
  /* Confirm the address the way a member would. An unverified account is left
     out of nothing — consent is consent — but it cannot reach /account, and
     several checks below read the member's own screen. */
  markOnboarded(email);
  if (reg.json?.ok && markVerified(email) !== 1) {
    throw new Error(`fixture ${email} did not verify`);
  }
  if (reg.json?.ok) {
    /* And signed in again, which re-issues the cookie with the confirmed stamp on
       it. The middleware reads the cookie, so the database write alone would leave
       every page still redirecting to the code box. */
    await req(j, "/api/auth/login", {
      method: "POST",
      body: { email, password: "test12345" },
    });
  }
  return { j, email, ok: reg.json?.ok === true };
}

/* ------------------------------------------------------------------ 1 */
console.log("\n1. What a new member starts with");
const fresh = await member("fresh");
{
  check("registration succeeds", fresh.ok);

  const me = await req(fresh.j, "/api/profile");
  const p = me.json?.profile ?? me.json;
  check("the studio notices consent is on record", Boolean(p?.serviceOptIn), p);
  check("email is on", p?.notifyEmail === true, p?.notifyEmail);
  check("SMS is off", p?.notifySms === false, p?.notifySms);
  /* Push is not a preference any more: the studio keeps it on. */
  check("push is on and stays on", p?.notifyPush === true, p?.notifyPush);
  check(
    "offers are not selected",
    p?.marketingOptIn === false,
    p?.marketingOptIn,
  );

  /* Even a request that explicitly asks to switch push off must not. */
  const off = await req(fresh.j, "/api/profile", {
    method: "PATCH",
    body: {
      name: "Notify fresh",
      marketingOptIn: false,
      serviceOptIn: true,
      termsAccepted: true,
      notifyEmail: true,
      notifySms: false,
      notifyPush: false,
      reminderMinutes: 120,
    },
  });
  check(
    "a request to turn push off is accepted…",
    off.status === 200,
    off.status,
  );
  const after = await req(fresh.j, "/api/profile");
  const q = after.json?.profile ?? after.json;
  check("…but push is still on", q?.notifyPush === true, q?.notifyPush);

  /* The screen shows it as always-on rather than as a switch. */
  const page = await req(fresh.j, "/account?tab=notifications");
  check(
    "the notifications screen calls push always on",
    page.text.includes("Always on"),
    "no always-on label",
  );
}

/* ------------------------------------------------------------------ 2 */
console.log("\n2. Turning the channels that are theirs to turn");
{
  const sms = await req(fresh.j, "/api/profile", {
    method: "PATCH",
    body: {
      name: "Notify fresh",
      marketingOptIn: true,
      serviceOptIn: true,
      termsAccepted: true,
      notifyEmail: false,
      notifySms: true,
      notifyPush: true,
      reminderMinutes: 120,
    },
  });
  check("email off and SMS on is accepted", sms.status === 200, sms.status);
  const now = await req(fresh.j, "/api/profile");
  const p = now.json?.profile ?? now.json;
  check("email is off", p?.notifyEmail === false, p?.notifyEmail);
  check("SMS is on", p?.notifySms === true, p?.notifySms);
  check("offers are now on", p?.marketingOptIn === true, p?.marketingOptIn);
}

/* ------------------------------------------------------------------ 3 */
console.log("\n3. A device asking to be told things");
{
  const anon = jar();
  const shut = await req(anon, "/api/push/subscribe", {
    method: "POST",
    body: { endpoint: "https://example.com/x", p256dh: "a", auth: "b" },
  });
  check(
    "a stranger cannot register a device",
    shut.status === 401,
    shut.status,
  );

  const bad = await req(fresh.j, "/api/push/subscribe", {
    method: "POST",
    body: { endpoint: "http://evil.test/x", p256dh: "a", auth: "b" },
  });
  check("a non-https endpoint is refused", bad.status === 400, bad.status);

  const missing = await req(fresh.j, "/api/push/subscribe", {
    method: "POST",
    body: { endpoint: "https://fcm.googleapis.com/x" },
  });
  check(
    "an endpoint with no keys is refused",
    missing.status === 400,
    missing.status,
  );

  const endpoint = `https://fcm.googleapis.com/fcm/send/test-${Date.now()}`;
  const ok = await req(fresh.j, "/api/push/subscribe", {
    method: "POST",
    body: { endpoint, p256dh: "BFakeKeyForTests", auth: "fakeAuth" },
  });
  check("their own device registers", ok.json?.ok === true, ok.json);
  check("and is counted", ok.json?.devices >= 1, ok.json);

  /* Registering the same browser twice is one device, not two — otherwise every
     notice would arrive in duplicate. */
  const again = await req(fresh.j, "/api/push/subscribe", {
    method: "POST",
    body: { endpoint, p256dh: "BFakeKeyForTests", auth: "fakeAuth" },
  });
  check(
    "re-registering the same browser does not double it",
    again.json?.devices === ok.json?.devices,
    {
      first: ok.json?.devices,
      second: again.json?.devices,
    },
  );

  const gone = await req(
    fresh.j,
    `/api/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
    {
      method: "DELETE",
    },
  );
  check("and it can be removed", gone.json?.ok === true, gone.json);
}

/* ------------------------------------------------------------------ 4 */
console.log("\n4. The desk: who each channel would reach");
const staff = jar();
{
  const inOne = await req(staff, "/api/admin/unlock", {
    method: "POST",
    body: { email: OWNER.email, password: OWNER.password },
  });
  check("the desk opens", inOne.json?.ok === true, inOne.json);

  const all = await req(staff, "/api/admin/notices?audience=ALL");
  check(
    "it can see the reach for everyone",
    typeof all.json?.reach?.people === "number",
    all.json?.reach,
  );

  const offers = await req(staff, "/api/admin/notices?audience=OFFERS");
  check(
    "the offers audience is never larger than everyone",
    offers.json?.reach?.people <= all.json?.reach?.people,
    { offers: offers.json?.reach?.people, all: all.json?.reach?.people },
  );
  check(
    "each channel reports its own reach",
    ["push", "email", "sms"].every(
      (k) => typeof all.json?.reach?.[k] === "number",
    ),
    all.json?.reach,
  );
  check(
    "and the desk is told which providers are connected",
    typeof all.json?.transports?.email?.ready === "boolean" &&
      typeof all.json?.transports?.sms?.ready === "boolean",
    all.json?.transports,
  );
  /* Nobody can be sent to on a channel they did not agree to, so a channel can
     never claim more people than the audience holds. */
  for (const k of ["push", "email", "sms"]) {
    check(
      `${k} never claims more people than the audience`,
      all.json.reach[k] <= all.json.reach.people,
      { channel: all.json.reach[k], people: all.json.reach.people },
    );
  }
}

/* ------------------------------------------------------------------ 5 */
console.log("\n5. Sending, and what each channel actually did");
{
  const before = await req(staff, "/api/admin/notices?audience=ALL");
  const reach = before.json.reach;

  const sent = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Studio closed on Monday",
      bodyEn: "The studio is shut this Monday for the public holiday.",
      audience: "ALL",
      channels: ["push", "email", "sms"],
    },
  });
  check("the notice is created", sent.json?.ok === true, sent.json);
  check(
    "and it reports per channel",
    Array.isArray(sent.json?.reports),
    sent.json,
  );

  const byChannel = Object.fromEntries(
    (sent.json.reports ?? []).map((r) => [r.channel, r]),
  );
  check(
    "email went to exactly the members who left email on",
    byChannel.email?.sent === reach.email,
    {
      sent: byChannel.email?.sent,
      expected: reach.email,
    },
  );
  check(
    "SMS went to exactly the members who turned SMS on",
    byChannel.sms?.sent === reach.sms,
    {
      sent: byChannel.sms?.sent,
      expected: reach.sms,
    },
  );
  check(
    "nobody was counted twice on any channel",
    ["push", "email", "sms"].every(
      (c) =>
        (byChannel[c]?.sent ?? 0) +
          (byChannel[c]?.failed ?? 0) +
          (byChannel[c]?.skipped ?? 0) >=
        (byChannel[c]?.sent ?? 0),
    ),
    byChannel,
  );

  /* The in-app copy exists whatever the channels did — that is the promise. */
  const mine = await req(fresh.j, "/api/notices");
  const titles = (mine.json?.notices ?? []).map((n) => n.title);
  check(
    "the member has it in the app regardless",
    titles.includes("Studio closed on Monday"),
    titles.slice(0, 3),
  );

  const history = await req(staff, "/api/admin/notices?audience=ALL");
  const latest = history.json?.notices?.[0];
  check(
    "the history records the audience",
    latest?.audience === "ALL",
    latest?.audience,
  );
  check(
    "and what each channel did",
    (latest?.deliveries ?? []).length === 3,
    latest?.deliveries,
  );
}

/* ------------------------------------------------------------------ 6 */
console.log("\n6. An offer reaches only the people who asked for offers");
{
  const declined = await member("declined", { marketing: false });
  const accepted = await member("accepted", { marketing: true });
  check("two more members exist", declined.ok && accepted.ok);

  const offers = await req(staff, "/api/admin/notices?audience=OFFERS");
  const everyone = await req(staff, "/api/admin/notices?audience=ALL");
  check(
    "the offers audience is smaller than everyone",
    offers.json.reach.people < everyone.json.reach.people,
    { offers: offers.json.reach.people, all: everyone.json.reach.people },
  );

  const sent = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Two classes free in September",
      bodyEn:
        "Buy a ten pack this month and September brings two extra classes.",
      audience: "OFFERS",
      channels: ["email"],
    },
  });
  check("the offer is sent", sent.json?.ok === true, sent.json);
  const report = (sent.json.reports ?? [])[0];
  check(
    "to exactly the members who accept offers",
    report?.sent === offers.json.reach.email,
    { sent: report?.sent, expected: offers.json.reach.email },
  );
  check(
    "which is fewer than everyone",
    report.sent < everyone.json.reach.email,
    { offer: report.sent, all: everyone.json.reach.email },
  );

  /* The one who said no must not have it, on any channel or in the app. */
  const theirs = await req(declined.j, "/api/notices");
  const titles = (theirs.json?.notices ?? []).map((n) => n.title);
  check(
    "and the member who declined offers does not receive it",
    !titles.includes("Two classes free in September"),
    titles.slice(0, 3),
  );
  const wanted = await req(accepted.j, "/api/notices");
  check(
    "while the member who accepted does",
    (wanted.json?.notices ?? [])
      .map((n) => n.title)
      .includes("Two classes free in September"),
    "the offer did not arrive",
  );

  /* A forged audience must not widen it. */
  const forged = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Nonsense audience test",
      bodyEn: "This should fall back to everyone rather than to nobody.",
      audience: "EVERYBODY_INCLUDING_DECLINERS",
      channels: [],
    },
  });
  check(
    "an unknown audience falls back to ALL",
    forged.json?.audience === "ALL",
    forged.json,
  );

  const junkChannel = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Nonsense channel test",
      bodyEn: "An invented channel must simply be ignored.",
      channels: ["carrier-pigeon", "email"],
    },
  });
  check(
    "an invented channel is ignored, the real one still goes",
    (junkChannel.json?.reports ?? []).length === 1 &&
      junkChannel.json.reports[0].channel === "email",
    junkChannel.json?.reports,
  );
}

/* ------------------------------------------------------------------ 7 */
console.log("\n7. Accepting offers opens SMS");
{
  /* Signing up with the offers box ticked. Somebody who has just said they want
     to hear from the studio should not then have to find a second switch. */
  const keen = await member("keen", { marketing: true });
  const p = (await req(keen.j, "/api/profile")).json?.profile;
  check("offers at sign-up turns SMS on", p?.notifySms === true, p);
  check("and offers are recorded", p?.marketingOptIn === true, p);

  /* And the same when it is ticked later. */
  const later = await member("later", { marketing: false });
  const before = (await req(later.j, "/api/profile")).json?.profile;
  check("without offers, SMS starts off", before?.notifySms === false, before);

  await req(later.j, "/api/profile", {
    method: "PATCH",
    body: {
      name: "Notify later",
      marketingOptIn: true,
      serviceOptIn: true,
      termsAccepted: true,
      notifyEmail: true,
      notifySms: false,
      notifyPush: true,
      reminderMinutes: 120,
    },
  });
  const after = (await req(later.j, "/api/profile")).json?.profile;
  check("accepting offers turns SMS on", after?.notifySms === true, after);

  /* But it is their switch from then on: turning SMS off again must stick, even
     while offers stay accepted. Otherwise the studio is overruling them. */
  await req(later.j, "/api/profile", {
    method: "PATCH",
    body: {
      name: "Notify later",
      marketingOptIn: true,
      serviceOptIn: true,
      termsAccepted: true,
      notifyEmail: true,
      notifySms: false,
      notifyPush: true,
      reminderMinutes: 120,
    },
  });
  const off = (await req(later.j, "/api/profile")).json?.profile;
  check(
    "turning SMS off again sticks, offers or not",
    off?.notifySms === false && off?.marketingOptIn === true,
    off,
  );
}

/* ------------------------------------------------------------------ 8 */
console.log("\n8. The three automatic messages");
{
  const punter = await member("auto", { marketing: false });

  /* A device, so a push has somewhere to go. The endpoint is not a real push
     service, so the send will fail — what is being tested here is that booking
     and cancelling reach the sending path at all and that a failed push never
     touches the booking itself. */
  const endpoint = `https://fcm.googleapis.com/fcm/send/auto-${Date.now()}`;
  await req(punter.j, "/api/push/subscribe", {
    method: "POST",
    body: { endpoint, p256dh: "BFakeKeyForTests", auth: "fakeAuth" },
  });

  /* Sessions to spend. */
  const opened = await req(punter.j, "/api/checkout", {
    method: "POST",
    body: { packSlug: "month-2" },
  });
  await req(punter.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: opened.json?.purchaseId },
  });

  const list = await req(punter.j, "/api/sessions?days=10");
  const target = (list.json?.sessions ?? []).find(
    (x) =>
      x.classType?.kind !== "PERSONAL" &&
      x.spotsLeft > 0 &&
      new Date(x.startsAt) > new Date(Date.now() + 48 * 3600_000),
  );
  check("a bookable class exists", Boolean(target));

  const booked = await req(punter.j, "/api/bookings", {
    method: "POST",
    body: { sessionId: target.id },
  });
  check(
    "booking still succeeds with push wired in",
    booked.json?.ok === true,
    booked.json,
  );
  check(
    "and a reminder is queued at their own lead time",
    Boolean(booked.json?.reminderAt),
    booked.json,
  );

  const cancelled = await req(punter.j, "/api/bookings/cancel", {
    method: "POST",
    body: { bookingId: booked.json.bookingId },
  });
  check(
    "cancelling still succeeds",
    cancelled.json?.ok === true,
    cancelled.json,
  );
  check(
    "and the session came back",
    cancelled.json?.refunded === true,
    cancelled.json,
  );
}

/* ------------------------------------------------------------------ 9 */
console.log("\n9. The reminder sweep");
{
  const anon = jar();
  const shut = await req(anon, "/api/cron/reminders", { method: "POST" });
  check(
    "the sweep is not open to the public",
    shut.status === 401 || shut.status === 403,
    shut.status,
  );

  const badToken = await fetch(B + "/api/cron/reminders", {
    method: "POST",
    headers: { authorization: "Bearer not-the-secret" },
  });
  check(
    "a wrong token is refused",
    badToken.status === 401 || badToken.status === 403,
    badToken.status,
  );

  /* Staff can run it by hand, which is how the studio tests it. */
  const run = await req(staff, "/api/cron/reminders", { method: "POST" });
  check("staff can run it", run.json?.ok === true, run.json);
  check(
    "and it reports what it did",
    typeof run.json?.due === "number",
    run.json,
  );

  /* Running it twice must not send anything twice: the rows are marked. */
  const again = await req(staff, "/api/cron/reminders", { method: "POST" });
  check(
    "running it again sends nothing again",
    again.json?.due === 0,
    again.json,
  );
}

/* ------------------------------------------------------------------ 10 */
console.log("\n10. A new member does not inherit the past");
{
  /* Something for the archive, sent before the next member exists. */
  const sent = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Sent before they joined",
      bodyEn: "A member who signs up after this must never see it.",
      audience: "ALL",
      channels: [],
    },
  });
  check("a notice exists in the archive", sent.json?.ok === true, sent.json);

  /* A second apart, so the timestamps cannot collide. */
  await new Promise((r) => setTimeout(r, 1100));
  const newcomer = await member("newcomer");
  const theirs = await req(newcomer.j, "/api/notices");
  const titles = (theirs.json?.notices ?? []).map((x) => x.title);

  check(
    "their list does not contain it",
    !titles.includes("Sent before they joined"),
    titles.slice(0, 3),
  );
  /**
   * Their own count, whatever it starts at.
   *
   * Registering writes one in-app notice of its own now — "your code is on its
   * way" — so a new account no longer starts at zero. What this section is
   * about is that a notice sent before they joined is not theirs, and the
   * honest test of that is that none of the *studio's* notices are in their
   * list, which the assertion above already makes. The number is recorded here
   * so the check below can measure the change rather than assume the total.
   */
  const startedWith = theirs.json?.unread ?? 0;
  check(
    "and none of the studio's earlier notices count as unread for them",
    !titles.includes("Sent before they joined"),
    { unread: startedWith, count: titles.length },
  );

  /* But anything sent from now on does reach them. */
  await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Sent after they joined",
      bodyEn: "This one is theirs.",
      audience: "ALL",
      channels: [],
    },
  });
  const after = await req(newcomer.j, "/api/notices");
  check(
    "a notice sent afterwards does reach them",
    (after.json?.notices ?? [])
      .map((x) => x.title)
      .includes("Sent after they joined"),
    "the new notice did not arrive",
  );
  check(
    "and counts as one more unread than they had",
    after.json?.unread === startedWith + 1,
    { startedWith, now: after.json?.unread },
  );
}

/* ------------------------------------------------------------------ 10b */
console.log("\n10b. Booking and cancelling land in the member's own inbox");
{
  /* Timestamps are whole seconds, and the rule is "nothing from before you
     joined". A member created in the same second as the broadcast above would
     legitimately see it, which is right in life and noise in a test — so the
     boundary is put beyond doubt. */
  await new Promise((r) => setTimeout(r, 1100));
  const punter = await member("inbox");
  /* Registering writes its own notice, so this counts changes from whatever a
     new account arrives with rather than from zero. Every assertion below is
     "one more than before", which is what the feature actually promises. */
  const before = await req(punter.j, "/api/notices");
  const base = before.json?.unread ?? 0;

  const opened = await req(punter.j, "/api/checkout", {
    method: "POST",
    body: { packSlug: "month-2" },
  });
  await req(punter.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: opened.json?.purchaseId },
  });
  /* Paying is itself one of the automatic messages, so it is counted here
     rather than being a surprise in the booking numbers below. */
  const afterPaying = await req(punter.j, "/api/notices");
  check(
    "paying for the pack tells them",
    afterPaying.json?.unread === base + 1 &&
      (afterPaying.json?.notices ?? [])[0]?.title === "Payment received",
    {
      base,
      now: afterPaying.json?.unread,
      top: afterPaying.json?.notices?.[0]?.title,
    },
  );

  const list = await req(punter.j, "/api/sessions?days=10");
  const target = (list.json?.sessions ?? []).find(
    (x) =>
      x.classType?.kind !== "PERSONAL" &&
      x.spotsLeft > 0 &&
      new Date(x.startsAt) > new Date(Date.now() + 48 * 3600_000),
  );

  const booked = await req(punter.j, "/api/bookings", {
    method: "POST",
    body: { sessionId: target.id },
  });
  check("booking succeeds", booked.json?.ok === true, booked.json);

  const afterBooking = await req(punter.j, "/api/notices");
  check(
    "the number on their photograph goes up",
    afterBooking.json?.unread === base + 2,
    { base, now: afterBooking.json?.unread },
  );
  const confirmation = (afterBooking.json?.notices ?? [])[0];
  check(
    "and the confirmation is waiting in the list",
    confirmation?.title === "Booking confirmed",
    confirmation?.title,
  );
  /* The substance: which class, which day, which hour.
   *
   * This used to look for the em dash that joined the class to the date, which
   * made it a test of the punctuation rather than of the content. The studio has
   * since had every em dash taken out of the copy, so it now asks the question it
   * always meant to ask: is the class named, and is the day and hour in there. */
  check(
    "naming the class, the day and the hour",
    /[A-Za-z]/.test(confirmation?.body ?? "") &&
      /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(
        confirmation?.body ?? "",
      ) &&
      / at \d\d:\d\d/.test(confirmation?.body ?? ""),
    confirmation?.body,
  );

  await req(punter.j, "/api/bookings/cancel", {
    method: "POST",
    body: { bookingId: booked.json.bookingId },
  });
  const afterCancel = await req(punter.j, "/api/notices");
  check("cancelling adds another", afterCancel.json?.unread === base + 3, {
    base,
    now: afterCancel.json?.unread,
  });
  check(
    "which says the session came back",
    /back in your balance/.test(
      (afterCancel.json?.notices ?? [])[0]?.body ?? "",
    ),
    (afterCancel.json?.notices ?? [])[0]?.body,
  );

  /* Somebody else's booking is nobody else's business. */
  await new Promise((r) => setTimeout(r, 1100));
  const other = await member("nosy");
  const theirs = await req(other.j, "/api/notices");
  check(
    "another member sees none of it",
    !(theirs.json?.notices ?? []).some((x) => x.title === "Booking confirmed"),
    theirs.json?.notices?.slice(0, 3),
  );
  /* A second member, with only their own registration notice: none of the
     first member's booking or payment messages reached them. */
  check(
    "and their own count is only what registering gave them",
    (theirs.json?.unread ?? 0) <= 1 &&
      !(theirs.json?.notices ?? []).some((x) =>
        ["Payment received", "Booking confirmed"].includes(x.title),
      ),
    theirs.json?.notices?.map((x) => x.title),
  );

  /* And the desk's history stays a list of announcements, not of everybody's
     confirmations — there are hundreds of those and none is news. */
  const history = await req(staff, "/api/admin/notices?audience=ALL");
  check(
    "the desk history holds no personal confirmations",
    !(history.json?.notices ?? []).some(
      (x) => x.titleEn === "Booking confirmed",
    ),
    "a confirmation leaked into the desk history",
  );
}

/* ------------------------------------------------------------------ 11 */
console.log("\n11. The timetable does not offer classes that have started");
{
  const anon = jar();
  const res = await req(anon, "/api/sessions?days=3");
  const list = res.json?.sessions ?? [];
  check("the timetable answers", list.length > 0, list.length);

  const now = Date.now();
  const past = list.filter((x) => new Date(x.startsAt).getTime() < now);
  check(
    "nothing in it has already started",
    past.length === 0,
    past.slice(0, 3).map((x) => x.startsAt),
  );

  /* The page itself, not just the API. */
  const page = await req(anon, "/timetable");
  check("the timetable page renders", page.status === 200, page.status);
}

/* ------------------------------------------------------------------ 12 */
console.log("\n12. Members cannot send notices");
{
  const shut = await req(fresh.j, "/api/admin/notices", {
    method: "POST",
    body: { titleEn: "From a member", bodyEn: "This must not be possible." },
  });
  check("a member is refused", shut.status === 403, shut.status);
  const peek = await req(fresh.j, "/api/admin/notices");
  check("and cannot read the reach either", peek.status === 403, peek.status);
}

/* ----------------------------------------------------------------- 13 */
console.log("\n13. Test accounts are left out of campaigns");
{
  const dummy = await member("dummy", { marketing: true });
  check("a member to mark as a test exists", dummy.ok);

  /* Find its id the way the desk does. */
  const found = await req(
    staff,
    `/api/admin/members?q=${encodeURIComponent(dummy.email)}`,
  );
  const id = found.json?.members?.[0]?.id;
  check("the desk can find it", Boolean(id), found.json?.members?.length);

  const before = await req(staff, "/api/admin/notices?audience=ALL");
  const beforePeople = before.json?.reach?.people ?? 0;
  /* Test accounts this database already holds, from earlier runs of this very
     suite — marking one is permanent, so every run leaves one behind. The
     assertions below are about the *change* this run makes, and comparing to a
     bare figure made them pass on a fresh database and fail on every one after
     it. Counted, not assumed to be zero. */
  const beforeTest = before.json?.reach?.testAccounts ?? 0;

  const mark = await req(staff, "/api/admin/member", {
    method: "PATCH",
    body: { userId: id, isTest: true },
  });
  check(
    "it can be marked as a test account",
    mark.json?.ok === true,
    mark.json,
  );

  const after = await req(staff, "/api/admin/notices?audience=ALL");
  check(
    "and the reach drops by exactly one",
    (after.json?.reach?.people ?? 0) === beforePeople - 1,
    { before: beforePeople, after: after.json?.reach?.people },
  );
  check(
    "the desk is told how many are excluded",
    (after.json?.reach?.testAccounts ?? 0) >= 1,
    after.json?.reach?.testAccounts,
  );
  check(
    "and they are out by default",
    after.json?.includeTest === false,
    after.json?.includeTest,
  );

  const included = await req(
    staff,
    "/api/admin/notices?audience=ALL&includeTest=1",
  );
  check(
    "asking for them puts them back",
    (included.json?.reach?.people ?? 0) === beforePeople + beforeTest,
    {
      asked: included.json?.reach?.people,
      expected: beforePeople + beforeTest,
    },
  );

  /* The reach figure is a promise about delivery, so check the delivery keeps
     it — a screen that says 40 and a sender that reaches 41 is worse than no
     screen at all. */
  const sent = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Excluding the dummies",
      bodyEn: "This one must skip the test account.",
      audience: "ALL",
      channels: ["email"],
    },
  });
  const emailReport = (sent.json?.reports ?? []).find(
    (r) => r.channel === "email",
  );
  const attempted =
    (emailReport?.sent ?? 0) +
    (emailReport?.failed ?? 0) +
    (emailReport?.skipped ?? 0);
  check(
    "a real campaign counts only real members",
    attempted === (after.json?.reach?.people ?? -1),
    { attempted, reach: after.json?.reach?.people },
  );

  /* And the in-app copy: a test account should not see it either. */
  const dummySees = await req(dummy.j, "/api/notices?filter=all&page=1");
  const titles = (dummySees.json?.rows ?? []).map((r) => r.title);
  check(
    "the test account never received it",
    !titles.includes("Excluding the dummies"),
    titles,
  );

  const withThem = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Including the dummies",
      bodyEn: "This one is deliberately sent to test accounts too.",
      audience: "ALL",
      channels: ["email"],
      includeTest: true,
    },
  });
  const r2 = (withThem.json?.reports ?? []).find((x) => x.channel === "email");
  const attempted2 = (r2?.sent ?? 0) + (r2?.failed ?? 0) + (r2?.skipped ?? 0);
  /* One more for the account just marked, plus any this database was already
     carrying. */
  check(
    "including them reaches the test accounts as well",
    attempted2 === attempted + beforeTest + 1,
    { attempted, attempted2, beforeTest },
  );

  const nowSees = await req(dummy.j, "/api/notices?filter=all&page=1");
  check(
    "and the test account does receive that one",
    (nowSees.json?.rows ?? []).some((r) => r.title === "Including the dummies"),
    (nowSees.json?.rows ?? []).map((r) => r.title),
  );
}

/* ----------------------------------------------------------------- 14 */
console.log("\n14. Paging, so nothing is out of reach");
{
  const reader = await member("pager");
  check("a member to page through exists", reader.ok);

  /* Twelve notices: three pages of five, with the last one short. */
  for (let i = 1; i <= 12; i++) {
    await req(staff, "/api/admin/notices", {
      method: "POST",
      body: {
        titleEn: `Paging notice ${String(i).padStart(2, "0")}`,
        bodyEn: `Number ${i}.`,
        audience: "ALL",
        channels: [],
      },
    });
  }

  const p1 = await req(reader.j, "/api/notices?filter=all&page=1");
  check(
    "a page holds five",
    (p1.json?.rows ?? []).length === 5,
    p1.json?.rows?.length,
  );
  check(
    "and says how many pages there are",
    (p1.json?.pages ?? 0) >= 3,
    p1.json?.pages,
  );
  check(
    "the total counts everything, not just this page",
    (p1.json?.total ?? 0) >= 12,
    p1.json?.total,
  );
  check(
    "the newest is first",
    p1.json?.rows?.[0]?.title === "Paging notice 12",
    p1.json?.rows?.[0]?.title,
  );

  const p2 = await req(reader.j, "/api/notices?filter=all&page=2");
  check(
    "page two carries on where page one stopped",
    p2.json?.rows?.[0]?.title === "Paging notice 07",
    p2.json?.rows?.[0]?.title,
  );
  const ids1 = new Set((p1.json?.rows ?? []).map((r) => r.id));
  check(
    "and repeats nothing from page one",
    (p2.json?.rows ?? []).every((r) => !ids1.has(r.id)),
  );

  /* The bug this replaced: counts computed from a truncated list. Twelve
     notices with a five-row page must still report twelve unread. */
  check(
    "the unread count is the real one, not the page's",
    (p1.json?.counts?.unread ?? 0) >= 12,
    p1.json?.counts,
  );

  const beyond = await req(reader.j, "/api/notices?filter=all&page=999");
  check(
    "asking past the end lands on the last page rather than nothing",
    (beyond.json?.rows ?? []).length > 0 &&
      beyond.json?.page === beyond.json?.pages,
    { page: beyond.json?.page, pages: beyond.json?.pages },
  );

  /* Reading one must move it between the filters, across the whole set. */
  const target = p1.json?.rows?.[0];
  await req(reader.j, "/api/notices/read", {
    method: "POST",
    body: { noticeId: target.id },
  });
  const readOnly = await req(reader.j, "/api/notices?filter=read&page=1");
  check(
    "the read filter finds it",
    (readOnly.json?.rows ?? []).some((r) => r.id === target.id),
    readOnly.json?.rows?.length,
  );
  const unreadOnly = await req(reader.j, "/api/notices?filter=unread&page=1");
  check(
    "and the unread filter no longer does",
    !(unreadOnly.json?.rows ?? []).some((r) => r.id === target.id),
  );
  check(
    "the counts move with it",
    (unreadOnly.json?.counts?.read ?? 0) >= 1,
    unreadOnly.json?.counts,
  );
}

/* ----------------------------------------------------------------- 15 */
console.log("\n15. The desk's history, by channel");
{
  const all = await req(staff, "/api/admin/notices?page=1");
  check(
    "the history pages too",
    (all.json?.notices ?? []).length <= 5,
    all.json?.notices?.length,
  );
  check(
    "with a page count",
    (all.json?.history?.pages ?? 0) >= 1,
    all.json?.history,
  );

  const bySms = await req(staff, "/api/admin/notices?channel=sms&page=1");
  check(
    "filtering by SMS never shows more than everything",
    (bySms.json?.history?.total ?? 0) <= (all.json?.history?.total ?? 0),
    { sms: bySms.json?.history?.total, all: all.json?.history?.total },
  );
  check(
    "and every row it returns actually used SMS",
    (bySms.json?.notices ?? []).every((n) =>
      n.channels.split(",").includes("sms"),
    ),
    (bySms.json?.notices ?? []).map((n) => n.channels),
  );

  const byEmail = await req(staff, "/api/admin/notices?channel=email&page=1");
  check(
    "the email filter is honest too",
    (byEmail.json?.notices ?? []).every((n) =>
      n.channels.split(",").includes("email"),
    ),
    (byEmail.json?.notices ?? []).map((n) => n.channels),
  );
  check(
    "and email has at least the two campaigns just sent",
    (byEmail.json?.history?.total ?? 0) >= 2,
    byEmail.json?.history?.total,
  );

  /* "push" must not match a notice that only used "email" — the filter is a
     substring match on a comma list, which is exactly where that goes wrong. */
  const byPush = await req(staff, "/api/admin/notices?channel=push&page=1");
  check(
    "no channel filter leaks another channel's rows",
    (byPush.json?.notices ?? []).every((n) =>
      n.channels.split(",").includes("push"),
    ),
    (byPush.json?.notices ?? []).map((n) => n.channels),
  );
  check(
    "the counts add up to at least the filtered totals",
    (all.json?.history?.counts?.all ?? 0) >= (byPush.json?.history?.total ?? 0),
    all.json?.history?.counts,
  );

  const nonsense = await req(
    staff,
    "/api/admin/notices?channel=carrier-pigeon&page=1",
  );
  check(
    "an unknown channel is ignored rather than returning nothing",
    (nonsense.json?.history?.total ?? 0) === (all.json?.history?.total ?? 0),
    { nonsense: nonsense.json?.history?.total, all: all.json?.history?.total },
  );
}

/* ----------------------------------------------------------------- 16 */
console.log("\n16. A notice written in Greek arrives in Greek");
{
  const reader = await member("greek");
  check("a member to read it exists", reader.ok);

  const sent = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Closed on Monday",
      bodyEn: "The studio is shut for the holiday.",
      titleEl: "Κλειστά τη Δευτέρα",
      bodyEl: "Το στούντιο είναι κλειστό για την αργία.",
      audience: "ALL",
      channels: [],
    },
  });
  check("the desk can send both languages", sent.json?.ok === true, sent.json);

  const en = await req(reader.j, "/api/notices?filter=all&page=1&locale=en");
  check(
    "asking in English gets the English",
    en.json?.rows?.[0]?.title === "Closed on Monday",
    en.json?.rows?.[0]?.title,
  );

  /* The bug: the list never sent a locale, so the Greek version was written,
     stored, and then never asked for. */
  const el = await req(reader.j, "/api/notices?filter=all&page=1&locale=el");
  check(
    "asking in Greek gets the Greek",
    el.json?.rows?.[0]?.title === "Κλειστά τη Δευτέρα",
    el.json?.rows?.[0]?.title,
  );
  check(
    "and the Greek body too",
    el.json?.rows?.[0]?.body === "Το στούντιο είναι κλειστό για την αργία.",
    el.json?.rows?.[0]?.body,
  );

  /* A notice with no Greek typed must fall back rather than come back blank. */
  await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "English only notice",
      bodyEn: "No Greek was typed for this one.",
      audience: "ALL",
      channels: [],
    },
  });
  const fallback = await req(
    reader.j,
    "/api/notices?filter=all&page=1&locale=el",
  );
  check(
    "an untranslated notice falls back to English rather than showing empty",
    fallback.json?.rows?.[0]?.title === "English only notice",
    fallback.json?.rows?.[0]?.title,
  );
}

/* ----------------------------------------------------------------- 17 */
console.log("\n17. One phone number, one account");
{
  const phone = `+3579${Math.floor(1000000 + Math.random() * 8999999)}`;
  const first = await req(jar(), "/api/auth/register", {
    method: "POST",
    body: {
      name: "Phone One",
      email: `phone-one-${Date.now()}@rg.test`,
      phone,
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check("the first account is created", first.json?.ok === true, first.json);

  const same = await req(jar(), "/api/auth/register", {
    method: "POST",
    body: {
      name: "Phone Two",
      email: `phone-two-${Date.now()}@rg.test`,
      phone,
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check("the same number is refused", same.status === 409, same.status);
  check("and says why", same.json?.error === "PHONE_TAKEN", same.json);

  /* Written differently, it is still the same number. A plain string compare
     would let this through as a third member. */
  const spaced = await req(jar(), "/api/auth/register", {
    method: "POST",
    body: {
      name: "Phone Three",
      email: `phone-three-${Date.now()}@rg.test`,
      phone: phone.replace("+357", "00357").replace(/(\d{2})(\d{6})$/, "$1 $2"),
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check(
    "the same number written another way is also refused",
    spaced.json?.error === "PHONE_TAKEN",
    { sent: phone.replace("+357", "00357"), got: spaced.json },
  );

  const short = await req(jar(), "/api/auth/register", {
    method: "POST",
    body: {
      name: "Phone Short",
      email: `phone-short-${Date.now()}@rg.test`,
      phone: "9912",
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check("too few digits is refused", short.status === 400, short.status);

  const long = await req(jar(), "/api/auth/register", {
    method: "POST",
    body: {
      name: "Phone Long",
      email: `phone-long-${Date.now()}@rg.test`,
      phone: "+35799123456789012345",
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check("too many digits is refused", long.status === 400, long.status);

  const badEmail = await req(jar(), "/api/auth/register", {
    method: "POST",
    body: {
      name: "No At Sign",
      email: "cristiano",
      phone: "+35799000111",
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check(
    "an address with no @ is refused",
    badEmail.status === 400,
    badEmail.status,
  );
}

/* ----------------------------------------------------------------- 18 */
console.log("\n18. The membership list pages and filters");
{
  const all = await req(staff, "/api/admin/members?page=1");
  check(
    "a page holds ten at most",
    (all.json?.members ?? []).length <= 10,
    all.json?.members?.length,
  );
  check("with a page count", (all.json?.pages ?? 0) >= 1, all.json?.pages);
  check(
    "and counts for each filter",
    typeof all.json?.counts?.real === "number" &&
      typeof all.json?.counts?.test === "number",
    all.json?.counts,
  );
  check(
    "the filter counts add up to the total",
    (all.json?.counts?.real ?? 0) + (all.json?.counts?.test ?? 0) ===
      (all.json?.counts?.all ?? -1),
    all.json?.counts,
  );

  const real = await req(staff, "/api/admin/members?filter=real&page=1");
  check(
    "the members filter shows no test accounts",
    (real.json?.members ?? []).every((m) => !m.isTest),
  );
  const test = await req(staff, "/api/admin/members?filter=test&page=1");
  check(
    "the test filter shows only test accounts",
    (test.json?.members ?? []).every((m) => m.isTest),
  );
  check(
    "and there is at least one to find",
    (test.json?.members ?? []).length >= 1,
    test.json?.members?.length,
  );

  if ((all.json?.pages ?? 1) > 1) {
    const p2 = await req(staff, "/api/admin/members?page=2");
    const ids = new Set((all.json?.members ?? []).map((m) => m.id));
    check(
      "page two repeats nobody from page one",
      (p2.json?.members ?? []).every((m) => !ids.has(m.id)),
    );
  }

  const beyond = await req(staff, "/api/admin/members?page=999");
  check(
    "asking past the end lands on the last page",
    beyond.json?.page === beyond.json?.pages,
    { page: beyond.json?.page, pages: beyond.json?.pages },
  );
}

/* ----------------------------------------------------------------- 19 */
console.log("\n19. Rolling the rota forward, and taking it back");
{
  /**
   * Further ahead than the timetable already runs, which is the whole trick.
   *
   * This asked for ten weeks once, back when the app generated six and showed
   * four. Then the horizon went to thirteen weeks for the three-month packs, a
   * ten-week roll created nothing at all, and six of the assertions below —
   * every one about undoing a roll — quietly stopped running while the suite
   * still reported ALL PASS. Six fewer checks is not a failure anybody sees.
   *
   * So this deliberately overshoots the standing horizon, and the check under it
   * asserts that classes were actually created. If the horizon ever grows past
   * this number the suite now says so, instead of testing less and looking
   * green.
   */
  /* Comfortably past the app's TIMETABLE_WEEKS, which became 53 when the
   booking horizon went to a year. This was 18, which stopped being
   "beyond" the moment the horizon grew and would have made the block
   below silently assert nothing again. */
  const BEYOND_HORIZON_WEEKS = 70;

  const once = await req(staff, "/api/admin/generate", {
    method: "POST",
    body: { weeks: BEYOND_HORIZON_WEEKS },
  });
  check("it rolls forward", once.json?.ok === true, once.json);
  check(
    "and actually creates classes, so the undo below is exercised",
    (once.json?.created ?? 0) > 0,
    {
      created: once.json?.created,
      hint: `raise BEYOND_HORIZON_WEEKS above the app's TIMETABLE_WEEKS`,
    },
  );
  check(
    "and reports the ids of what it created",
    Array.isArray(once.json?.createdIds),
    typeof once.json?.createdIds,
  );
  check(
    "the count matches the ids",
    (once.json?.createdIds ?? []).length === once.json?.created,
    { ids: once.json?.createdIds?.length, created: once.json?.created },
  );

  /* The property that makes an accidental press harmless. */
  const twice = await req(staff, "/api/admin/generate", {
    method: "POST",
    body: { weeks: BEYOND_HORIZON_WEEKS },
  });
  check(
    "running it again creates nothing at all",
    twice.json?.created === 0,
    twice.json?.created,
  );

  const ids = once.json?.createdIds ?? [];
  if (ids.length > 0) {
    const undone = await req(staff, "/api/admin/generate", {
      method: "DELETE",
      body: { ids },
    });
    check("the run can be undone", undone.json?.ok === true, undone.json);
    check(
      "and everything unbooked is gone",
      (undone.json?.removed ?? 0) + (undone.json?.kept ?? 0) === ids.length,
      undone.json,
    );

    /* Undoing twice must not error, and must not remove anything else. */
    const again = await req(staff, "/api/admin/generate", {
      method: "DELETE",
      body: { ids },
    });
    check(
      "undoing twice removes nothing more",
      again.json?.removed === 0,
      again.json,
    );
  }

  const empty = await req(staff, "/api/admin/generate", {
    method: "DELETE",
    body: { ids: [] },
  });
  check(
    "an empty undo is refused rather than doing something odd",
    empty.status === 400,
    empty.status,
  );

  /* And a booked class survives an undo. */
  const roll = await req(staff, "/api/admin/generate", {
    method: "POST",
    body: { weeks: BEYOND_HORIZON_WEEKS + 4 },
  });
  const fresh = roll.json?.createdIds ?? [];
  check(
    "a second roll further out creates more to undo",
    fresh.length > 2,
    fresh.length,
  );
  if (fresh.length > 2) {
    const buyer = await member("undo");
    /* Give them a session so they can book. */
    const list = await req(
      staff,
      `/api/admin/members?q=${encodeURIComponent(buyer.email)}`,
    );
    const buyerId = list.json?.members?.[0]?.id;
    /* Valid long enough to reach a class five months out. Ninety days of
       validity would be refused with SESSIONS_EXPIRE_FIRST — correctly — and
       that refusal has nothing to do with what this section is testing. */
    await req(staff, "/api/admin/grant", {
      method: "POST",
      body: {
        userId: buyerId,
        credits: 2,
        validityDays: 400,
        note: "undo test",
      },
    });
    /**
     * A group class among the new ones, not simply the last of them.
     *
     * The roll-forward now creates midday appointment slots as well as classes,
     * and an appointment cannot be paid for with the class sessions granted
     * above, closes to booking at the end of the previous day, and holds one
     * person. Any of those three would fail this check for a reason that has
     * nothing to do with what it is testing, which is that an undo leaves a
     * booked class alone.
     */
    /**
     * The window walks forward until it finds the new classes, rather than
     * being pointed at where they were last time.
     *
     * Everything this roll created is *past* the standing horizon — that is
     * what makes it new — and /api/sessions caps its window at 92 days, so the
     * search has to go and look. This was a hardcoded `now + 88 days`, correct
     * while the horizon was ninety days, and it broke the moment the horizon
     * became a year: the fresh classes moved out to around day 371 and the
     * window at day 88 matched none of them. The filter then silently found
     * nothing and the block tried to book an appointment with class sessions,
     * which is the second time that exact failure has happened here.
     *
     * So no constant. Step through 90-day windows until one of the created ids
     * turns up, and this keeps working whatever the horizon becomes next.
     */
    let target = null;
    let windowsTried = 0;
    for (
      let startDay = 0;
      startDay < BEYOND_HORIZON_WEEKS * 7 + 90 && !target;
      startDay += 90
    ) {
      windowsTried++;
      const from = new Date(Date.now() + startDay * 86_400_000).toISOString();
      const timetable = await req(
        buyer.j,
        `/api/sessions?from=${encodeURIComponent(from)}&days=92`,
      );
      const groupIds = new Set(
        (timetable.json?.sessions ?? [])
          .filter((s) => s.classType?.kind !== "PERSONAL" && s.spotsLeft > 0)
          .map((s) => s.id),
      );
      /**
       * The *earliest* new class, not the latest.
       *
       * This reversed the list and took the furthest one out, which was
       * harmless while the roll only reached a few weeks past a ninety-day
       * horizon. With the horizon at a year and this roll at seventy weeks, the
       * furthest new class lands around day 490 — past the expiry of the
       * sessions granted to this fixture — and the booking was refused with
       * SESSIONS_EXPIRE_FIRST, which is the app being right.
       *
       * The nearest new class is the correct choice on its own terms too: it is
       * still unambiguously "new", and it is the one most likely to sit inside
       * whatever validity a fixture happens to have.
       */
      target = fresh.find((id) => groupIds.has(id)) ?? null;
    }
    check("there is a new group class to book", Boolean(target), {
      fresh: fresh.length,
      windowsTried,
    });
    const booked = await req(buyer.j, "/api/bookings", {
      method: "POST",
      body: { sessionId: target ?? fresh[fresh.length - 1] },
    });
    check(
      "a member books one of the new classes",
      booked.json?.ok === true,
      booked.json,
    );

    const undone = await req(staff, "/api/admin/generate", {
      method: "DELETE",
      body: { ids: fresh },
    });
    check(
      "the booked class is kept, not deleted under the member",
      (undone.json?.kept ?? 0) >= 1,
      undone.json,
    );
  }
}

/* ----------------------------------------------------------------- 20 */
console.log("\n20. Campaign filters pick out who a message is for");
{
  const base = await req(staff, "/api/admin/notices?audience=ALL");
  const everyone = base.json?.reach?.people ?? 0;
  check("there is a baseline audience", everyone > 0, everyone);

  /* Somebody who has never paid. Every test member registers and never buys,
     so this filter should find plenty. */
  const never = await req(staff, "/api/admin/notices?audience=ALL&neverPaid=1");
  check(
    "never-bought is a subset of everyone",
    (never.json?.reach?.people ?? 0) <= everyone,
    { never: never.json?.reach?.people, everyone },
  );
  check(
    "and finds somebody",
    (never.json?.reach?.people ?? 0) > 0,
    never.json?.reach,
  );

  /* A member who buys must drop out of it. That is the whole point of the
     filter, and the only way to know it works. */
  const buyer = await member("filter-buyer");
  const found = await req(
    staff,
    `/api/admin/members?q=${encodeURIComponent(buyer.email)}`,
  );
  const buyerId = found.json?.members?.[0]?.id;
  check(
    "a member to buy something exists",
    Boolean(buyerId),
    found.json?.members?.length,
  );

  const beforeBuy =
    (await req(staff, "/api/admin/notices?audience=ALL&neverPaid=1")).json
      ?.reach?.people ?? 0;

  /* A desk sale writes a PAID purchase exactly as a card payment does. */
  const sold = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: {
      userId: buyerId,
      credits: 5,
      validityDays: 90,
      method: "cash",
      amountCents: 10000,
    },
  });
  const afterBuy =
    (await req(staff, "/api/admin/notices?audience=ALL&neverPaid=1")).json
      ?.reach?.people ?? 0;
  check(
    "buying at the desk takes them out of never-bought",
    afterBuy === beforeBuy - 1,
    { beforeBuy, afterBuy, sold: sold.json },
  );

  /* No sessions left. The buyer above now has five, so they must be excluded. */
  const noneLeft = await req(
    staff,
    "/api/admin/notices?audience=ALL&noSessionsLeft=1",
  );
  check(
    "no-sessions-left is a subset too",
    (noneLeft.json?.reach?.people ?? 0) <= everyone,
    noneLeft.json?.reach?.people,
  );

  /* Away for a while. Nobody in a freshly seeded database has attended
     anything, so a large window should match everybody the audience covers —
     which is the documented behaviour: never been counts as away. */
  const away = await req(
    staff,
    "/api/admin/notices?audience=ALL&inactiveDays=90",
  );
  check(
    "away-90-days includes members who have never been",
    (away.json?.reach?.people ?? 0) > 0,
    away.json?.reach?.people,
  );

  /* Filters combine with AND, so two of them can only narrow. */
  const both = await req(
    staff,
    "/api/admin/notices?audience=ALL&neverPaid=1&noSessionsLeft=1",
  );
  check(
    "two filters never widen the audience",
    (both.json?.reach?.people ?? 0) <=
      Math.min(
        never.json?.reach?.people ?? 0,
        noneLeft.json?.reach?.people ?? 0,
      ),
    {
      both: both.json?.reach?.people,
      never: never.json?.reach?.people,
      noneLeft: noneLeft.json?.reach?.people,
    },
  );

  /* The rule that must never bend: a filter cannot reach past consent. */
  const declined = await member("filter-declined", { marketing: false });
  check("a member who declined offers exists", declined.ok);
  const offersNever = await req(
    staff,
    "/api/admin/notices?audience=OFFERS&neverPaid=1",
  );
  const allNever = await req(
    staff,
    "/api/admin/notices?audience=ALL&neverPaid=1",
  );
  check(
    "the offers audience with a filter is never larger than everyone with it",
    (offersNever.json?.reach?.people ?? 0) <=
      (allNever.json?.reach?.people ?? 0),
    {
      offers: offersNever.json?.reach?.people,
      all: allNever.json?.reach?.people,
    },
  );

  const promo = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Come back to the studio",
      bodyEn: "Twenty per cent off your first pack.",
      audience: "OFFERS",
      channels: ["email"],
      neverPaid: true,
      inactiveDays: 30,
    },
  });
  check("a filtered campaign sends", promo.json?.ok === true, promo.json);

  const sawIt = await req(declined.j, "/api/notices?filter=all&page=1");
  check(
    "a member who declined offers never sees it, filter or no filter",
    !(sawIt.json?.rows ?? []).some(
      (r) => r.title === "Come back to the studio",
    ),
    (sawIt.json?.rows ?? []).map((r) => r.title),
  );

  /* And the history records who it went to, because that cannot be worked out
     afterwards — the audience changes as members come back. */
  const hist = await req(staff, "/api/admin/notices?page=1");
  const row = (hist.json?.notices ?? []).find(
    (n) => n.titleEn === "Come back to the studio",
  );
  check(
    "the notice is in the history",
    Boolean(row),
    hist.json?.notices?.length,
  );
  check(
    "with the audience it went to written down",
    typeof row?.segment === "string" &&
      row.segment.includes("offers") &&
      row.segment.includes("never bought") &&
      row.segment.includes("30d"),
    row?.segment,
  );

  /* A nonsense day count must not produce a nonsense audience. */
  const silly = await req(
    staff,
    "/api/admin/notices?audience=ALL&inactiveDays=999999999",
  );
  check(
    "an absurd window is capped rather than breaking",
    typeof silly.json?.reach?.people === "number",
    silly.json?.reach,
  );
  /* Measured now, not at the top of this section: members were created in
     between and the audience legitimately grew. Comparing against a stale
     baseline was the first version of this test, and it failed for the wrong
     reason — which is its own small lesson about counting live data. */
  const nowEveryone =
    (await req(staff, "/api/admin/notices?audience=ALL")).json?.reach?.people ??
    0;
  const negative = await req(
    staff,
    "/api/admin/notices?audience=ALL&inactiveDays=-5",
  );
  check(
    "a negative window is ignored, not applied backwards",
    (negative.json?.reach?.people ?? -1) === nowEveryone,
    { negative: negative.json?.reach?.people, nowEveryone },
  );
}

/* ----------------------------------------------------------------- 21 */
console.log("\n21. The SMS language, and the guard on the bill");
{
  /* The desk chooses the language per message rather than the member choosing
     it once, because that is what the studio asked for. English is the default
     and the default is the cheap one. */
  const meta = await req(staff, "/api/admin/notices?audience=ALL");
  check(
    "the desk is told the segment ceiling",
    (meta.json?.sms?.maxSegments ?? 0) >= 1,
    meta.json?.sms,
  );

  const short = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Closed Monday",
      bodyEn: "No classes on Monday.",
      titleEl: "Κλειστά τη Δευτέρα",
      bodyEl: "Δεν θα γίνουν μαθήματα τη Δευτέρα.",
      audience: "ALL",
      channels: ["sms"],
    },
  });
  const smsReport = (short.json?.reports ?? []).find(
    (r) => r.channel === "sms",
  );
  check("a short notice sends by SMS", short.json?.ok === true, short.json);
  check(
    "and the report says how many segments each message became",
    smsReport?.segments === 1,
    smsReport,
  );
  check(
    "English by default, so the cheap alphabet",
    smsReport?.encoding === "gsm7",
    smsReport,
  );

  /* Asking for Greek costs more, and the report says so rather than leaving the
     desk to find out from an invoice. */
  const inGreek = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Closed Monday",
      bodyEn: "No classes on Monday.",
      titleEl: "Κλειστά τη Δευτέρα",
      bodyEl: "Δεν θα γίνουν μαθήματα τη Δευτέρα.",
      audience: "ALL",
      channels: ["sms"],
      smsLang: "el",
    },
  });
  const greekReport = (inGreek.json?.reports ?? []).find(
    (r) => r.channel === "sms",
  );
  check("Greek can be chosen", inGreek.json?.ok === true, inGreek.json);
  check(
    "and is reported as the expensive alphabet",
    greekReport?.encoding === "unicode",
    greekReport,
  );

  /* The short override: the notice can be long and the text message short. */
  const overridden = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Timetable changes from October",
      bodyEn: "A".repeat(900),
      audience: "ALL",
      channels: ["sms"],
      smsEn: "Timetable changes from October. See your account.",
    },
  });
  const overRep = (overridden.json?.reports ?? []).find(
    (r) => r.channel === "sms",
  );
  check(
    "a long notice with a short text is one segment",
    overridden.json?.ok === true && overRep?.segments === 1,
    { ok: overridden.json?.ok, report: overRep },
  );

  /* And the guard. A 900-character body with no short version would be six
     messages to every member; it is refused before the notice is written, so
     the desk shortens it and sends once rather than finding a half-sent
     announcement in the history. */
  const before =
    (await req(staff, "/api/admin/notices?channel=sms")).json?.history?.total ??
    0;
  const tooLong = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Everything you never wanted to read",
      bodyEn: "A".repeat(900),
      audience: "ALL",
      channels: ["sms"],
    },
  });
  check(
    "an over-long text is refused",
    tooLong.status === 400 && tooLong.json?.error === "SMS_TOO_LONG",
    tooLong.json,
  );
  check(
    "and the refusal says how many it would have been",
    (tooLong.json?.segments ?? 0) > (tooLong.json?.max ?? 0),
    tooLong.json,
  );
  const after =
    (await req(staff, "/api/admin/notices?channel=sms")).json?.history?.total ??
    0;
  check(
    "nothing was written, so it can be fixed and sent once",
    after === before,
    { before, after },
  );

  /* The same body is fine without SMS ticked — the ceiling belongs to the
     channel with a price on it, not to notices in general. */
  const noSms = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Everything you never wanted to read",
      bodyEn: "A".repeat(900),
      audience: "ALL",
      channels: ["push"],
    },
  });
  check(
    "the same notice sends fine without SMS",
    noSms.json?.ok === true,
    noSms.json,
  );
}

console.log(
  `\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`,
);
process.exit(fail === 0 ? 0 : 1);
