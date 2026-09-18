import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/* Plain contexts. The home page used to open with a one-off logo animation that
   had to be marked as already seen before a screenshot could be taken of the
   page itself; it has been removed, and this wrapper is kept only because every
   shot below calls it. */
async function ctxOf(opts) {
  return browser.newContext(opts);
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "member@example.com");
  await page.fill("#password", "member123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/account|\/$/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/* ------------------------------------------------ desktop, three window heights */
for (const [w, h] of [
  [1440, 800],
  [1440, 620],
  [1024, 700],
]) {
  const ctx = await ctxOf({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/hero-${w}x${h}.png` });

  /* geometry check: does the lockup touch the headline? */
  const box = await page.evaluate(() => {
    const mark = document.querySelector("header img");
    const kicker = document.querySelector("h1 span");
    const m = mark?.getBoundingClientRect();
    const k = kicker?.getBoundingClientRect();
    return { markBottom: m?.bottom, headlineTop: k?.top };
  });
  console.log(
    `${w}x${h}  lockup bottom ${Math.round(box.markBottom)}  headline top ${Math.round(
      box.headlineTop,
    )}  clearance ${Math.round(box.headlineTop - box.markBottom)}px`,
  );
  await ctx.close();
}

/* -------------------------------------------------------- home intro, arch gap */
{
  const ctx = await ctxOf({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.15));
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/intro.png` });
  await ctx.close();
}

/* ------------------------------------------------------------- classes: team */
{
  const ctx = await ctxOf({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/classes`, { waitUntil: "networkidle" });
  const head = page.getByText("Meet our Pilates Instructors.");
  await head.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/team.png` });
  console.log("team heading present:", await head.count());
  await ctx.close();
}

/* -------------------------------------- account: chip menu, order, deep links */
{
  const ctx = await ctxOf({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await login(page);
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/account-top.png` });

  await page.click('header button[aria-haspopup="menu"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/account-menu.png` });

  await page.click('header [role="menu"] a:has-text("Payments")');
  await page.waitForTimeout(2000);
  console.log("after menu click, url:", page.url());
  await page.screenshot({ path: `${OUT}/account-payments.png` });

  const order = await page.evaluate(() => {
    const tabs = document.getElementById("account-sections");
    const heads = [...document.querySelectorAll("h2")].map((h) => ({
      text: h.textContent.trim().slice(0, 30),
      top: Math.round(h.getBoundingClientRect().top + window.scrollY),
    }));
    return {
      tabsTop: Math.round(tabs.getBoundingClientRect().top + window.scrollY),
      heads,
    };
  });
  console.log("order:", JSON.stringify(order));
  console.log("console errors:", errors.length ? errors : "none");
  await ctx.close();
}

/* --------------------------------------------------------------------- mobile */
{
  const ctx = await ctxOf({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await login(page);

  await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/m-contact.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/m-contact-fold.png` });

  const contactOrder = await page.evaluate(() => {
    const y = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
    return {
      heading: y(document.querySelector("main h2, h2")),
      introCopy: y(
        [...document.querySelectorAll("p")].find((p) =>
          p.textContent.includes("Questions about levels"),
        ) ?? document.body,
      ),
      form: y(document.querySelector("form")),
      details: y(
        [...document.querySelectorAll("p")].find((p) =>
          /find us|hours|follow/i.test(p.textContent),
        ) ?? document.body,
      ),
    };
  });
  console.log("mobile contact order:", JSON.stringify(contactOrder));

  /* tapping the current page in the sheet */
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(400);
  await page.click("header button[aria-label]:not([aria-haspopup])");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/m-sheet.png` });
  await page.click('.sheet a:has-text("Contact")');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    sheetOpen: document.querySelector(".sheet").classList.contains("is-open"),
  }));
  console.log("after tapping Contact while on /contact:", JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/m-after-retap.png` });

  /* the chip */
  await page.goto(`${BASE}/timetable`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/m-header-chip.png`, clip: { x: 0, y: 0, width: 390, height: 110 } });
  await page.click('header button[aria-haspopup="menu"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/m-chip-menu.png` });

  /* account tabs on a phone */
  await page.goto(`${BASE}/account?tab=activity`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/m-account-activity.png` });
  await ctx.close();
}

/* -------------------------------- 1024: does the six-item bar still fit? */
{
  const ctx = await ctxOf({ viewport: { width: 1024, height: 800 } });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${BASE}/timetable`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/bar-1024.png`, clip: { x: 0, y: 0, width: 1024, height: 120 } });
  const ctx2 = await ctxOf({ viewport: { width: 1024, height: 800 } });
  const guest = await ctx2.newPage();
  await guest.goto(`${BASE}/timetable`, { waitUntil: "networkidle" });
  await guest.waitForTimeout(1000);
  await guest.screenshot({ path: `${OUT}/bar-1024-guest.png`, clip: { x: 0, y: 0, width: 1024, height: 120 } });
  console.log("1024 guest bar:", JSON.stringify(await guest.evaluate(() => {
    const bar = document.querySelector("header > div");
    return { overflow: bar.scrollWidth > bar.clientWidth + 1, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1, barH: Math.round(bar.getBoundingClientRect().height) };
  })));
  await ctx2.close();
  const fits = await page.evaluate(() => {
    const bar = document.querySelector("header > div");
    return {
      scrollW: bar.scrollWidth,
      clientW: bar.clientWidth,
      overflow: bar.scrollWidth > bar.clientWidth + 1,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log("1024 bar:", JSON.stringify(fits));
  await ctx.close();
}

await browser.close();
console.log("done");
