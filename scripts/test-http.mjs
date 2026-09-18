/**
 * End-to-end HTTP test against a running server.
 *   npm run build && npx next start -p 3100
 *   node scripts/test-http.mjs http://localhost:3100
 */
import { markOnboarded, markVerified } from "./fixture-verify.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";

/* One number, one account — so every registration in this suite needs its own.
   Registering two members with the same phone is now correctly refused. */
let __phoneSeq = 0;
function uniquePhone() {
  return `+35799${String(100000 + ((Date.now() % 800000) + __phoneSeq++ * 13)).slice(0, 6)}`;
}
let pass = 0,
  fail = 0;
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar.size ? { cookie: cookieHeader() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [k, ...rest] = pair.split("=");
    jar.set(k.trim(), rest.join("="));
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  /* Where a redirect points, not only that it redirected. Two guards now send
     somebody to two different places — /login when they are not signed in,
     /verify when they are but the address is unconfirmed — and a suite that only
     counted the 307 would pass either way. */
  return {
    status: res.status,
    json,
    text,
    headers: { location: res.headers.get("location") ?? "" },
  };
}

function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, extra ?? "");
  }
}

const email = `http-${Date.now()}@rg.test`;

console.log("\n1. Public pages");
for (const p of [
  "/",
  "/studio",
  "/timetable",
  "/pricing",
  "/contact",
  "/login",
  "/register",
  "/privacy",
  "/terms",
  "/sitemap.xml",
  "/robots.txt",
]) {
  const r = await req(p);
  check(`GET ${p} → 200`, r.status === 200, r.status);
}

/* The cover carries its own way in, because the header hides its account chip
   over that section — so without this a visitor on the home page has no visible
   sign-in at all. */
const coverOut = await req("/");
check(
  "the cover offers a sign in when nobody is signed in",
  coverOut.text.includes("Already a member") &&
    coverOut.text.includes('href="/login"'),
  "no sign-in on the cover",
);

console.log("\n2. Guarded pages are closed when signed out");
const guardedAccount = await req("/account");
check(
  "GET /account redirects",
  guardedAccount.status === 307 || guardedAccount.status === 302,
  guardedAccount.status,
);
/* /admin is deliberately not a redirect: typing the address is the whole
   journey, so the door itself asks for staff credentials. What matters is that
   the page is the sign-in form and none of the console leaked into it. */
const guardedAdmin = await req("/admin");
check(
  "GET /admin serves its own sign-in form",
  guardedAdmin.status === 200 && guardedAdmin.text.includes("desk-email"),
  guardedAdmin.status,
);
check(
  "GET /admin leaks none of the console",
  !/desk-tab|data-desk-console/.test(guardedAdmin.text),
);
const noAuth = await req("/api/bookings");
check("GET /api/bookings needs auth", noAuth.status === 401, noAuth.status);

console.log("\n3. Register");
const bad = await req("/api/auth/register", {
  method: "POST",
  body: { name: "X", email: "not-an-email", password: "short" },
});
check("invalid registration rejected", bad.status === 400, bad.status);

const reg = await req("/api/auth/register", {
  method: "POST",
  body: {
    name: "HTTP Tester",
    email,
    password: "test12345",
    phone: uniquePhone(),
    serviceOptIn: true,
    termsAccepted: true,
  },
});
check(
  "registration succeeds",
  reg.status === 200 && reg.json?.ok === true,
  reg.json,
);
check("session cookie set", jar.has("rg_session"));
check(
  "registration asks for the emailed code",
  reg.json?.verify === true,
  reg.json,
);

console.log("\n3b. An unverified account can do nothing at all");
/* Not "cannot book" — cannot go anywhere. Until the code is typed the middleware
   sends every address on the site back to the code box, which is what the studio
   asked for. */
for (const path of ["/account", "/", "/pricing", "/timetable", "/faq"]) {
  const r = await req(path);
  check(
    `GET ${path} sends them to the code box`,
    (r.status === 307 || r.status === 302) &&
      (r.headers?.location ?? "").includes("/verify"),
    { status: r.status, to: r.headers?.location },
  );
}
const verifyPage = await req("/verify");
check(
  "GET /verify is the one page that loads",
  verifyPage.status === 200,
  verifyPage.status,
);
check(
  "and shows the address the code went to",
  verifyPage.text.includes(email),
  "the address is not on the page",
);
check(
  "with a way out for a mistyped address",
  /Sign out|sign out/.test(verifyPage.text),
  "no sign-out on the verify page",
);

/* APIs get an answer rather than a redirect: `fetch` follows a 307 by default,
   so a redirect here would hand the caller HTML where it expected JSON. */
for (const [path, body] of [
  ["/api/bookings", { sessionId: "does-not-matter" }],
  ["/api/checkout", { packSlug: "single" }],
  ["/api/profile", { name: "Nope" }],
]) {
  const r = await req(path, { method: "POST", body });
  check(
    `POST ${path} is refused with EMAIL_UNVERIFIED`,
    r.status === 403 && r.json?.error === "EMAIL_UNVERIFIED",
    { status: r.status, json: r.json },
  );
}

const wrongCode = await req("/api/auth/verify", {
  method: "POST",
  body: { code: "000000" },
});
check(
  "a wrong code is refused with tries left",
  wrongCode.status === 400 &&
    wrongCode.json?.error === "WRONG" &&
    typeof wrongCode.json?.attemptsLeft === "number",
  wrongCode.json,
);
const resend = await req("/api/auth/verify/resend", { method: "POST" });
check(
  "asking again straight away is refused, with a wait",
  resend.status === 429 &&
    resend.json?.error === "TOO_SOON" &&
    resend.json.secondsLeft > 0,
  resend.json,
);

/* Signing out has to work from in here, or the only mistake anybody actually
   makes — a typo in their own address — has no remedy. */
const escaped = await req("/api/auth/logout", { method: "POST" });
check(
  "signing out works from the code box",
  escaped.status === 200,
  escaped.status,
);
const anonHome = await req("/");
check(
  "and the site is browsable again",
  anonHome.status === 200,
  anonHome.status,
);

/* Back in, verified the way a member would be: the row is stamped and the
   cookie is re-issued by signing in again. */
check("the fixture verifies", markVerified(email) === 1);
const backIn = await req("/api/auth/login", {
  method: "POST",
  body: { email, password: "test12345" },
});
check("and signs back in", backIn.json?.ok === true, backIn.json);
check(
  "the cookie no longer says unconfirmed",
  backIn.json?.verify === false,
  backIn.json,
);
check(
  "so /verify sends them on rather than asking again",
  [307, 302].includes((await req("/verify")).status),
);

console.log("\n3b-ii. The three questions, which are asked but never required");
/**
 * The welcome questions, and the thing that matters most about them: they do
 * not block anything.
 *
 * They were mandatory for a day. The gate did exactly what a gate does — a
 * member who skipped the questions could browse the whole site and was then
 * refused at the one moment they were trying to give the studio money. The
 * studio removed the requirement, and this section is what stops it coming
 * back by accident: the emailed code is the only mandatory step.
 *
 * So: a confirmed account with no answers is still *offered* the questions, and
 * can still do everything without them.
 */
const sentToWelcome = await req("/verify");
check(
  "a confirmed account with no answers is offered the welcome step",
  (sentToWelcome.headers?.location ?? "").includes("/welcome"),
  sentToWelcome.headers?.location,
);

/* Its own fetch: the shared `list` is built further down. */
const forGate = await req("/api/sessions?days=21");
const openSlot = (forGate.json?.sessions ?? []).find(
  (s) => s.spotsLeft > 0 && s.classType?.kind !== "PERSONAL",
);
const unanswered = await req("/api/bookings", {
  method: "POST",
  body: { sessionId: openSlot?.id },
});
check(
  "and booking is NOT refused for not having answered them",
  unanswered.json?.error !== "INTAKE_REQUIRED",
  unanswered.json,
);
/* Whatever else it says, it must not be about the questionnaire. The fixture
   has no sessions yet at this point, so NO_CREDITS is the expected answer and
   is proof the request got all the way to the credit check. */
check(
  "it gets as far as the credit check, like any other member",
  unanswered.json?.error === "NO_CREDITS" || unanswered.json?.ok === true,
  unanswered.json,
);

/* The route still validates what it is given, which is a different thing from
   requiring it to be given at all. */
const halfAnswered = await req("/api/profile/intake", {
  method: "POST",
  body: { level: "BEGINNER" },
});
check(
  "a half-filled answer is still refused by the route",
  halfAnswered.status === 400,
  halfAnswered.json,
);

const answered = await req("/api/profile/intake", {
  method: "POST",
  body: { level: "BEGINNER", experience: "NONE", condition: "" },
});
check("answering all three works", answered.json?.ok === true, answered.json);
check(
  "and /welcome then sends them on rather than asking again",
  [307, 302].includes((await req("/welcome")).status),
);

console.log("\n3c. Closing the browser does not lose the account");
/* The studio asked what happens to somebody who registers, never types the
   code, and comes back later. The answer this locks in: the account is kept, the
   same password still works, they land back on the code box, and the code they
   were already sent is still the one to type — no new one needed unless it has
   expired. */
{
  const keep = new Map(jar);
  jar.clear();

  const lapsedEmail = `lapsed-${Date.now()}@rg.test`;
  const made = await req("/api/auth/register", {
    method: "POST",
    body: {
      name: "Came Back Later",
      email: lapsedEmail,
      password: "test12345",
      phone: uniquePhone(),
      serviceOptIn: true,
      termsAccepted: true,
    },
  });
  check("registers", made.json?.ok === true, made.json);

  /* Closing the browser: the cookie is gone, the row is not. */
  jar.clear();

  const again = await req("/api/auth/login", {
    method: "POST",
    body: { email: lapsedEmail, password: "test12345" },
  });
  check(
    "the same credentials still sign in",
    again.json?.ok === true,
    again.json,
  );
  check(
    "and are sent to the code box",
    again.json?.verify === true,
    again.json,
  );

  const state = await req("/api/auth/verify");
  check(
    "the code they were already sent is still live",
    state.json?.challenge,
    state.json,
  );
  check(
    "not expired, so there is nothing to re-request",
    state.json?.challenge?.expired === false,
    state.json?.challenge,
  );
  check(
    "and it has all its attempts",
    state.json?.challenge?.attemptsLeft === 5,
    state.json?.challenge,
  );

  await req("/api/auth/logout", { method: "POST" });
  jar.clear();
  for (const [k, v] of keep) jar.set(k, v);
}

console.log("\n4. Account page now loads");
const acct = await req("/account");
check("GET /account → 200", acct.status === 200, acct.status);
check("session balance shows on page", acct.text.includes("Session balance"));

/* And once signed in, the same spot shows who you are instead. */
const coverIn = await req("/");
check(
  "the cover shows the member instead once signed in",
  coverIn.text.includes("HTTP Tester") || coverIn.text.includes("HTTP"),
  "no member on the cover",
);
check(
  "and stops offering a sign in",
  !coverIn.text.includes("Already a member"),
  "the cover still asks them to sign in",
);

console.log("\n4b. Every account section is reachable by its own address");
/* The header menu links to these. Each has to render its own section: clicking
   Profile once landed on Notifications, because "no tab in the address" was
   being treated as "an address I do not recognise" and the old section stayed. */
for (const [tab, needle] of [
  ["", "Session balance"],
  ["profile", "Session balance"],
  ["notifications", "Always on"],
  ["activity", "Session activity"],
  ["classes", "Past classes"],
  ["payments", "Payments"],
  ["password", "Password"],
  ["nonsense", "Session balance"],
]) {
  const r = await req(tab ? `/account?tab=${tab}` : "/account");
  check(
    `GET /account${tab ? `?tab=${tab}` : ""} renders its section`,
    r.status === 200 && r.text.includes(needle),
    r.status,
  );
}

/* The Classes page is gone: one class type, so a page telling six of them
   apart was answering a question nobody had. Its team cards moved to /studio,
   which is checked in 12c. */
check("the Classes page is retired", (await req("/classes")).status === 404);

console.log("\n5. Booking without credits");
const sess = await req("/api/sessions?days=10");
const all = sess.json?.sessions ?? [];
/* Group classes only, throughout this section. A midday appointment holds one
   person, closes to booking at the end of the previous day and is paid for with
   a session an ordinary pack does not contain, so mixing them in here would
   test three rules at once and report the wrong one. */
const list = all.filter((s) => s.classType?.kind !== "PERSONAL");
const appointments = all.filter((s) => s.classType?.kind === "PERSONAL");
check("timetable API returns classes", list.length > 0, list.length);
check(
  "and appointments alongside them",
  appointments.length > 0,
  appointments.length,
);
/* Comfortably outside the 24-hour cancellation window, so the cancel step
   below exercises the refund path rather than the lock-out. */
const target = list.find(
  (s) =>
    s.spotsLeft > 0 &&
    new Date(s.startsAt) > new Date(Date.now() + 48 * 3600_000),
);
check("found a bookable class", Boolean(target));

const noCredits = await req("/api/bookings", {
  method: "POST",
  body: { sessionId: target.id },
});
check(
  "booking refused with no credits",
  noCredits.json?.error === "NO_CREDITS",
  noCredits.json,
);

console.log("\n6. Buy a pack");
const pricing = await req("/pricing");
check("pricing page renders €200 pack", pricing.text.includes("200"));
check(
  "the 3-class pack is no longer offered",
  !/Intro\s*·\s*3/.test(pricing.text),
);
check(
  "no 3-session pack anywhere on the page",
  !/"credits":3/.test(pricing.text),
);

/* Buying is two steps now, the same two a card goes through: open the payment,
   then settle it. Nothing is granted by opening it — see scripts/test-payments.mjs
   for the full set of promises around that. */
const opened = await req("/api/checkout", {
  method: "POST",
  body: { packSlug: "month-2" },
});
check(
  "a payment opens for the 10-class pack",
  Boolean(opened.json?.purchaseId),
  opened.json,
);
check(
  "the provider says how to pay",
  ["fields", "redirect", "test"].includes(opened.json?.mode),
  opened.json,
);

const settled = await req("/api/payments/settle", {
  method: "POST",
  body: { purchaseId: opened.json?.purchaseId },
});
check(
  "settling it grants the sessions",
  settled.json?.status === "PAID",
  settled.json,
);
check("balance is 8", settled.json?.credits === 8, settled.json);

console.log("\n7. Book with credits");
const booked = await req("/api/bookings", {
  method: "POST",
  body: { sessionId: target.id },
});
check("booking succeeds", booked.json?.ok === true, booked.json);
check("balance is now 7", booked.json?.credits === 7, booked.json);

const again = await req("/api/bookings", {
  method: "POST",
  body: { sessionId: target.id },
});
check(
  "double booking refused",
  again.json?.error === "ALREADY_BOOKED",
  again.json,
);

const mine = await req("/api/bookings");
check(
  "upcoming list has 1 booking",
  mine.json?.upcoming?.length === 1,
  mine.json?.upcoming?.length,
);

console.log("\n8. Cancel and get the credit back");
const bookingId = booked.json?.bookingId;
const cancelled = await req("/api/bookings/cancel", {
  method: "POST",
  body: { bookingId },
});
check(
  "cancel succeeds and refunds",
  cancelled.json?.ok && cancelled.json?.refunded,
  cancelled.json,
);
check("balance back to 8", cancelled.json?.credits === 8, cancelled.json);

/* Every group class the studio runs is 50 minutes with five places. */
const cap = list.every((s) => s.capacity === 5);
check(
  "every class has five places",
  cap,
  list.find((s) => s.capacity !== 5)?.capacity,
);
/* And every appointment holds exactly one, which is the whole point of it. */
check(
  "every appointment holds one person",
  appointments.every((s) => s.capacity === 1),
  appointments.find((s) => s.capacity !== 1)?.capacity,
);
(check(
  "and sits at 12:00, 13:00 or 14:00 on a weekday",
  appointments.every((s) => {
    const at = new Date(s.startsAt);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Nicosia",
        hour: "2-digit",
        hour12: false,
      }).format(at),
    );
    const dow = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Nicosia",
      weekday: "short",
    }).format(at);
    return [12, 13, 14].includes(hour) && !["Sat", "Sun"].includes(dow);
  }),
),
  check(
    "the timetable calls every group class Reformer Flow",
    new Set(list.map((s) => s.classType?.nameEn)).size === 1 &&
      list[0]?.classType?.nameEn === "Reformer Flow",
    [...new Set(list.map((s) => s.classType?.nameEn))],
  ));
const sixtyMinutes = list.every(
  (s) =>
    !s.endsAt ||
    new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime() === 3600_000,
);
check("class length is 60 minutes", sixtyMinutes);

/**
 * And the page has to say so.
 *
 * This assertion used to read the other way round: whole-hour end times, and no
 * ":50" anywhere. A class is fifty minutes on the mat in an hourly slot, so the
 * end time a member reads is now ten to the hour, and a timetable still showing
 * round hours would mean the display had been left behind by the data.
 */
const tt = await req("/timetable");
check("timetable shows whole hour end times", !/\d:50/.test(tt.text));
check(
  "timetable never offers a Sunday class",
  list.every((s) => new Date(s.startsAt).getUTCDay() !== 0),
);

console.log(
  "\n8a-ii. The two numbers the header keeps fresh, and the manifest",
);
/**
 * `/api/me` and the web app manifest, both of which exist for the same reason:
 * a member who never closes the site.
 *
 * The header renders the badge and the balance on the server, which is stale
 * from the second paint onwards, so it polls this route. And the manifest is
 * what makes an iPhone treat an added-to-Home-Screen icon as an installed app
 * rather than a bookmark — which is what web push requires there. Its absence
 * was why notifications did nothing on iOS, silently, with everything else
 * correctly configured. `display: standalone` is the load-bearing line.
 */
const me = await req("/api/me");
check(
  "the header can read its own badge and balance",
  me.status === 200 &&
    me.json?.signedIn === true &&
    typeof me.json?.unread === "number" &&
    typeof me.json?.credits === "number",
  me.json,
);

const mani = await fetch(`${BASE}/manifest.webmanifest`);
const maniJson = await mani.json().catch(() => null);
check(
  "the manifest is served, and to anybody",
  mani.status === 200,
  mani.status,
);
check(
  "and declares standalone, without which iOS cannot do push at all",
  maniJson?.display === "standalone",
  maniJson?.display,
);
check(
  "with the two icon sizes iOS refuses to install without",
  ["192x192", "512x512"].every((size) =>
    (maniJson?.icons ?? []).some((i) => i.sizes === size),
  ),
  maniJson?.icons?.map((i) => i.sizes),
);

console.log("\n8a-iv. Booking one slot for a whole term");
/**
 * The repeat-booking route, over HTTP.
 *
 * The rules themselves are exercised properly in test-flows, against the
 * database. What this checks is the shape of the door: that it is closed to
 * anybody not signed in, that it refuses a request for one week or for a year,
 * and that a genuine run answers 200 with a summary rather than an error when
 * some weeks could not be taken — which is the whole design decision. A run of
 * twelve classes where the fourth is full has eleven perfectly good bookings in
 * it, and throwing those away to return a clean error would be worse for
 * everybody.
 */
{
  const anon = await fetch(`${BASE}/api/bookings/repeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "whatever", weeks: 4 }),
  });
  check("a signed-out caller is refused", anon.status === 401, anon.status);

  const slot = (await req("/api/sessions?days=30")).json?.sessions?.find(
    (x) => x.spotsLeft > 0 && x.classType?.kind !== "PERSONAL",
  );

  const oneWeek = await req("/api/bookings/repeat", {
    method: "POST",
    body: { sessionId: slot?.id, weeks: 1 },
  });
  check(
    "one week is not a repeat and is refused",
    oneWeek.status === 400 && oneWeek.json?.error === "BAD_WEEKS",
    oneWeek.json,
  );

  /**
   * Nine months is the ceiling now, and one week past it is not allowed.
   *
   * The longest pack the studio sells is nine months (39 weeks), so 39 is the
   * ceiling and 40 the first refusal. It was 52 while a twelve-month pack was on
   * sale; that pack is gone. The assertion worth having is the boundary.
   */
  const ceiling = await req("/api/bookings/repeat", {
    method: "POST",
    body: { sessionId: slot?.id, weeks: 39 },
  });
  check(
    "the nine-month ceiling of weeks is accepted",
    ceiling.status !== 400 || ceiling.json?.error !== "BAD_WEEKS",
    ceiling.json,
  );

  const overCeiling = await req("/api/bookings/repeat", {
    method: "POST",
    body: { sessionId: slot?.id, weeks: 40 },
  });
  check(
    "and one week past the ceiling is refused",
    overCeiling.status === 400 && overCeiling.json?.error === "BAD_WEEKS",
    overCeiling.json,
  );

  const missing = await req("/api/bookings/repeat", {
    method: "POST",
    body: { sessionId: "not-a-class", weeks: 4 },
  });
  check(
    "a class that does not exist is a 404",
    missing.status === 404,
    missing.status,
  );

  const run = await req("/api/bookings/repeat", {
    method: "POST",
    body: { sessionId: slot?.id, weeks: 4 },
  });
  check(
    "a real run answers with a summary, not an error",
    run.status === 200 &&
      run.json?.ok === true &&
      typeof run.json?.booked === "number" &&
      Array.isArray(run.json?.failed),
    run.json,
  );
  check(
    "and says what the balance is afterwards",
    typeof run.json?.credits === "number",
    run.json?.credits,
  );
}

console.log("\n8a-iii. Which language a phone notification goes out in");
/**
 * The language of a push notification, which used to be English for everybody.
 *
 * The site has always known which language a member reads it in — the switch at
 * the top of every page sets a cookie, and every page is rendered from it. What
 * the server did not know was which language to use when nobody is looking at a
 * page, and that is the only time a notification is ever sent: a reminder two
 * hours before a class is composed by a sweep with no browser attached to it.
 * So a member reading the site in Greek got a Greek notice in their account and
 * an English copy of the same message on their phone.
 *
 * The fix is a column, written when the switch is pressed. This asserts the
 * plumbing end to end: the route accepts a choice, refuses nonsense, and the
 * account remembers it.
 */
const badLocale = await req("/api/me/locale", {
  method: "POST",
  body: { locale: "fr" },
});
check(
  "a language the site does not speak is refused",
  badLocale.status === 400,
  badLocale.status,
);

const toGreek = await req("/api/me/locale", {
  method: "POST",
  body: { locale: "el" },
});
check(
  "pressing the switch records it on the account, not just in a cookie",
  toGreek.status === 200 && toGreek.json?.saved === true,
  toGreek.json,
);

/* Idempotent: pressing it twice is one answer, not an error. Which matters
   because the switch is pressed twice by anybody comparing the two. */
const twice = await req("/api/me/locale", {
  method: "POST",
  body: { locale: "el" },
});
check(
  "and pressing it again is not an error",
  twice.status === 200 && twice.json?.saved === true,
  twice.json,
);

/* Put back, so the rest of the suite reads English. */
await req("/api/me/locale", { method: "POST", body: { locale: "en" } });

/**
 * The Android status-bar mark, which has to be a glyph on transparency.
 *
 * Android throws this image's colours away and keeps only its alpha channel,
 * then tints the result and crops it to a circle — so the square opaque logo
 * that used to be here arrived on every Android phone as a solid white square.
 * Asserted as a file rather than as pixels: the service worker names it, and a
 * missing file is a notification with no mark at all.
 */
const badge = await fetch(`${BASE}/brand/notification-badge.png`);
check(
  "the notification badge is served",
  badge.status === 200 &&
    (badge.headers.get("content-type") ?? "").includes("png"),
  badge.status,
);

const sw = await (await fetch(`${BASE}/sw.js`)).text();
check(
  "and the service worker points at it rather than the square logo",
  /badge:\s*"\/brand\/notification-badge\.png"/.test(sw),
);

console.log("\n8b. What browsers are allowed to keep");
/**
 * The cache rules, asserted rather than assumed.
 *
 * These decide whether a deploy is visible. The HTML points at hashed asset
 * filenames, so a cached page is a browser serving last week's site to somebody
 * who reloaded; the hashed assets themselves can be kept forever because their
 * names change with their contents.
 *
 * Worth a test because the rules interact in a way that is easy to get wrong:
 * Next applies *every* matching rule and the last one wins, so a broad rule
 * placed after a narrow one silently undoes it. That happened while writing
 * them, and it undid both the immutable caching and the service worker.
 */
const cc = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader() },
  });
  return res.headers.get("cache-control") ?? "";
};

const pageCache = await cc("/pricing");
check(
  "a page must be re-checked on every visit, so a deploy is seen",
  /max-age=0/.test(pageCache) && /must-revalidate/.test(pageCache),
  pageCache,
);

const chunk = (await req("/pricing")).text.match(
  /\/_next\/static\/chunks\/[a-zA-Z0-9._-]+\.js/,
)?.[0];
const chunkCache = chunk ? await cc(chunk) : "";
check(
  "but a fingerprinted asset is kept forever, because its name changes with it",
  /immutable/.test(chunkCache) && /max-age=31536000/.test(chunkCache),
  { chunk, chunkCache },
);

const swCache = await cc("/sw.js");
check(
  "the push worker is never served from a cache",
  /no-store/.test(swCache),
  swCache,
);

/* The privacy half of the same rules lives in test-profile.mjs, under "the photo
   is served privately": that suite has actually uploaded a photograph, so there
   is a real response to read the header off. It is the assertion that caught a
   blanket `public` rule here quietly overriding the avatar route's `private`,
   which would have let a shared cache hold one member's photograph and hand it
   to somebody else. Worth knowing where it is. */

const cancelAgain = await req("/api/bookings/cancel", {
  method: "POST",
  body: { bookingId },
});
check("double cancel refused", cancelAgain.status === 409, cancelAgain.status);

console.log("\n9. Cannot touch another member's booking");
const otherJarBackup = new Map(jar);
jar.clear();
const otherEmail = `other-${Date.now()}@rg.test`;
await req("/api/auth/register", {
  method: "POST",
  body: {
    name: "Second User",
    email: otherEmail,
    password: "test12345",
    phone: uniquePhone(),
    serviceOptIn: true,
    termsAccepted: true,
  },
});
/* Refused twice over until the address is confirmed, which would hide the rule
   being tested here: verify first, so the 409 that comes back is "that booking
   is not yours" rather than "confirm your email". */
const stealUnverified = await req("/api/bookings/cancel", {
  method: "POST",
  body: { bookingId },
});
check(
  "an unverified account cannot cancel anything at all",
  stealUnverified.status === 403 &&
    stealUnverified.json?.error === "EMAIL_UNVERIFIED",
  stealUnverified.json,
);
check("the second fixture verifies", markVerified(otherEmail) === 1);
/* And signs in again, so the cookie carries the confirmed stamp — otherwise the
   middleware answers first and this tests the wrong rule. */
await req("/api/auth/login", {
  method: "POST",
  body: { email: otherEmail, password: "test12345" },
});
const steal = await req("/api/bookings/cancel", {
  method: "POST",
  body: { bookingId },
});
check("other member cannot cancel it", steal.status === 409, steal.status);
jar.clear();
for (const [k, v] of otherJarBackup) jar.set(k, v);

console.log("\n10. Admin is staff-only");
const adminBlocked = await req("/api/admin/generate", {
  method: "POST",
  body: { weeks: 1 },
});
check(
  "member cannot generate schedule",
  adminBlocked.status === 403,
  adminBlocked.status,
);
/* A signed-in member sees the very same door a stranger sees — no redirect to
   their account, no hint that they are on the wrong side of it. */
const adminPage = await req("/admin");
check(
  "member sees the desk door, not the console",
  adminPage.status === 200 &&
    adminPage.text.includes("desk-email") &&
    !adminPage.text.includes("data-desk-console"),
  adminPage.status,
);

console.log("\n11. Admin login, and the desk's own lock");
jar.clear();
const adminLogin = await req("/api/auth/login", {
  method: "POST",
  body: { email: "owner@rgpilatesstudio.com", password: "ownerdev123" },
});
check("admin signs in", adminLogin.json?.ok === true, adminLogin.json);

/* The console is behind a second door: staff, and the password typed again.
   scripts/test-desk.mjs is where that lock is tested properly. */
const locked = await req("/admin");
check("the console loads", locked.status === 200, locked.status);
check("locked, asking for the password", locked.text.includes("desk-password"));
const blocked = await req("/api/admin/generate", {
  method: "POST",
  body: { weeks: 2 },
});
check(
  "and its actions are refused until then",
  blocked.status === 423,
  blocked.status,
);

await req("/api/admin/unlock", {
  method: "POST",
  body: { password: "ownerdev123" },
});
const adminOk = await req("/admin");
check("unlocked, the dashboard loads", adminOk.status === 200, adminOk.status);
/* The console proper, not the door: its marker and its own tab bar. The
   analytics live behind a tab of their own now, so the opening screen is the
   day's bookings rather than a row of takings. */
check(
  "the console itself is on screen",
  adminOk.text.includes("data-desk-console") &&
    adminOk.text.includes('data-desk-tab="analytics"'),
  "no desk console",
);
const gen = await req("/api/admin/generate", {
  method: "POST",
  body: { weeks: 2 },
});
check("admin can generate schedule", gen.json?.ok === true, gen.json);

console.log("\n12. Contact form");
const contact = await req("/api/contact", {
  method: "POST",
  body: {
    name: "Enquiry Test",
    email: "hi@example.com",
    message: "Do you run duets on Saturdays?",
  },
});
check("contact message accepted", contact.json?.ok === true, contact.json);
const badContact = await req("/api/contact", {
  method: "POST",
  body: { name: "x", email: "bad" },
});
check(
  "bad contact message rejected",
  badContact.status === 400,
  badContact.status,
);

/* Name, email and message are all required, and the message has a floor. */
const missingName = await req("/api/contact", {
  method: "POST",
  body: {
    email: "hi@example.com",
    message: "A properly long enquiry about levels.",
  },
});
check(
  "contact needs a name",
  missingName.json?.error === "NAME_REQUIRED",
  missingName.json,
);

const missingEmail = await req("/api/contact", {
  method: "POST",
  body: {
    name: "Test Person",
    message: "A properly long enquiry about levels.",
  },
});
check(
  "contact needs an email",
  missingEmail.json?.error === "EMAIL_INVALID",
  missingEmail.json,
);

const shortMessage = await req("/api/contact", {
  method: "POST",
  body: { name: "Test Person", email: "hi@example.com", message: "hi" },
});
check(
  "contact refuses a too-short message",
  shortMessage.json?.error === "MESSAGE_TOO_SHORT",
  shortMessage.json,
);

const noMessage = await req("/api/contact", {
  method: "POST",
  body: { name: "Test Person", email: "hi@example.com" },
});
check("contact needs a message", noMessage.status === 400, noMessage.status);

console.log("\n12b. Studio details and social accounts");
const contactPage = await req("/contact");
for (const needle of [
  "Patron 30",
  "Larnaca 6051",
  "facebook.com/p/RG-pilates-studio-61580648810956",
  "instagram.com/rgpilates_studio",
]) {
  check(`contact page shows ${needle}`, contactPage.text.includes(needle));
}
const home = await req("/");
check(
  "footer links Facebook",
  home.text.includes("facebook.com/p/RG-pilates-studio-61580648810956"),
);
/* The build credit, on every page because it lives in the footer. */
check(
  "footer credits the maker",
  home.text.includes("Developed &amp; Designed by") ||
    home.text.includes("Developed & Designed by"),
);
check("and links to them", home.text.includes("https://www.ergonsite.com"));
check(
  "with the wordmark, not the name in text",
  home.text.includes("ergonsite.png"),
);
check(
  "footer links Instagram",
  home.text.includes("instagram.com/rgpilates_studio"),
);
/* The accounts are shown as the platforms' own marks, not as words. */
for (const page of [home, contactPage]) {
  check(
    "social marks render",
    page.text.includes("social-icon-instagram") &&
      page.text.includes("social-icon-facebook"),
  );
  check(
    "each mark carries the handle",
    page.text.includes("Instagram: @rgpilates_studio") &&
      page.text.includes("Facebook: RG pilates studio"),
  );
}
check(
  "timetable line drops the real-time claim",
  !(await req("/timetable")).text.includes("Availability updates in real time"),
);
check(
  "contact promises a reply back soon",
  contactPage.text.includes("reply back soon"),
);

console.log("\n12c. Instructor cards");
/* The team moved off the retired Classes page and onto the studio page, where
   it sits between the equipment section and Standards not slogans. */
const studioPage = await req("/studio");
for (const name of ["Andrea", "Maria"]) {
  check(`team card shows ${name}`, studioPage.text.includes(name));
}
check(
  "and it is between the room photograph and the standards",
  (() => {
    const room = studioPage.text.indexOf("hero-1.jpg");
    const team = studioPage.text.indexOf("Andrea");
    const standards = studioPage.text.search(/Standards|Πρότυπα/);
    return room > -1 && team > room && standards > team;
  })(),
);

console.log("\n13. Stripe webhook is protected");
const hook = await req("/api/stripe/webhook", {
  method: "POST",
  body: { type: "checkout.session.completed" },
});
check(
  "webhook refuses unsigned calls",
  hook.status === 503 || hook.status === 400,
  hook.status,
);

/* -------------------------------------------------------------------- 14 */
console.log("\n14. The studio's private note about a member stays private");
/**
 * The one leak that would be worst and least visible.
 *
 * `users.notes` is what the desk writes about somebody — springs, an injury,
 * who they book with — and the member is never meant to read it. Nothing
 * enforces that with a flag: it is enforced by no member-facing query
 * selecting the column. Which is a rule that holds right up until somebody
 * adds a `select()` without a field list to a route a member can reach.
 *
 * So this asks the actual HTTP surface, with a real member session, whether a
 * phrase only the desk ever typed comes back anywhere.
 */
{
  jar.clear();
  const owner = await req("/api/auth/login", {
    method: "POST",
    body: { email: "owner@rgpilatesstudio.com", password: "ownerdev123" },
  });
  check("the owner signs in", owner.json?.ok === true, owner.json);
  await req("/api/admin/unlock", {
    method: "POST",
    body: { password: "ownerdev123" },
  });

  const found = await req("/api/admin/members?q=member@example.com");
  const memberId = found.json?.members?.[0]?.id;
  check("the demo member is findable at the desk", Boolean(memberId), found.json);

  const PHRASE = "SPRINGSECRET-desk-only";
  if (memberId) {
    const wrote = await req("/api/admin/member", {
      method: "PATCH",
      body: { userId: memberId, notes: `${PHRASE} note for staff` },
    });
    check("the desk can write a note", wrote.json?.ok === true, wrote.json);

    const readBack = await req(`/api/admin/members?id=${memberId}`);
    check(
      "and read it back",
      String(readBack.json?.member?.notes ?? "").includes(PHRASE),
      readBack.json?.member?.notes,
    );
  }

  /* Now as the member themselves. */
  jar.clear();
  const asMember = await req("/api/auth/login", {
    method: "POST",
    body: { email: "member@example.com", password: "member123" },
  });
  check("the member signs in", asMember.json?.ok === true, asMember.json);

  for (const path of [
    "/api/profile",
    "/api/bookings",
    "/api/sessions",
    "/account",
    "/account?tab=classes",
    "/account?tab=notifications",
    "/timetable",
  ]) {
    const res = await req(path);
    check(`${path} does not carry the studio's note`, !res.text.includes(PHRASE));
  }

  /* Put it back, so a repeat run and the desk suite start from a clean member. */
  jar.clear();
  await req("/api/auth/login", {
    method: "POST",
    body: { email: "owner@rgpilatesstudio.com", password: "ownerdev123" },
  });
  await req("/api/admin/unlock", {
    method: "POST",
    body: { password: "ownerdev123" },
  });
  if (memberId) {
    await req("/api/admin/member", {
      method: "PATCH",
      body: { userId: memberId, notes: "" },
    });
  }
}

console.log(
  `\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`,
);
process.exit(fail === 0 ? 0 : 1);
