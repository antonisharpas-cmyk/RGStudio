/**
 * The opening offer, over HTTP, with the offer switched on.
 *
 *   npm run build
 *   PROMO_ENABLED=true npx next start -p 3100
 *   npm run test:promo -- http://localhost:3100
 *
 * Its own suite because it needs the opposite environment from every other one:
 * the rest of the suites assert what a new account starts with and therefore run
 * with `PROMO_ENABLED=false`. Trying to serve both from one file would mean
 * assertions that change with the calendar, which is the kind of test that gets
 * deleted in six months rather than fixed.
 *
 * What it is really checking is two things: that the free session arrives only
 * once the emailed code has been typed back, and that a session tied to the
 * offer's dates cannot be spent outside them. Everything else is scaffolding.
 *
 * Note that this suite verifies through the real route rather than through the
 * `markVerified` fixture every other suite uses. It has to: the grant now lives
 * in that route, so a fixture that writes the column would run none of the code
 * this file exists to test. See `plantCode` in fixture-verify.mjs.
 */
import { creditsHeld, markOnboarded, plantCode } from "./fixture-verify.mjs";

const B = process.argv[2] ?? "http://localhost:3000";

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

let seq = 0;
const phone = () =>
  `+35799${String(200000 + ((Date.now() % 700000) + seq++ * 11)).slice(0, 6)}`;

async function member(tag) {
  const j = jar();
  const email = `promo-${tag}-${Date.now()}-${seq}@rg.test`;
  const reg = await req(j, "/api/auth/register", {
    method: "POST",
    body: {
      name: `Promo ${tag}`,
      email,
      phone: phone(),
      password: "test12345",
      serviceOptIn: true, termsAccepted: true,
    },
  });
  markOnboarded(email);
  return { j, email, ok: reg.json?.ok === true, err: reg.json?.error };
}

/**
 * Type the code back, the way a member does.
 *
 * The whole route runs, which is the point: this is where the free session is
 * handed over now. The cookie the verify route sets carries the confirmed stamp,
 * so no re-login is needed either — the database-writing fixture needed one only
 * because it left the cookie saying otherwise.
 */
async function confirm(m) {
  const code = plantCode(m.email);
  const res = await req(m.j, "/api/auth/verify", {
    method: "POST",
    body: { code },
  });
  return res;
}

/* ------------------------------------------------------------------ 1 */
console.log("\n1. The free session waits for the code, and then arrives");
const m = await member("joiner");
check("registration succeeds", m.ok, m.err);

/* The bug this section exists for. Registering is a claim about an address;
   until the code comes back it is only a claim, and the studio should not have
   paid out on it.

   Read from the database rather than from /api/bookings, because that route is
   behind the verification gate: it would answer with a refusal, and a refusal
   is not the same claim as "nothing was granted". */
check(
  "registering alone grants nothing",
  creditsHeld(m.email) === 0,
  creditsHeld(m.email),
);

/* And nothing has been said about a session that does not exist. */
const quiet = await req(m.j, "/api/notices?filter=all&page=1&locale=en");
check(
  "and no message about it has been sent yet",
  !(quiet.json?.rows ?? []).some((r) => /free session/i.test(r.title)),
  (quiet.json?.rows ?? []).map((r) => r.title),
);

const confirmed = await confirm(m);
check("the emailed code is accepted", confirmed.json?.ok === true, confirmed.json);

const wallet = await req(m.j, "/api/bookings");
check(
  "and the free session appears the moment it is",
  wallet.json?.credits === 1,
  wallet.json?.credits,
);

if (wallet.json?.credits !== 1) {
  console.error(
    "\n  ! The offer looks switched off. Start the server with PROMO_ENABLED=true\n",
  );
  process.exit(1);
}

/* And they are told, in a way that names the week. */
const notes = await req(m.j, "/api/notices?filter=all&page=1&locale=en");
const promoNote = (notes.json?.rows ?? []).find((r) => /free session/i.test(r.title));
check("they are told about it", Boolean(promoNote), (notes.json?.rows ?? []).map((r) => r.title));
check(
  "and the message names the window",
  /7 September/.test(promoNote?.body ?? "") && /30 September/.test(promoNote?.body ?? ""),
  promoNote?.body,
);
check(
  "and says when the session expires",
  /expires on 30 September/i.test(promoNote?.body ?? ""),
  promoNote?.body,
);

const el = await req(m.j, "/api/notices?filter=all&page=1&locale=el");
const greek = (el.json?.rows ?? []).find((r) => /συνεδρία δώρο/i.test(r.title));
check("the Greek version exists too", Boolean(greek), (el.json?.rows ?? []).map((r) => r.title));
check(
  "and the Greek names the dates and the expiry",
  /Σεπτεμβρίου/.test(greek?.body ?? "") && /λήγει/.test(greek?.body ?? ""),
  greek?.body,
);

/* ------------------------------------------------------------------ 2 */
console.log("\n2. It can only be spent inside the offer");

/* Find a class inside the promo week, and one well outside it. */
const sessions = await req(m.j, "/api/sessions?days=42");
const all = sessions.json?.sessions ?? sessions.json?.days?.flatMap((d) => d.sessions) ?? [];
check("the timetable answers", all.length > 0, all.length);

/* Classes with a place left, not simply classes.
 *
 * This suite books four of them per run, and every class holds five. Filtering
 * only by date meant it always reached for the *same first two* — so after a
 * couple of runs against one database those were full and four assertions
 * started failing with CLASS_FULL, which reads as a broken booking rule rather
 * than a suite that has eaten its own fixtures. */
/* And not the midday appointments.
 *
 * Those hold one person and are paid for with a Personal or Duet session, which
 * an ordinary pack does not contain, so booking one here fails with
 * NEEDS_PERSONAL_CREDIT — a refusal about credit kinds in a suite that is about
 * promotional windows. It surfaced when the offer moved a week and a different
 * session happened to land at the index this suite reaches for, which is the
 * kind of latent trap worth closing rather than working around. */
const free = (s) => (s.spotsLeft ?? 0) > 0 && s.classType?.kind !== "PERSONAL";

const inWeek = all.filter((s) => {
  const d = new Date(s.startsAt);
  return (
    free(s) &&
    d >= new Date("2026-09-07T00:00:00+03:00") &&
    d <= new Date("2026-09-30T23:59:00+03:00")
  );
});
const outside = all.filter(
  (s) => free(s) && new Date(s.startsAt) > new Date("2026-10-01T00:00:00+03:00"),
);

check("there are classes inside the offer", inWeek.length > 0, inWeek.length);
check("and classes after it", outside.length > 0, outside.length);

if (outside.length > 0) {
  /* The bug the whole feature turns on. */
  const stolen = await req(m.j, "/api/bookings", {
    method: "POST",
    body: { sessionId: outside[0].id },
  });
  check(
    "a class outside the offer is refused",
    stolen.json?.error === "CREDITS_NOT_VALID_HERE",
    stolen.json,
  );
  check(
    "and it does not say 'no sessions' when they plainly have one",
    stolen.json?.error !== "NO_CREDITS",
    stolen.json?.error,
  );
  const still = await req(m.j, "/api/bookings");
  check("the free session is untouched", still.json?.credits === 1, still.json?.credits);
}

if (inWeek.length > 0) {
  const booked = await req(m.j, "/api/bookings", {
    method: "POST",
    body: { sessionId: inWeek[0].id },
  });
  check("a class inside the week is booked", booked.json?.ok === true, booked.json);
  const after = await req(m.j, "/api/bookings");
  check("and the session is spent", after.json?.credits === 0, after.json?.credits);

  /* Cancelling gives it back, still tied to the week. */
  /* Matched on the start time: the booking rows carry that, not a session id. */
  const mine = (after.json?.upcoming ?? []).find(
    (b) => new Date(b.startsAt).getTime() === new Date(inWeek[0].startsAt).getTime(),
  );
  if (mine) {
    const off = await req(m.j, "/api/bookings/cancel", {
      method: "POST",
      body: { bookingId: mine.id },
    });
    check("cancelling is allowed", off.json?.ok === true, off.json);
    const back = await req(m.j, "/api/bookings");
    check("the free session comes back", back.json?.credits === 1, back.json?.credits);

    const again = await req(m.j, "/api/bookings", {
      method: "POST",
      body: { sessionId: outside[0].id },
    });
    check(
      "and is still refused outside the week after coming back",
      again.json?.error === "CREDITS_NOT_VALID_HERE",
      again.json,
    );
  }
}

/* ------------------------------------------------------------------ 3 */
console.log("\n3. A bought pack works for any week, free session or not");
const buyer = await member("buyer");
check("a second member joins", buyer.ok, buyer.err);

/* Buy a pack through the test provider, so they hold both kinds. */
const open = await req(buyer.j, "/api/checkout", {
  method: "POST",
  body: { packSlug: "month-1" },
});
if (open.json?.purchaseId) {
  await req(buyer.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: open.json.purchaseId },
  });
  const bal = await req(buyer.j, "/api/bookings");
  check("they hold the free session plus the pack", (bal.json?.credits ?? 0) === 5, bal.json?.credits);

  if (outside.length > 1) {
    const later = await req(buyer.j, "/api/bookings", {
      method: "POST",
      body: { sessionId: outside[1].id },
    });
    check("a later class books fine on the pack", later.json?.ok === true, later.json);
    const afterLater = await req(buyer.j, "/api/bookings");
    check("and four sessions remain", afterLater.json?.credits === 4, afterLater.json?.credits);
  }

  if (inWeek.length > 1) {
    const promoWeek = await req(buyer.j, "/api/bookings", {
      method: "POST",
      body: { sessionId: inWeek[1].id },
    });
    check("an opening-week class books too", promoWeek.json?.ok === true, promoWeek.json);
    /* And it should have taken the free one — it expires soonest and is valid —
       so the pack should still hold all five. */
    const afterPromo = await req(buyer.j, "/api/bookings");
    check(
      "and it spent the free session, leaving the pack whole",
      afterPromo.json?.credits === 3,
      afterPromo.json?.credits,
    );
  }
} else {
  console.log("  · no payment provider configured, skipping the pack half");
}

console.log(
  `\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`,
);
process.exit(fail === 0 ? 0 : 1);
