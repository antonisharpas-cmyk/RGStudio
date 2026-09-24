/**
 * Builds docs/RG-pilates-desk-manual.pdf from docs/manual/manual.html.
 *
 *   npm run build && npx next start -p 3100
 *   npm run manual -- http://localhost:3100
 *
 * Three jobs, in order: take every screenshot the manual refers to against a
 * real running console, number the chapters and build the contents page, then
 * print the whole thing to A4 through Chromium.
 *
 * ---
 *
 * **Why this script exists rather than a finished PDF in the repo.**
 *
 * The first version of this manual was built by hand and the tooling was thrown
 * away, so the next change to the console left a document that quietly described
 * a screen that no longer looked like that. A manual nobody can rebuild is a
 * manual that goes stale on the first Tuesday somebody moves a button. The
 * source is now `docs/manual/manual.html`, the figures are captured from the
 * running app, and rebuilding is one command.
 *
 * **The numbering is not in the source.** Chapters are written as plain
 * `<h2>Title</h2>` and numbered here, and the contents page is generated from
 * them. Inserting a chapter in the middle used to mean renumbering eleven
 * headings twice, once per language, and editing two lists by hand: a job nobody
 * gets right on a Friday.
 *
 * **It needs Playwright**, which is not a dependency of the app: it exists to
 * drive a browser and nothing in the studio's day needs one. Install it when you
 * want to rebuild the manual and leave it out otherwise:
 *
 *   npm i -D playwright-core   (and a Chromium it can find)
 *
 * If it is missing this script says so in one line rather than throwing a stack
 * trace at somebody who only wanted a PDF.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markOnboarded, markVerified } from "./fixture-verify.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = "docs/manual/figures";
const SOURCE = "docs/manual/manual.html";
const PDF = "docs/RG-pilates-desk-manual.pdf";

const OWNER = { email: "owner@rgpilatesstudio.com", password: "ownerdev123" };

/* ------------------------------------------------------------------ chromium */

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core").then((m) => m.default ?? m));
  } catch {
    console.error(
      "\n  This needs Playwright, which the app does not depend on.\n" +
        "  Install it just to rebuild the manual:  npm i -D playwright-core\n",
    );
    process.exit(1);
  }
  /* An explicit path wins, then whatever Playwright can find for itself. A
     container and a laptop keep Chromium in different places, and hard-coding
     either one breaks the other. */
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath });
}

/* ------------------------------------------------------------------- figures */

/**
 * The top of a panel rather than the whole of it.
 *
 * A console tab is several thousand pixels tall and a figure in a manual is a
 * reminder of where you are, not a facsimile. So the width comes from the
 * element and the height is capped, which puts the reader at the top of the
 * screen they are reading about.
 */
async function shotTop(page, selector, name, maxHeight = 980) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no ${selector} on ${page.url()}`);
  await page.screenshot({
    path: join(OUT_DIR, `${name}.png`),
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: Math.min(box.width + 16, 1400),
      height: Math.min(box.height + 16, maxHeight),
    },
  });
  console.log("  fig", name);
}

async function shotOf(page, selector, name) {
  await page.locator(selector).first().screenshot({
    path: join(OUT_DIR, `${name}.png`),
  });
  console.log("  fig", name);
}

const uniquePhone = (() => {
  let n = 0;
  return () =>
    `+35799${String(100000 + ((Date.now() % 700000) + n++ * 37)).slice(0, 6)}`;
})();

async function api(page, path, data) {
  const res = await page.request.post(BASE + path, data ? { data } : {});
  return { status: res.status(), json: await res.json().catch(() => null) };
}

/** A member with a little history, so the figures are not all empty states. */
async function makeFixtures(page) {
  const stamp = Date.now();

  /* One confirmed member, sold a pack at the desk, so the member figure shows a
     balance, a payment and a session history rather than three empty panels. */
  const member = `manual-member-${stamp}@rg.test`;
  await api(page, "/api/auth/register", {
    name: "Elena Georgiou",
    email: member,
    phone: uniquePhone(),
    password: "test12345",
    serviceOptIn: true, termsAccepted: true,
  });

  /* One left unconfirmed, for the amber flag and the blocked sell panel. */
  const unverified = `manual-unverified-${stamp}@rg.test`;
  await api(page, "/api/auth/register", {
    name: "Andreas Nicolaou",
    email: unverified,
    phone: uniquePhone(),
    password: "test12345",
    serviceOptIn: true, termsAccepted: true,
  });

  return { member, unverified };
}

/**
 * Books the soonest appointment the studio could still accept, as the member.
 *
 * Signs in as them and hands the desk back afterwards, because booking is a
 * member action and reception has no route for it. Silent on failure: a figure
 * with no appointment strip is a worse manual, not a broken one, and the run
 * should not stop over it.
 */
async function bookAnAppointment(ctx, page, email) {
  try {
    const res = await page.request.get(`${BASE}/api/sessions?days=21`);
    const json = await res.json();
    /* At least two days out. An appointment closes to booking at the end of the
       previous day, so today's and tomorrow's may already be shut, and the
       booking would be refused for a reason that has nothing to do with the
       figure. */
    const earliest = Date.now() + 2 * 86_400_000;
    const slot = (json?.sessions ?? []).find(
      (s) =>
        s.classType?.kind === "PERSONAL" &&
        s.spotsLeft > 0 &&
        new Date(s.startsAt).getTime() > earliest,
    );
    if (!slot) return;

    const locale = "en";
    await api(page, "/api/auth/logout");
    await ctx.clearCookies();
    await api(page, "/api/auth/login", { email, password: "test12345" });
    const booked = await api(page, "/api/bookings", {
      sessionId: slot.id,
      guestName: "Marina C.",
    });
    if (!booked.json?.ok) {
      console.log("  ! appointment fixture not booked:", booked.json?.error);
    }
    await api(page, "/api/auth/logout");
    await ctx.clearCookies();
    void locale;
  } catch {
    /* Nothing to do about it, and nothing worth failing the manual over. */
  }
}

async function idOf(page, email) {
  const res = await page.request.get(
    `${BASE}/api/admin/members?q=${encodeURIComponent(email)}`,
  );
  const json = await res.json();
  return json?.members?.[0]?.id ?? null;
}

async function openMember(page, name) {
  await page.goto(`${BASE}/admin?tab=members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.fill("input[aria-label]", name);
  await page.waitForTimeout(900);
  const first = page.locator("ul li button").first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(900);
  }
}

const TABS = ["today", "members", "timetable", "notices", "pricing", "analytics"];

async function captureAll(browser) {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const locale of ["en", "el"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1400, height: 1100 },
      deviceScaleFactor: 1.4,
    });
    await ctx.addCookies([
      { name: "rg_locale", value: locale, url: BASE },
    ]);
    const page = await ctx.newPage();

    /* The door, before anybody is signed in. */
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await shotTop(page, "form", `fig-owner-${locale}-signin`, 620);

    const fixtures = await makeFixtures(page);

    /* The code screen, still signed in as the member who just registered. */
    await page.goto(`${BASE}/verify`, { waitUntil: "networkidle" });
    await shotTop(page, "[data-verify-card]", `fig-${locale}-verify`, 820);
    await api(page, "/api/auth/logout");
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "rg_locale", value: locale, url: BASE }]);

    /* Confirm one of them the way a member would, so the member figure has a
       balance on it. The other stays unconfirmed on purpose. */
    await api(page, "/api/auth/login", OWNER);
    await api(page, "/api/admin/unlock", { password: OWNER.password });

    /* One of the two is confirmed, so the member figure shows a balance and a
       payment; the other is left unconfirmed on purpose, for the amber flag and
       the blocked sell panel. The confirmation is written straight to the row by
       the same helper the test suites use, because this script cannot read the
       emailed code any more than they can. */
    markOnboarded(fixtures.member);
    if (markVerified(fixtures.member) !== 1) {
      throw new Error(`figure fixture ${fixtures.member} did not confirm`);
    }
    const memberId = await idOf(page, fixtures.member);
    if (memberId) {
      await api(page, "/api/admin/sessions", {
        userId: memberId,
        credits: 8,
        amountCents: 11000,
        method: "cash",
        note: "Manual figure",
      });

      /**
       * And one midday appointment, because the strip that announces them only
       * appears when there is something in it.
       *
       * A manual figure of an empty state teaches nothing, and this is the one
       * block on the desk that somebody has to act on. So the fixture buys a
       * duet at the counter and books the next free noon hour, which puts a real
       * row on the Bookings screen with a real name and a real partner on it.
       */
      await api(page, "/api/admin/sessions", {
        userId: memberId,
        credits: 1,
        amountCents: 4500,
        method: "cash",
        validityDays: 30,
        kind: "DUET",
        note: "Manual figure",
      });
      await bookAnAppointment(ctx, page, fixtures.member);
      /* And back behind the desk, with the language cookie the figures need. */
      await ctx.addCookies([{ name: "rg_locale", value: locale, url: BASE }]);
      await api(page, "/api/auth/login", OWNER);
      await api(page, "/api/admin/unlock", { password: OWNER.password });
    }

    for (const tab of TABS) {
      await page.goto(`${BASE}/admin?tab=${tab}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(tab === "notices" ? 900 : 600);
      await shotTop(page, "[data-desk-console]", `fig-owner-${locale}-${tab}`);
    }

    /* One member's page, and the two states worth a figure of their own. */
    await openMember(page, "Elena Georgiou");
    await shotTop(page, "[data-desk-console]", `fig-owner-${locale}-member`, 1300);

    await openMember(page, "Andreas Nicolaou");
    await shotTop(page, "[data-desk-console]", `fig-${locale}-unverified`, 700);
    await shotOf(page, '[data-desk-panel="erase"]', `fig-${locale}-erase`);

    await ctx.close();
  }
}

/* -------------------------------------------------- numbering and contents */

/**
 * Numbers the chapters and writes the contents page.
 *
 * Two passes over the source rather than two hand-maintained lists. The parts
 * are found by `section.partpage`, and every `section.chapter` after one belongs
 * to it, which is how a chapter inserted anywhere lands in the right list with
 * the right number and no edit anywhere else.
 */
function numberAndIndex(html) {
  const parts = [];
  let current = null;

  const re =
    /<section class="partpage"[^>]*>[\s\S]*?<h1>([^<]+)<\/h1>|<section class="chapter"[^>]*>\s*<h2>([^<]+)<\/h2>/g;

  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      current = { title: m[1].trim(), chapters: [] };
      parts.push(current);
    } else if (m[2] && current) {
      current.chapters.push(m[2].trim());
    }
  }

  /* Number the headings, part by part, in document order. */
  const counters = new Map();
  let partIndex = -1;
  let out = html.replace(
    /(<section class="partpage"[^>]*>)|(<section class="chapter"([^>]*)>\s*<h2>)([^<]+)(<\/h2>)/g,
    (all, partOpen, chapOpen, attrs, title, close) => {
      if (partOpen) {
        partIndex += 1;
        counters.set(partIndex, 0);
        return partOpen;
      }
      const n = (counters.get(partIndex) ?? 0) + 1;
      counters.set(partIndex, n);
      return `${chapOpen}${n} · ${title}${close}`;
    },
  );

  const list = (part) =>
    part.chapters
      .map(
        (t, i) =>
          `    <li><span class="n">${i + 1}</span><span class="t">${t}</span></li>`,
      )
      .join("\n");

  /* `lang` on the Greek label, and it is not decoration.
   *
   * Chromium uppercases Greek correctly only when it knows the text is Greek:
   * with the attribute, `text-transform: uppercase` drops the tonos the way Greek
   * typography requires, and without it the contents page reads "ΜΈΡΟΣ ΔΕΎΤΕΡΟ",
   * which is wrong in the way a Greek reader notices immediately. The chapters
   * themselves already carry it on their sections; this page is generated, so it
   * has to be added here. */
  const LABELS = [
    { text: "Part one", lang: "en" },
    { text: "Μέρος δεύτερο", lang: "el" },
  ];
  const toc = parts
    .map((p, i) => {
      const l = LABELS[i] ?? LABELS[0];
      return (
        `  <p class="part" lang="${l.lang}">${l.text}: ${p.title}</p>\n` +
        `  <ol lang="${l.lang}">\n${list(p)}\n  </ol>`
      );
    })
    .join("\n");

  out = out.replace(
    /(<h2>Contents · Περιεχόμενα<\/h2>)[\s\S]*?(<\/section>)/,
    `$1\n${toc}\n$2`,
  );

  console.log(
    `  contents: ${parts.map((p) => `${p.title} (${p.chapters.length})`).join(", ")}`,
  );
  return out;
}

/* ------------------------------------------------------------------- the pdf */

async function render(browser, html) {
  const built = join(OUT_DIR, "..", "built.html");
  writeFileSync(built, html, "utf8");

  const page = await browser.newPage();
  await page.goto(`file://${process.cwd()}/${built}`, {
    waitUntil: "networkidle",
  });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="width:100%;font-family:sans-serif;font-size:7pt;color:#8b7a72;' +
      'padding:0 18mm;display:flex;justify-content:space-between">' +
      "<span>RG Pilates Studio · The Reception Desk Manual</span>" +
      '<span class="pageNumber"></span></div>',
    margin: { top: "18mm", bottom: "20mm", left: "18mm", right: "18mm" },
  });
  await page.close();
}

/* ---------------------------------------------------------------------- main */

const skipShots = process.argv.includes("--no-figures");

const browser = await launch();
try {
  if (!skipShots) {
    console.log(`\nFigures, from ${BASE}`);
    await captureAll(browser);
  } else {
    console.log("\nFigures skipped, using whatever is in", OUT_DIR);
  }

  console.log("\nAssembling");
  if (!existsSync(SOURCE)) throw new Error(`${SOURCE} is missing`);
  const html = numberAndIndex(readFileSync(SOURCE, "utf8"));

  /* The figures sit beside the built file, so the src attributes in the source
     stay short and readable. */
  await render(browser, html.replace(/src="fig-/g, 'src="figures/fig-'));

  console.log(`\n  ${PDF}\n`);
} finally {
  await browser.close();
}
