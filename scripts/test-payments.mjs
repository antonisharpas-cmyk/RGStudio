/**
 * Buying a session pack: the checkout page, settlement, and the promises that
 * matter most — nobody is charged without getting sessions, nobody gets
 * sessions twice, and nobody can settle somebody else's payment.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/test-payments.mjs http://localhost:3100
 *
 * Runs against the test provider (no card, nothing charged), which exercises
 * exactly the same routes and the same fulfilment path as a real provider.
 */
import { markOnboarded, markVerified } from "./fixture-verify.mjs";

const B = process.argv[2] ?? "http://localhost:3000";

/* One number, one account — so every registration in this suite needs its own.
   Registering two members with the same phone is now correctly refused. */
let __phoneSeq = 0;
function uniquePhone() {
  return `+35799${String(100000 + ((Date.now() % 800000) + __phoneSeq++ * 13)).slice(0, 6)}`;
}

function jar() {
  return new Map();
}
function ch(j) {
  return [...j].map(([k, v]) => `${k}=${v}`).join("; ");
}
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
    const [p] = c.split(";");
    const [k, ...r] = p.split("=");
    j.set(k.trim(), r.join("="));
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
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
        "\n    Start the server with:  npx next start -p <port>\n",
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

async function member(tag) {
  const j = jar();
  const email = `pay-${tag}-${Date.now()}@rg.test`;
  await req(j, "/api/auth/register", {
    method: "POST",
    body: {
      name: `Pay ${tag}`,
      email,
      phone: uniquePhone(),
      password: "test12345",
      serviceOptIn: true, termsAccepted: true,
    },
  });
  /* Confirm the address the way a member would. Without this every fixture in
     this suite is an account that may not pay for anything. */
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
  return { j, email };
}

/** What the member's own account page says their balance is. */
async function balance(j) {
  const page = await req(j, "/account");
  const m = page.text.match(/data-balance="(\d+)"/);
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ 1 */
console.log("\n1. The checkout page is not open to the world");
{
  const anon = jar();
  const r = await req(anon, "/checkout?pack=month-1");
  check(
    "a signed-out visitor is sent to sign in",
    r.status === 307 || r.status === 302,
    r.status,
  );
  check(
    "and comes back to the pack they picked",
    (r.headers.get("location") ?? "").includes("checkout"),
    r.headers.get("location"),
  );
  const noPack = await req(anon, "/checkout");
  check(
    "no pack means back to pricing",
    (noPack.headers.get("location") ?? "").includes("pricing"),
    noPack.headers.get("location"),
  );
  const api = await req(anon, "/api/checkout", {
    method: "POST",
    body: { packageId: "whatever" },
  });
  check("the API refuses a signed-out caller", api.json?.error === "UNAUTHENTICATED", api.json);
}

/* ------------------------------------------------------------------ 2 */
console.log("\n2. Opening a payment");
const buyer = await member("a");
let purchaseId = null;
{
  const page = await req(buyer.j, "/checkout?pack=month-2");
  check("the page renders for a member", page.status === 200, page.status);
  check(
    "it shows the pack and the total",
    page.text.includes("10") && /€|EUR/.test(page.text),
    "pack or price missing",
  );
  check(
    "it is kept out of search results",
    page.text.includes("noindex"),
    "no robots directive",
  );

  const started = await req(buyer.j, "/api/checkout", {
    method: "POST",
    body: { packSlug: "month-2" },
  });
  purchaseId = started.json?.purchaseId ?? null;
  check("a payment opens", Boolean(purchaseId), started.json);
  check(
    "the provider says how to pay",
    ["fields", "redirect", "test"].includes(started.json?.mode),
    started.json,
  );
  check(
    "no sessions are granted just for opening it",
    (await balance(buyer.j)) === 0,
    await balance(buyer.j),
  );

  const bad = await req(buyer.j, "/api/checkout", {
    method: "POST",
    body: { packSlug: "does-not-exist" },
  });
  check("an unknown pack is refused", bad.json?.error === "PACKAGE_NOT_FOUND", bad.json);
}

/* ------------------------------------------------------------------ 3 */
console.log("\n3. Settling the payment");
{
  const first = await req(buyer.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId },
  });
  check("the payment settles", first.json?.status === "PAID", first.json);
  check("eight sessions land on the account", first.json?.credits === 8, first.json);

  const again = await req(buyer.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId },
  });
  check("settling twice is safe", again.json?.status === "PAID", again.json);
  check(
    "and does not grant them twice",
    again.json?.credits === 8,
    again.json,
  );

  const third = await req(buyer.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId },
  });
  check("nor a third time", third.json?.credits === 8, third.json);

  const missing = await req(buyer.j, "/api/payments/settle", {
    method: "POST",
    body: {},
  });
  check("a settle with no purchase is refused", missing.json?.error === "BAD_REQUEST", missing.json);
}

/* ------------------------------------------------------------------ 4 */
console.log("\n4. One member cannot touch another's payment");
{
  const other = await member("b");
  const stolen = await req(other.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId },
  });
  check(
    "somebody else's purchase is not found",
    stolen.json?.error === "NOT_FOUND",
    stolen.json,
  );
  check("and their balance is untouched", (await balance(other.j)) === 0, await balance(other.j));
}

/* ------------------------------------------------------------------ 5 */
console.log("\n5. The success page tells the truth");
{
  const page = await req(buyer.j, `/checkout/success?p=${purchaseId}`);
  check("it renders", page.status === 200, page.status);
  check(
    "it shows the new balance",
    page.text.includes(">10<") || page.text.includes("10"),
    "balance missing",
  );
  const anon = jar();
  const stranger = await req(anon, `/checkout/success?p=${purchaseId}`);
  check(
    "a stranger with the link sees no balance",
    stranger.status === 200 && !stranger.text.includes("data-balance=\"10\""),
    stranger.status,
  );
}

/* ------------------------------------------------------------------ 6 */
console.log("\n6. A gateway return cannot be forged");
{
  const forged = await req(jar(), `/api/payments/return?Order=${purchaseId}&status=PAID`);
  check(
    "an unsigned return is refused",
    forged.status === 303 || forged.status === 400,
    forged.status,
  );
  check(
    "and it does not send anybody to the success page",
    !(forged.headers.get("location") ?? "").includes("success"),
    forged.headers.get("location"),
  );
}

/* ------------------------------------------------------------------ 7 */
console.log("\n7. The webhook is still sealed");
{
  const r = await req(jar(), "/api/stripe/webhook", {
    method: "POST",
    body: { type: "payment_intent.succeeded" },
  });
  check(
    "an unsigned webhook is refused",
    r.status === 400 || r.status === 503,
    r.status,
  );
}

/* ------------------------------------------------------------------ 8 */
console.log("\n8. Paying tells the member, once");
{
  const buyer = jar();
  const email = `paid-${Date.now()}@rg.test`;
  await req(buyer, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Paid Notice",
      email,
      phone: uniquePhone(),
      password: "test12345",
      serviceOptIn: true, termsAccepted: true,
    },
  });
  if (markVerified(email) !== 1) throw new Error(`fixture ${email} did not verify`);
  markOnboarded(email);
  await req(buyer, "/api/auth/login", {
    method: "POST",
    body: { email, password: "test12345" },
  });
  /* Timestamps are whole seconds and notices from before somebody joined are
     not theirs — so the boundary is put beyond doubt before counting. */
  await new Promise((r) => setTimeout(r, 1100));

  /**
   * Counted as a change, not as a total.
   *
   * Registering now writes its own in-app notice — the "your code is on its
   * way" one — so a fresh account does not start at zero and never will again
   * once the studio adds another welcome message. Asserting "unread === 0" made
   * this section fail for a reason that had nothing to do with payments, which
   * is exactly the kind of false alarm that gets a suite ignored. What matters
   * is that paying adds exactly one, so that is what is measured.
   */
  const start = await req(buyer, "/api/notices");
  const before = start.json?.unread ?? 0;

  const opened = await req(buyer, "/api/checkout", {
    method: "POST",
    body: { packSlug: "month-2" },
  });
  const midway = await req(buyer, "/api/notices");
  /* Opening a payment is not paying. Telling somebody their sessions have
     arrived while the card form is still on screen would be a lie. */
  check(
    "opening the payment says nothing",
    midway.json?.unread === before,
    { before, now: midway.json?.unread },
  );

  const settled = await req(buyer, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: opened.json?.purchaseId },
  });
  check("the payment settles", settled.json?.status === "PAID", settled.json);

  const after = await req(buyer, "/api/notices");
  check(
    "the member is told",
    after.json?.unread === before + 1,
    { before, now: after.json?.unread },
  );
  const msg = (after.json?.notices ?? [])[0];
  check("with the payment named", msg?.title === "Payment received", msg?.title);
  check(
    "the sessions, the price and the expiry",
    /8 sessions/.test(msg?.body ?? "") &&
      /€110/.test(msg?.body ?? "") &&
      /expire on/.test(msg?.body ?? ""),
    msg?.body,
  );

  /* The webhook, the browser coming back and a later check all report the same
     payment. Only the one that granted the sessions may speak. */
  await req(buyer, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: opened.json?.purchaseId },
  });
  await req(buyer, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: opened.json?.purchaseId },
  });
  const again = await req(buyer, "/api/notices");
  check(
    "settling three times still tells them once",
    again.json?.unread === before + 1,
    { before, now: again.json?.unread },
  );
  check(
    "and grants the sessions once",
    (await req(buyer, "/api/bookings")).json?.credits === 8,
    "balance moved on a repeat settle",
  );
}

console.log("\n9. The invoice, and who may read it");
/**
 * The studio's own VAT invoice, downloadable from the member's account.
 *
 * It is attached to the confirmation email, which is where most people will get
 * it. This route is for the other times — the email was deleted, it went to
 * spam, or the accountant asks for it in March.
 *
 * The permission is the point of this section. An invoice is somebody's
 * financial record, and the check is on the purchase's own owner rather than on
 * the id in the URL: a UUID is unguessable, but unguessable is not a permission
 * model, and a member who forwards a link should not hand over their payment
 * history with it. A stranger gets 404 rather than 403, so probing ids cannot
 * be used to learn which of them exist.
 */
{
  const reader = await member("inv");
  const opened = await req(reader.j, "/api/checkout", {
    method: "POST",
    body: { packSlug: "month-2" },
  });
  const id = opened.json?.purchaseId;
  await req(reader.j, "/api/payments/settle", {
    method: "POST",
    body: { purchaseId: id },
  });

  const mine = await req(reader.j, `/api/invoices/${id}`);
  check("the buyer can download their own invoice", mine.status === 200, mine.status);
  check(
    "and it really is a PDF",
    (mine.headers.get("content-type") ?? "").includes("application/pdf") &&
      mine.text.startsWith("%PDF-"),
    mine.headers.get("content-type"),
  );
  check(
    "which no shared cache is allowed to keep",
    /private/.test(mine.headers.get("cache-control") ?? "") &&
      /no-store/.test(mine.headers.get("cache-control") ?? ""),
    mine.headers.get("cache-control"),
  );
  check(
    "named after the invoice, not 'invoice.pdf'",
    /filename="RG-pilates-invoice-[^"]+\.pdf"/.test(
      mine.headers.get("content-disposition") ?? "",
    ),
    mine.headers.get("content-disposition"),
  );

  const stranger = await member("inv-other");
  const theirs = await req(stranger.j, `/api/invoices/${id}`);
  check(
    "another member cannot read it, and cannot tell it exists",
    theirs.status === 404,
    theirs.status,
  );

  const anon = await req(jar(), `/api/invoices/${id}`);
  check("and neither can a stranger with no account", anon.status === 401, anon.status);

  const nonsense = await req(reader.j, "/api/invoices/not-a-purchase");
  check("a purchase that does not exist is a 404", nonsense.status === 404, nonsense.status);

  /**
   * A specimen is downloadable but never emailed.
   *
   * While the VAT details are still placeholder, the document is stamped
   * SPECIMEN and says at the bottom that it is not a valid invoice. The studio
   * needs to be able to look at that; a member who has just paid must not
   * receive it, because it is a document telling them their own paperwork is
   * void. The route serves it, the email does not attach it, and the
   * confirmation does not claim an attachment it is not carrying.
   *
   * Which of the two this run exercises depends on whether the server was
   * started with the invoice details set, so this asserts the pair that must
   * hold either way: a number and a claim of an attachment go together, or
   * neither is there.
   */
  const numbered = /filename="RG-pilates-invoice-\d{4}-\d{4}\.pdf"/.test(
    mine.headers.get("content-disposition") ?? "",
  );
  const notices = await req(reader.j, "/api/notices");
  const paidNotice = (notices.json?.notices ?? []).find((n) =>
    /Payment received/i.test(n.title ?? ""),
  );
  const claimsInvoice = /invoice is attached/i.test(paidNotice?.body ?? "");
  check(
    numbered
      ? "a numbered invoice is claimed in the confirmation"
      : "a specimen is not claimed in the confirmation",
    numbered === claimsInvoice,
    { numbered, claimsInvoice, body: paidNotice?.body },
  );
}

console.log(
  `\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`,
);
process.exit(fail === 0 ? 0 : 1);
