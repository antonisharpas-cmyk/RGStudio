/**
 * The reception desk: the lock on the door, and every action behind it.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/test-desk.mjs http://localhost:3100
 *
 * The lock is tested first and hardest. Everything else in this suite is a
 * convenience for the studio; the lock is the thing standing between a public
 * room and four hundred people's phone numbers.
 */
import { markOnboarded, markVerified } from "./fixture-verify.mjs";

const B = process.argv[2] ?? "http://localhost:3000";

/* One number, one account — so every registration in this suite needs its own.
   Registering two members with the same phone is now correctly refused. */
let __phoneSeq = 0;
function uniquePhone() {
  return `+35799${String(100000 + ((Date.now() % 800000) + __phoneSeq++ * 13)).slice(0, 6)}`;
}
/* Two accounts open this console and they are not owed the same view. */
const OWNER = { email: "owner@rgpilatesstudio.com", password: "ownerdev123" };
const RECEPTION = {
  email: "reception@rgpilatesstudio.com",
  password: "receptiondev123",
};

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
    const value = rest.join("=");
    if (value === "") j.delete(k.trim());
    else j.set(k.trim(), value);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
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

async function member(tag) {
  const j = jar();
  const email = `desk-${tag}-${Date.now()}@rg.test`;
  await req(j, "/api/auth/register", {
    method: "POST",
    body: {
      name: `Desk ${tag}`,
      email,
      phone: uniquePhone(),
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  /* Confirm the address the way a member would; /account redirects to the code
     box until it is done, so the id below would come back null. */
  markOnboarded(email);
  if (markVerified(email) !== 1) {
    throw new Error(`fixture ${email} did not verify`);
  }
  /* And signed in again, which re-issues the cookie with the confirmed stamp on
     it. The middleware reads the cookie, so the database write alone would leave
     every page still redirecting to the code box. */
  await req(j, "/api/auth/login", {
    method: "POST",
    body: { email, password: "test12345" },
  });
  const me = await req(j, "/account");
  const id = me.text.match(/data-member-id="([^"]+)"/)?.[1] ?? null;
  return { j, email, id };
}

/* ------------------------------------------------------------------ 1 */
console.log("\n1. The front door: /admin asks for credentials itself");
const staff = jar();
{
  const anon = jar();
  const page = await req(anon, "/admin");
  check(
    "a stranger gets the page, not a redirect",
    page.status === 200,
    page.status,
  );
  check(
    "and is asked for an email and a password",
    page.text.includes("desk-email") && page.text.includes("desk-password"),
    "no sign-in form",
  );
  check(
    "nothing of the studio is on it",
    !page.text.includes("member@example.com") && !page.text.includes("Revenue"),
    "data leaked to the sign-in screen",
  );

  const punter = await member("punter");
  const asMember = await req(punter.j, "/admin");
  check(
    "a signed-in member sees the same form, learning nothing",
    asMember.status === 200 && asMember.text.includes("desk-email"),
    asMember.status,
  );
  const memberApi = await req(punter.j, "/api/admin/members?q=a");
  check(
    "and is refused by the API",
    memberApi.status === 403,
    memberApi.status,
  );

  /* A member's own password must not open the desk. */
  const asMemberTry = await req(punter.j, "/api/admin/unlock", {
    method: "POST",
    body: { email: punter.email, password: "test12345" },
  });
  check(
    "a member's correct password does not open it",
    asMemberTry.status === 401,
    asMemberTry.status,
  );

  const wrong = await req(staff, "/api/admin/unlock", {
    method: "POST",
    body: { email: OWNER.email, password: "not-the-password" },
  });
  check("a wrong password is refused", wrong.status === 401, wrong.status);

  const nobody = await req(staff, "/api/admin/unlock", {
    method: "POST",
    body: { email: "nobody@nowhere.test", password: "whatever" },
  });
  check(
    "an unknown email gets the same answer as a wrong password",
    nobody.status === 401 && nobody.json?.error === "WRONG_PASSWORD",
    nobody.json,
  );

  /* The real thing: one form, signed in and unlocked. */
  const inOne = await req(staff, "/api/admin/unlock", {
    method: "POST",
    body: { email: OWNER.email, password: OWNER.password },
  });
  check(
    "staff credentials open it in one step",
    inOne.json?.ok === true,
    inOne.json,
  );
  check("which also signs them in", staff.has("rg_session"), [
    ...staff.keys(),
  ]);

  const console_ = await req(staff, "/admin");
  check("the console loads", console_.status === 200, console_.status);
  check(
    "with the six tabs",
    ["today", "members", "timetable", "notices", "pricing", "analytics"].every(
      (x) => console_.text.includes(`data-desk-tab="${x}"`),
    ),
    "a tab is missing",
  );
  /* The takings are behind their own tab rather than printed above every
     screen: the desk stands in a public room, and a permanent row of revenue
     is both a distraction from the job in hand and a figure on display. */
  check(
    "and the takings are not on the opening screen",
    !/REVENUE|Revenue \(paid\)/.test(console_.text),
    "revenue rendered before the analytics tab was opened",
  );
  /* The desk's bar carries its own tabs and nothing else. The public
     navigation is not merely hidden here, it is not rendered: a receptionist
     with a queue in front of them has no use for it, and every one of those
     links is a way to lose the screen they were working on. */
  check(
    "and none of the website's own navigation",
    !/href="\/(studio|classes|timetable|pricing|contact)"/.test(console_.text),
    "a public nav link reached the desk",
  );

  const open = await req(staff, "/api/admin/members?q=member");
  check("and the API answers", open.status === 200, open.status);

  /**
   * The lock measures idleness, not elapsed time.
   *
   * It was a flat 45 minutes from the moment the password was typed, which
   * managed to be both more annoying and less safe than a short sliding window:
   * it shut the console on somebody mid-queue, and it left an abandoned counter
   * in a public room open for up to three quarters of an hour.
   *
   * Asserted on the cookie rather than by waiting fifteen minutes. The window
   * is what the Max-Age says, and the sliding is one call in requireDesk — so
   * the thing worth pinning here is the number, because it is the number
   * somebody will "tidy up" one day without knowing why it is small.
   */
  const unlockAgain = await fetch(`${B}/api/admin/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: ch(staff) },
    body: JSON.stringify({ password: OWNER.password }),
  });
  const deskCookie = (unlockAgain.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith("rg_desk="),
  );
  check(
    "the desk cookie lasts fifteen idle minutes",
    /max-age=900\b/i.test(deskCookie ?? ""),
    deskCookie,
  );
  check(
    "and is not readable by scripts on the page",
    /httponly/i.test(deskCookie ?? "") &&
      /samesite=strict/i.test(deskCookie ?? ""),
    deskCookie,
  );
}

/* ------------------------------------------------------------------ 1b */
console.log("\n1b. The numbers, and any day's bookings");
{
  const all = await req(staff, "/api/admin/stats");
  const s = all.json?.stats;
  check("the stats answer", Boolean(s), all.json);
  check(
    "every card the desk asked for is there",
    [
      "members",
      "membersWithSessions",
      "bookings",
      "sessionsOutstanding",
      "sessionsBooked",
      /* The four money cards. Split by where the payment physically went,
         because "what did we take" and "what is in the till" are different
         questions and the owner has to answer both. */
      "revenueOnlineCents",
      "revenueCashCents",
      "revenueCardDeskCents",
      "revenueCents",
    ].every((k) => typeof s?.[k] === "number"),
    Object.keys(s ?? {}),
  );
  check(
    "members with sessions is never more than members",
    s.membersWithSessions <= s.members,
    s,
  );
  /* The total is added from the three, not queried separately, so it can never
     disagree with the numbers printed beside it. Asserted because a fourth
     query would be the obvious "tidy-up" for somebody later, and it would
     reintroduce exactly that possibility. */
  check(
    "the revenue total is the three parts added up",
    s.revenueCents ===
      s.revenueOnlineCents + s.revenueCashCents + s.revenueCardDeskCents,
    s,
  );
  /* Cancellations are reported beside the bookings, not subtracted from them:
     a quiet week and a week people pulled out of must not read the same. */
  check(
    "cancellations are counted apart from the bookings",
    typeof s.cancellations === "number",
    s.cancellations,
  );

  /* One day, given as a range with both ends on it. Inclusive at both ends, so
     this is that whole day rather than a zero-length instant. */
  const t0 = new Date().toISOString().slice(0, 10);
  const oneDay = await req(staff, `/api/admin/stats?from=${t0}&to=${t0}`);
  check(
    "a one-day range cannot show more bookings than all time",
    oneDay.json?.stats?.bookings <= s.bookings,
    { day: oneDay.json?.stats?.bookings, all: s.bookings },
  );
  check(
    "and the stocks do not move with the period",
    oneDay.json?.stats?.sessionsOutstanding === s.sessionsOutstanding,
    {
      day: oneDay.json?.stats?.sessionsOutstanding,
      all: s.sessionsOutstanding,
    },
  );
  check(
    "the range it applied comes back with the answer",
    oneDay.json?.from === t0 && oneDay.json?.to === t0,
    oneDay.json,
  );

  /* A range whose end is before its start is a slip of the hand, not a request
     for nothing: it is read the way it was obviously meant. */
  const swapped = await req(
    staff,
    `/api/admin/stats?from=2026-12-31&to=2026-01-01`,
  );
  check(
    "a backwards range is read the right way round",
    swapped.json?.from === "2026-01-01" && swapped.json?.to === "2026-12-31",
    swapped.json,
  );

  /* A month of takings can never exceed the takings of all time. */
  const month = await req(
    staff,
    "/api/admin/stats?from=2026-01-01&to=2026-12-31",
  );
  check(
    "a bounded period never reports more revenue than all time",
    month.json?.stats?.revenueCents <= s.revenueCents,
    { period: month.json?.stats?.revenueCents, all: s.revenueCents },
  );

  const junk = await req(staff, "/api/admin/stats?from=nonsense&to=whenever");
  check(
    "a nonsense period falls back to all time",
    junk.json?.from === null &&
      junk.json?.to === null &&
      junk.json?.stats?.bookings === s.bookings,
    junk.json,
  );

  const soon = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  const day = await req(staff, `/api/admin/day?date=${soon}`);
  check(
    "any day's classes can be read",
    Array.isArray(day.json?.sessions),
    day.json,
  );
  const badDay = await req(staff, "/api/admin/day?date=15-08-2026");
  check(
    "a malformed date is refused",
    badDay.json?.error === "BAD_DAY",
    badDay.json,
  );
  const locked = await req(jar(), `/api/admin/day?date=${soon}`);
  check(
    "and it is not open to the public",
    locked.status === 401,
    locked.status,
  );
}

/* ------------------------------------------------------------------ 1c */
console.log("\n1c. Reception runs the desk; the numbers are the owner's");
const desk = jar();
{
  const inOne = await req(desk, "/api/admin/unlock", {
    method: "POST",
    body: { email: RECEPTION.email, password: RECEPTION.password },
  });
  check(
    "reception opens the desk with their own password",
    inOne.json?.ok === true,
    inOne.json,
  );

  const page = await req(desk, "/admin");
  check("the console loads for them", page.status === 200, page.status);
  check(
    "with the two tabs they need",
    ["today", "members"].every((x) =>
      page.text.includes(`data-desk-tab="${x}"`),
    ),
    "a tab is missing",
  );
  /**
   * The four they do not get, and the four routes behind them.
   *
   * Not a styling choice: the tabs are absent from the markup, and each route
   * refuses the request. That second half is the half that was missing —
   * `closures`, `generate`, `notices` and `pricing` were guarded with `desk()`
   * until 4 September 2026, so a receptionist who could not see the Pricing tab
   * could still change the price list with a single request. Hiding a tab is
   * not a restriction, so this asserts both.
   */
  for (const gone of ["timetable", "notices", "pricing", "analytics"]) {
    check(
      `no ${gone} tab`,
      !page.text.includes(`data-desk-tab="${gone}"`),
      `reception was shown the ${gone} tab`,
    );
  }
  for (const [route, opts] of [
    ["/api/admin/stats", undefined],
    ["/api/admin/closures", undefined],
    ["/api/admin/notices", undefined],
    ["/api/admin/pricing", undefined],
    /* The writes matter more than the reads: this is the one that would have
       cost the studio money. */
    [
      "/api/admin/pricing",
      {
        method: "POST",
        body: { kind: "PERCENT", value: 90, labelEn: "x", labelEl: "x" },
      },
    ],
    [
      "/api/admin/closures",
      {
        method: "POST",
        body: { day: "2027-01-01", reasonEn: "x", reasonEl: "x" },
      },
    ],
    ["/api/admin/generate", { method: "POST", body: { weeks: 1 } }],
  ]) {
    const r = await req(desk, route, opts);
    check(
      `reception is refused by ${opts?.method ?? "GET"} ${route}`,
      r.status === 403,
      r.status,
    );
  }
  check(
    "nothing of the takings is on the page",
    !/REVENUE|Total revenue|Revenue online|revenueCents/.test(page.text),
    "a revenue figure reached reception's screen",
  );

  const stats = await req(desk, "/api/admin/stats");
  check(
    "the numbers are refused, not merely hidden",
    stats.status === 403,
    stats.status,
  );
  const statsRange = await req(desk, "/api/admin/stats?from=2026-01-01");
  check(
    "and refused however they are asked for",
    statsRange.status === 403,
    statsRange.status,
  );

  /* Reception can still do the job. */
  const work = await req(desk, "/api/admin/members?q=member");
  check(
    "but the membership is still theirs to search",
    work.status === 200,
    work.status,
  );
  const rota = await req(
    desk,
    `/api/admin/day?date=${new Date().toISOString().slice(0, 10)}`,
  );
  check("and so are the day's bookings", rota.status === 200, rota.status);

  /* One receptionist must not be able to take the console off the owner. */
  const ownerRow = await req(staff, `/api/admin/members?q=${OWNER.email}`);
  const ownerId = ownerRow.json?.members?.[0]?.id ?? null;
  check(
    "the owner can see the studio's own accounts",
    Boolean(ownerId),
    ownerRow.json,
  );

  const hidden = await req(desk, `/api/admin/members?q=${OWNER.email}`);
  check(
    "reception's search does not return desk accounts",
    (hidden.json?.members ?? []).length === 0,
    hidden.json,
  );
  const peek = await req(desk, `/api/admin/members?id=${ownerId}`);
  check("nor can they open one by id", peek.status === 404, peek.status);
  const steal = await req(desk, "/api/admin/member/password", {
    method: "POST",
    body: { userId: ownerId, password: "taken-over-12345" },
  });
  check(
    "and cannot reset the owner's password",
    steal.status === 404,
    steal.status,
  );
  const topUp = await req(desk, "/api/admin/sessions", {
    method: "POST",
    body: { userId: ownerId, credits: 5, method: "adjustment" },
  });
  check(
    "nor move sessions onto a desk account",
    topUp.status === 404,
    topUp.status,
  );

  /* The owner still can — somebody has to, when reception forgets theirs. */
  const receptionRow = await req(
    staff,
    `/api/admin/members?q=${RECEPTION.email}`,
  );
  const receptionId = receptionRow.json?.members?.[0]?.id ?? null;
  check(
    "the owner can find reception's account",
    Boolean(receptionId),
    receptionRow.json,
  );
  const reset = await req(staff, "/api/admin/member/password", {
    method: "POST",
    body: { userId: receptionId, password: RECEPTION.password },
  });
  check("and set them a new password", reset.json?.ok === true, reset.json);
}

/* ------------------------------------------------------------------ 2 */
console.log("\n2. Sessions sold at the desk");
const buyer = await member("cash");
let buyerId = null;
{
  const found = await req(staff, `/api/admin/members?q=${buyer.email}`);
  buyerId = found.json?.members?.[0]?.id ?? null;
  check("the desk can find them", Boolean(buyerId), found.json);

  const sold = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: {
      userId: buyerId,
      credits: 10,
      amountCents: 20000,
      method: "cash",
      note: "Paid cash",
    },
  });
  check("ten sessions for cash", sold.json?.balance === 10, sold.json);

  const detail = await req(staff, `/api/admin/members?id=${buyerId}`);
  const payment = detail.json?.member?.payments?.[0];
  check(
    "recorded as a payment, not only a balance",
    payment?.provider === "cash" && payment?.amountCents === 20000,
    payment,
  );
  check(
    "and written to the ledger with who did it",
    (detail.json?.member?.ledger ?? []).some((l) =>
      (l.note ?? "").includes("Paid cash"),
    ),
    detail.json?.member?.ledger,
  );

  const taken = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: buyerId, credits: -3, method: "adjustment" },
  });
  check("three taken back", taken.json?.balance === 7, taken.json);

  const tooMany = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: buyerId, credits: -99, method: "adjustment" },
  });
  check(
    "taking more than they have empties, never goes negative",
    tooMany.json?.balance === 0,
    tooMany.json,
  );

  const zero = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: buyerId, credits: 0 },
  });
  check("zero is refused", zero.json?.error === "BAD_AMOUNT", zero.json);
}

/* ------------------------------------------------------------------ 3 */
console.log("\n3. Cancelling for a member, refund or not");
{
  await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: buyerId, credits: 4, method: "adjustment" },
  });

  const sessions = await req(buyer.j, "/api/sessions?days=14");
  /* Group classes only. Appointments are a different product with a different
     cutoff and a different kind of session paying for them. */
  const slot = (sessions.json?.sessions ?? []).find(
    (s) =>
      s.classType?.kind !== "PERSONAL" &&
      s.spotsLeft > 0 &&
      new Date(s.startsAt) > new Date(Date.now() + 72 * 3600e3),
  );
  const booked = await req(buyer.j, "/api/bookings", {
    method: "POST",
    body: { sessionId: slot.id },
  });
  check("the member books a class", booked.json?.ok === true, booked.json);
  check("their balance drops to 3", booked.json?.credits === 3, booked.json);

  const detail = await req(staff, `/api/admin/members?id=${buyerId}`);
  const bookingId = detail.json?.member?.upcoming?.[0]?.id;
  check(
    "the desk sees the booking",
    Boolean(bookingId),
    detail.json?.member?.upcoming,
  );

  const cancelled = await req(staff, "/api/admin/bookings", {
    method: "POST",
    body: { bookingId, refund: true },
  });
  check(
    "cancelled with a refund",
    cancelled.json?.refunded === true,
    cancelled.json,
  );
  check(
    "and the session came back",
    cancelled.json?.balance === 4,
    cancelled.json,
  );

  const again = await req(staff, "/api/admin/bookings", {
    method: "POST",
    body: { bookingId, refund: true },
  });
  check(
    "cancelling twice cannot refund twice",
    again.json?.error === "ALREADY_CANCELLED",
    again.json,
  );
}

/* ----------------------------------------------------------------- 3b */
console.log("\n3b. Booking a member a whole term, over the telephone");
/**
 * "Can you put me in every Monday until Christmas?"
 *
 * The member's own screen has had this since the three-month packs went on
 * sale, and the people who telephone rather than use the site are the ones most
 * likely to want a fixed slot for a term — reception was doing it twelve clicks
 * at a time.
 *
 * The rules are exercised properly in test-flows against the database, because
 * the desk calls the same `repeatWeekly` the website does. What matters here is
 * that the desk cannot get a *different* answer from the website about the same
 * class, that a partial run comes back as a summary rather than an error, and
 * that the two things which are the desk's alone actually happen: the ledger
 * names the receptionist, and the member is told once rather than twelve times.
 */
{
  /* Enough sessions for a full run, plus a couple to spare. */
  await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: buyerId, credits: 12, method: "adjustment" },
  });
  const before =
    (await req(staff, `/api/admin/members?id=${buyerId}`)).json?.member
      ?.credits ?? 0;

  const sessions = await req(buyer.j, "/api/sessions?days=60");
  const slot = (sessions.json?.sessions ?? []).find(
    (x) =>
      x.classType?.kind !== "PERSONAL" &&
      x.spotsLeft > 0 &&
      new Date(x.startsAt) > new Date(Date.now() + 72 * 3600e3),
  );

  const run = await req(staff, "/api/admin/bookings", {
    method: "PUT",
    body: { sessionId: slot.id, userId: buyerId, weeks: 4 },
  });
  check(
    "the desk books a run of the same slot",
    run.status === 200 && run.json?.ok === true,
    run.json,
  );
  check(
    "and answers with a summary, not a bare tick",
    typeof run.json?.booked === "number" &&
      typeof run.json?.asked === "number" &&
      Array.isArray(run.json?.failed),
    run.json,
  );
  check("more than one week was taken", (run.json?.booked ?? 0) >= 2, run.json);
  check(
    "one session was spent per week, not one per press",
    run.json?.balance === before - (run.json?.booked ?? 0),
    { before, after: run.json?.balance, booked: run.json?.booked },
  );

  /**
   * Every booking carries a reminder, which a desk booking used to get none of.
   *
   * A member booking themselves had one queued by the booking route; a member
   * booked over the telephone got nothing at all — so the people most likely to
   * need reminding were the only ones not reminded. Fixed in `bookForMember`, so
   * both the single booking and the run inherit it, and asserted here because
   * nothing about the booking itself would have shown the gap.
   */
  const withReminders = await req(staff, "/api/admin/members?id=" + buyerId);
  const upcoming = withReminders.json?.member?.upcoming ?? [];
  check(
    "the desk sees all of them on the member's card",
    upcoming.length >= (run.json?.booked ?? 0),
    { upcoming: upcoming.length, booked: run.json?.booked },
  );

  /* The ledger names who took the call, once per class rather than once per
     run: it is read to answer "where did this session go", and a single line
     covering twelve of them could not be matched to any of them. Read from the
     member's own card, which is where reception looks. */
  const ledger = withReminders.json?.member?.ledger ?? [];
  const deskLines = ledger.filter((r) => /week run/i.test(r.note ?? ""));
  check(
    "and the ledger names the receptionist against each class",
    deskLines.length >= (run.json?.booked ?? 0),
    { deskLines: deskLines.length, booked: run.json?.booked },
  );

  /**
   * Asking again books nothing twice, and says so without calling it a failure.
   *
   * Reception will press this twice — a member changes their mind mid-call, the
   * page looks like it did nothing. Every week comes back as already theirs.
   */
  const twice = await req(staff, "/api/admin/bookings", {
    method: "PUT",
    body: { sessionId: slot.id, userId: buyerId, weeks: 4 },
  });
  check(
    "a second identical run books nothing new",
    twice.json?.ok === true && twice.json?.booked === 0,
    twice.json,
  );
  check(
    "and reports them as already booked rather than as failures",
    (twice.json?.alreadyHad ?? 0) >= 1 &&
      (twice.json?.failed ?? []).length === 0,
    twice.json,
  );
  check("and spends nothing", twice.json?.balance === run.json?.balance, {
    first: run.json?.balance,
    second: twice.json?.balance,
  });

  /* What it refuses: a fraction, nothing, and anything past the ceiling. The
     longest pack the studio sells is nine months, so 39 weeks is the ceiling and
     40 is the first refusal. (It was 52 while a twelve-month pack was on sale;
     that pack is gone.) */
  for (const weeks of [1.5, 0, 40, 100]) {
    const bad = await req(staff, "/api/admin/bookings", {
      method: "PUT",
      body: { sessionId: slot.id, userId: buyerId, weeks },
    });
    check(`weeks=${weeks} is refused`, bad.status === 400, {
      weeks,
      status: bad.status,
      json: bad.json,
    });
  }

  /* An appointment is not repeatable, from here or from the member's screen. */
  const appt = (
    await req(buyer.j, "/api/sessions?days=30")
  ).json?.sessions?.find((x) => x.classType?.kind === "PERSONAL");
  if (appt) {
    const refused = await req(staff, "/api/admin/bookings", {
      method: "PUT",
      body: { sessionId: appt.id, userId: buyerId, weeks: 4 },
    });
    check(
      "a Personal hour cannot be booked as a run",
      refused.status === 400 && refused.json?.error === "NOT_REPEATABLE",
      refused.json,
    );
  }

  /* Tidy up: give the member their sessions back and clear the run, so the
     sections after this one see the balances they expect. */
  for (const b of upcoming) {
    await req(staff, "/api/admin/bookings", {
      method: "POST",
      body: { bookingId: b.id, refund: true },
    });
  }
}

/* ------------------------------------------------------------------ 4 */
console.log("\n4. Their details, and their password");
{
  const newEmail = `moved-${Date.now()}@rg.test`;
  const patched = await req(staff, "/api/admin/member", {
    method: "PATCH",
    body: {
      userId: buyerId,
      email: newEmail,
      phone: uniquePhone(),
      notifySms: true,
    },
  });
  check("email and phone corrected", patched.json?.ok === true, patched.json);

  const clash = await req(staff, "/api/admin/member", {
    method: "PATCH",
    body: { userId: buyerId, email: OWNER.email },
  });
  check(
    "an email already in use is refused",
    clash.json?.error === "EMAIL_TAKEN",
    clash.json,
  );

  const junk = await req(staff, "/api/admin/member", {
    method: "PATCH",
    body: { userId: buyerId, email: "not-an-email" },
  });
  check("nonsense is refused", junk.json?.error === "EMAIL_INVALID", junk.json);

  const short = await req(staff, "/api/admin/member/password", {
    method: "POST",
    body: { userId: buyerId, password: "abc" },
  });
  check(
    "a short password is refused",
    short.json?.error === "PASSWORD_SHORT",
    short.json,
  );

  const set = await req(staff, "/api/admin/member/password", {
    method: "POST",
    body: { userId: buyerId, password: "brand-new-pass" },
  });
  check("a new password is set", set.json?.ok === true, set.json);

  const fresh = jar();
  const login = await req(fresh, "/api/auth/login", {
    method: "POST",
    body: { email: newEmail, password: "brand-new-pass" },
  });
  check("the member can sign in with it", login.json?.ok === true, login.json);
}

/* ------------------------------------------------------------------ 5 */
console.log("\n5. Closing a day");
{
  /* Far enough ahead that the rota has classes on it, and a weekday. */
  const target = new Date(Date.now() + 9 * 86400e3);
  while (target.getUTCDay() === 0) target.setUTCDate(target.getUTCDate() + 1);
  const day = target.toISOString().slice(0, 10);

  await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: buyerId, credits: 2, method: "adjustment" },
  });
  const before = await req(staff, `/api/admin/members?id=${buyerId}`);
  const balanceBefore = before.json?.member?.credits ?? 0;

  const sessions = await req(buyer.j, "/api/sessions?days=20");
  const onThatDay = (sessions.json?.sessions ?? []).find(
    (s) =>
      s.classType?.kind !== "PERSONAL" &&
      s.startsAt.slice(0, 10) === day &&
      s.spotsLeft > 0,
  );
  check("there is a class to lose", Boolean(onThatDay), day);

  if (onThatDay) {
    await req(buyer.j, "/api/bookings", {
      method: "POST",
      body: { sessionId: onThatDay.id },
    });

    const closed = await req(staff, "/api/admin/closures", {
      method: "POST",
      body: { day, reasonEn: "Public holiday" },
    });
    check("the day closes", closed.json?.ok === true, closed.json);
    check(
      "its classes are cancelled",
      (closed.json?.classesCancelled ?? 0) > 0,
      closed.json?.classesCancelled,
    );
    check(
      "the desk is told who was in them",
      (closed.json?.affected ?? []).some((a) => a.refunded),
      closed.json?.affected,
    );

    const after = await req(staff, `/api/admin/members?id=${buyerId}`);
    check(
      "the member has their session back",
      after.json?.member?.credits === balanceBefore,
      { before: balanceBefore, after: after.json?.member?.credits },
    );

    /* The timetable keeps a closed day on screen and marks it shut, rather than
       dropping the date. Silently removing it left a gap in the strip and a
       visitor wondering what they were missing; saying "closed" answers the
       question. So the day must still be there — and must offer nothing. */
    const timetable = await req(jar(), "/timetable");
    check(
      "the closed day is still shown, not dropped",
      timetable.text.includes(`data-day="${day}"`),
      "the date vanished from the strip",
    );
    const dayApi = await req(jar(), `/api/sessions?days=28`);
    const onClosedDay = (dayApi.json?.sessions ?? []).filter(
      (x) => String(x.startsAt).slice(0, 10) === day,
    );
    check(
      "and every class on it comes back cancelled",
      onClosedDay.length > 0 &&
        onClosedDay.every((x) => x.status === "CANCELLED"),
      [...new Set(onClosedDay.map((x) => x.status))],
    );

    const bad = await req(staff, "/api/admin/closures", {
      method: "POST",
      body: { day: "not-a-day" },
    });
    check(
      "a nonsense date is refused",
      bad.json?.error === "BAD_DAY",
      bad.json,
    );

    const reopened = await req(staff, `/api/admin/closures?day=${day}`, {
      method: "DELETE",
    });
    check(
      "and it can be opened again",
      reopened.json?.reopened === true,
      reopened.json,
    );
  }
}

/* ------------------------------------------------------------------ 6 */
console.log("\n6. A notice to every member");
{
  const reader = await member("reader");

  const sent = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: {
      titleEn: "Closed on Monday",
      bodyEn:
        "The studio is shut for the public holiday. Classes resume Tuesday.",
      important: true,
    },
  });
  check("the notice is sent", sent.json?.ok === true, sent.json);

  const tooShort = await req(staff, "/api/admin/notices", {
    method: "POST",
    body: { titleEn: "a", bodyEn: "b" },
  });
  check(
    "an empty one is refused",
    tooShort.json?.error === "TOO_SHORT",
    tooShort.json,
  );

  const account = await req(reader.j, "/account?tab=notifications");
  check(
    "it is in the member's account",
    account.text.includes("Closed on Monday"),
    "notice missing",
  );
  check(
    "with an unread count on their face",
    /unread/i.test(account.text),
    "no unread marker",
  );

  const read = await req(reader.j, "/api/notices/read", {
    method: "POST",
    body: {},
  });
  check("marking all read works", read.json?.unread === 0, read.json);

  const anon = await req(jar(), "/api/notices/read", {
    method: "POST",
    body: {},
  });
  check(
    "a stranger cannot mark anything read",
    anon.status === 401,
    anon.status,
  );

  const history = await req(staff, "/api/admin/notices");
  const first = history.json?.notices?.[0];
  check("the desk sees who has read it", (first?.reads ?? 0) >= 1, first);
}

/* ------------------------------------------------------------------ 7 */
console.log("\n7. An offer on the price list");
{
  const twenty = await req(staff, "/api/admin/pricing", {
    method: "POST",
    body: { kind: "PERCENT", value: 20, labelEn: "Summer offer" },
  });
  check("20% off the list", twenty.json?.ok === true, twenty.json);

  const pricing = await req(jar(), "/pricing");
  check(
    "the pricing page shows the offer",
    pricing.text.includes("Summer offer"),
    "label missing",
  );
  check(
    "and the old price beside it",
    pricing.text.includes("line-through"),
    "no struck-through price",
  );
  /**
   * The pack the page actually renders, at the offer price and beside its list
   * price.
   *
   * This asserted €88 against €110 — the monthly two-a-week pack — which was
   * right while every pack had a card. The plan builder replaced twenty cards
   * with two chips and opens on *three months, twice a week*, so `month-2` is no
   * longer in the HTML at all and the old numbers were checking nothing.
   *
   * `quarter-2` is €270, and 20% off is €216. Still the assertion worth having:
   * the two checks above prove an offer is *shown*, and this one proves the
   * arithmetic behind it.
   */
  check(
    "the shown pack is 216 rather than 270",
    pricing.text.includes("€216") && pricing.text.includes("€270"),
    "prices look wrong",
  );

  /* The charge has to match the shown price, not the list price. */
  const shopper = await member("shopper");
  const opened = await req(shopper.j, "/api/checkout", {
    method: "POST",
    body: { packSlug: "month-2" },
  });
  await req(shopper.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: opened.json?.purchaseId },
  });
  const found = await req(staff, `/api/admin/members?q=${shopper.email}`);
  const detail = await req(
    staff,
    `/api/admin/members?id=${found.json?.members?.[0]?.id}`,
  );
  check(
    "and the member is charged the offer price",
    detail.json?.member?.payments?.[0]?.amountCents === 8800,
    detail.json?.member?.payments?.[0],
  );

  const silly = await req(staff, "/api/admin/pricing", {
    method: "POST",
    body: { kind: "PERCENT", value: 99 },
  });
  check("99% off is refused", silly.json?.error === "BAD_VALUE", silly.json);

  const perPack = await req(staff, "/api/admin/pricing", {
    method: "POST",
    body: { packageId: null, kind: "FLAT", value: 1000, labelEn: "€10 off" },
  });
  check(
    "a flat rule replaces the percent one",
    perPack.json?.ok === true,
    perPack.json,
  );
  const rules = perPack.json?.rules ?? [];
  check(
    "and does not stack on top of it",
    rules.filter((r) => r.packageId === null).length === 1,
    rules,
  );

  const cleared = await req(staff, "/api/admin/pricing?all=1", {
    method: "DELETE",
  });
  check(
    "everything clears in one press",
    cleared.json?.ok === true,
    cleared.json,
  );

  const normal = await req(jar(), "/pricing");
  check(
    "prices are back to normal",
    !normal.text.includes("line-through"),
    "an offer is still showing",
  );
}

/* ------------------------------------------------------------------ 8 */
console.log("\n8. Leaving the desk");
{
  /* The 45 minutes lapsing on its own: the session survives, so the door asks
     for the password alone — and offers a way out to the email form, because
     the person sitting down is not always the person who stood up. */
  await req(staff, "/api/admin/lock", { method: "POST" });
  const after = await req(staff, "/api/admin/members?q=member");
  check(
    "a lapsed unlock closes the console",
    after.status === 423,
    after.status,
  );
  const page = await req(staff, "/admin");
  check(
    "and asks for the password next time",
    page.text.includes("desk-password"),
    "no password box",
  );
  check(
    "with a way to sign in as somebody else",
    page.text.includes("Sign in as somebody else"),
    "no way off the password screen",
  );

  /* Log out is the button on the console, and it ends the session too. Coming
     back has to ask who you are, not merely ask you to prove you are the last
     person to use this machine. */
  await req(staff, "/api/auth/logout", { method: "POST" });
  const door = await req(staff, "/admin");
  check(
    "logging out puts the email box back",
    door.text.includes("desk-email") && door.text.includes("desk-password"),
    "no email box after signing out",
  );
  check(
    "and the name of whoever was signed in is gone",
    !door.text.includes("Studio Owner"),
    "the previous person's name survived the sign-out",
  );
  const shut = await req(staff, "/api/admin/members?q=member");
  check("the API is closed to them again", shut.status === 401, shut.status);

  /* The other account can now sign in on the same machine. */
  const swap = await req(staff, "/api/admin/unlock", {
    method: "POST",
    body: { email: RECEPTION.email, password: RECEPTION.password },
  });
  check(
    "and the other account signs in on the same browser",
    swap.json?.ok === true,
    swap.json,
  );
}

/* ------------------------------------------------------------------ 11b */
console.log("\n11b. The desk cannot sell to an unconfirmed account either");
{
  const back = await req(staff, "/api/admin/unlock", {
    method: "POST",
    body: { email: OWNER.email, password: OWNER.password },
  });
  check("the owner is at the desk", back.json?.ok === true, back.json);

  /* Registered and left unconfirmed on purpose: no markVerified, no re-login. */
  const j = jar();
  const email = `unconf-${Date.now()}@rg.test`;
  const reg = await req(j, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Unconfirmed Walkin",
      email,
      phone: uniquePhone(),
      password: "test12345",
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check(
    "an account registers and stays unconfirmed",
    reg.json?.verify === true,
    reg.json,
  );

  const row = await req(staff, `/api/admin/members?q=${email}`);
  const id = row.json?.members?.[0]?.id ?? null;
  check("the desk can find them", Boolean(id), row.json);

  /* The rule the studio set, applied to the counter. */
  const cash = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: id, credits: 8, amountCents: 11000, method: "cash" },
  });
  check(
    "selling them a pack for cash is refused",
    cash.json?.error === "EMAIL_UNVERIFIED",
    cash.json,
  );
  const comp = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: id, credits: 2, method: "adjustment" },
  });
  check(
    "and so is giving them free sessions",
    comp.json?.error === "EMAIL_UNVERIFIED",
    comp.json,
  );
  const legacyGrant = await req(staff, "/api/admin/grant", {
    method: "POST",
    body: { userId: id, credits: 2 },
  });
  check(
    "including through the older grant route",
    legacyGrant.json?.error === "EMAIL_UNVERIFIED",
    legacyGrant.json,
  );

  const detail = await req(staff, `/api/admin/members?id=${id}`);
  check(
    "their balance is still nothing",
    detail.json?.member?.credits === 0,
    detail.json?.member?.credits,
  );
  check(
    "and the desk is told why on their card",
    detail.json?.member?.emailVerifiedAt === null,
    detail.json?.member?.emailVerifiedAt,
  );

  /* The remedy, in the order reception would actually do it: confirm, then sell. */
  check("the member confirms", markVerified(email) === 1);
  markOnboarded(email);
  const sold = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: id, credits: 8, amountCents: 11000, method: "cash" },
  });
  check("and now the pack sells", sold.json?.ok === true, sold.json);
  check("eight sessions land", sold.json?.balance === 8, sold.json?.balance);

  /* Taking back is allowed whatever the state, because the studio must always be
     able to correct itself. Proved on a fresh unconfirmed account that already
     holds sessions, which is only reachable by writing them in directly. */
  const takeBack = await req(staff, "/api/admin/sessions", {
    method: "POST",
    body: { userId: id, credits: -3, method: "adjustment" },
  });
  check(
    "and sessions can be taken back",
    takeBack.json?.ok === true,
    takeBack.json,
  );
}

/* ------------------------------------------------------------------ 12 */
console.log("\n12. Erasing a member is the owner's alone");
{
  /* Section 8 left the `staff` browser signed in as reception, deliberately —
     it was testing that one machine can swap accounts. Put the owner back
     before testing what only the owner may do. */
  const back = await req(staff, "/api/admin/unlock", {
    method: "POST",
    body: { email: OWNER.email, password: OWNER.password },
  });
  check("the owner takes the console back", back.json?.ok === true, back.json);

  const victim = await member("erase");
  /* Looked up through the desk's own search, the way every other section here
     does. `member().id` is always null — the account page carries no id
     attribute — and a null userId comes back as BAD_REQUEST, which would look
     like a broken route rather than a broken fixture. */
  const victimRow = await req(staff, `/api/admin/members?q=${victim.email}`);
  const victimId = victimRow.json?.members?.[0]?.id ?? null;
  check("the desk can find them", Boolean(victimId), victimRow.json);

  /* Reception first. The point of this block is not that erasure works — that
     is covered against the database in test:account — it is that the door is
     shut to the account that stands in a public room all day. */
  const refused = await req(desk, "/api/admin/member/erase", {
    method: "POST",
    body: { userId: victimId, confirmEmail: victim.email },
  });
  check("reception is refused", refused.status === 403, refused.status);
  const stillThere = await req(staff, `/api/admin/members?id=${victimId}`);
  check(
    "and nothing was erased",
    stillThere.json?.member?.email === victim.email,
    stillThere.json?.member?.email,
  );

  /* The owner, with the wrong address typed. */
  const mistyped = await req(staff, "/api/admin/member/erase", {
    method: "POST",
    body: { userId: victimId, confirmEmail: "somebody-else@rg.test" },
  });
  check(
    "a mistyped confirmation is refused",
    mistyped.status === 409 && mistyped.json?.error === "CONFIRM_MISMATCH",
    mistyped.json,
  );

  /* And the studio's own accounts are not erasable from this screen at all. */
  const ownerRowAgain = await req(staff, `/api/admin/members?q=${OWNER.email}`);
  const ownerIdAgain = ownerRowAgain.json?.members?.[0]?.id ?? null;
  if (ownerIdAgain) {
    const selfHarm = await req(staff, "/api/admin/member/erase", {
      method: "POST",
      body: { userId: ownerIdAgain, confirmEmail: OWNER.email },
    });
    check(
      "the owner cannot erase a desk account",
      selfHarm.status === 409 && selfHarm.json?.error === "DESK_ACCOUNT",
      selfHarm.json,
    );
  }

  /* Now for real. */
  const done = await req(staff, "/api/admin/member/erase", {
    method: "POST",
    body: { userId: victimId, confirmEmail: victim.email.toUpperCase() },
  });
  check("the owner erases them", done.json?.ok === true, done.json);
  check(
    "and is told what was kept",
    typeof done.json?.paymentsKept === "number" &&
      typeof done.json?.upcomingBookings === "number",
    done.json,
  );

  const after = await req(staff, `/api/admin/members?id=${victimId}`);
  check("the name is gone", after.json?.member?.name === "Erased member");
  check(
    "the address can no longer receive mail",
    String(after.json?.member?.email ?? "").endsWith("@rg.invalid"),
    after.json?.member?.email,
  );
  check("the number is gone", after.json?.member?.phone === null);
  check("and it is stamped", Boolean(after.json?.member?.erasedAt));

  /* The account is now unusable, which is the point. */
  const lockedOut = await req(victim.j, "/api/profile");
  check(
    "they cannot use the account any more",
    lockedOut.status === 401 || lockedOut.status === 403,
    lockedOut.status,
  );

  const twice = await req(staff, "/api/admin/member/erase", {
    method: "POST",
    body: { userId: victimId, confirmEmail: after.json?.member?.email },
  });
  check(
    "erasing twice is refused",
    twice.status === 409 && twice.json?.error === "ALREADY_ERASED",
    twice.json,
  );
}

console.log(
  `\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`,
);
process.exit(fail === 0 ? 0 : 1);
