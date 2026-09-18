/**
 * Builds the QR artwork: Instagram story, Instagram post, and a sheet to print
 * for the reception desk.
 *
 *     npm run qr                          the live site
 *     npm run qr -- https://rgpilatesstudio.com       a different address
 *
 * Everything lands in docs/qr/.
 *
 * ---
 *
 * **Why a script and not four finished files.**
 *
 * The address in the code *is* the artwork. The studio is on
 * `rgpilatesstudio.onrender.com` today and will be on its own domain the
 * week somebody buys one, and on that day every printed sheet and every saved
 * story becomes a code that goes nowhere. A QR is the one graphic that cannot be
 * quietly out of date, because nobody discovers a broken one until a member is
 * standing at the desk holding a phone.
 *
 * So the address is an argument, the design is source, and regenerating is one
 * command. Same reasoning as `scripts/manual.mjs`, which exists because the
 * hand-built version of the manual went stale the first time somebody moved a
 * button.
 *
 * ---
 *
 * **The code is dark on light, in every version, and that is not a style
 * choice.**
 *
 * An inverted QR — light modules on a dark ground — is legal in the spec and is
 * read by roughly *some* of the scanners in the world. Both phone cameras
 * usually manage it. A cheap barcode reader, an older Android, and a couple of
 * the QR apps people actually have installed do not, because they look for a
 * dark finder pattern and stop. On a poster at a reception desk that failure is
 * invisible to the studio and total for the member.
 *
 * So on the dark social artwork the code sits inside a cream card. That card is
 * also the quiet zone: the spec wants four clear modules around the symbol, and
 * a code run right up to the edge of a coloured panel is the other common way
 * these fail.
 *
 * ---
 *
 * **Social is brown, print is cream, deliberately.**
 *
 * The story and the post are `mocha-600` because they are seen on a phone
 * screen next to other people's posts, and the studio's brown is what makes them
 * recognisably RG at a thumb's flick.
 *
 * The reception sheet is the other way round: cream ground, brown ink. A4 of
 * solid brown is a genuinely expensive thing to print, it looks banded and
 * streaky on an office laser, and it goes wrong in a way you only find out about
 * after you have printed twenty. Cream ground costs almost nothing in toner and
 * looks better on paper.
 *
 * ---
 *
 * **Fonts are embedded, not asked for.**
 *
 * The faces come from `@fontsource/*` in node_modules and are inlined into the
 * page as base64. Nothing is fetched, so this works with no network, and more
 * importantly it renders identically on any machine — which for something that
 * goes to a printer is the whole point. Reaching for Google Fonts here would
 * mean the sheet quietly set itself in Times on any machine behind a proxy.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import QRCode from "qrcode";

const OUT = "docs/qr";

/** Where the code points. The share card, not the homepage. */
const target =
  process.argv[2] ??
  `${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://rgpilatesstudio.onrender.com").replace(/\/$/, "")}/link`;

/* The palette, from tailwind.config.ts. Written out rather than imported
   because this renders in a browser with no Tailwind in it. */
const C = {
  mocha600: "#3A3532",
  mocha800: "#2C2826",
  mocha900: "#161413",
  cream: "#F6F3F0",
  cream200: "#EDE8E4",
  mocha200: "#DFD8D3",
  clay: "#8F857D",
  taupe: "#857868",
};

/* ------------------------------------------------------------------ chromium */

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core").then(
      (m) => m.default ?? m,
    ));
  } catch {
    console.error("\n  ✗ playwright-core is not installed.\n");
    console.error("  It renders the artwork, and is not a dependency of the");
    console.error("  website. Install it just to build these:\n");
    console.error("      npm i -D playwright-core\n");
    console.error("  Same arrangement as npm run manual.\n");
    process.exit(1);
  }
  /* Point CHROMIUM_PATH at a binary, or let playwright find its own. On a
     machine with Chrome and no Chromium, `channel: "chrome"` uses that. */
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  try {
    return await chromium.launch({ executablePath });
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

/* --------------------------------------------------------------- ingredients */

/** A file from the repo as a data URI, so the page needs no server. */
async function dataUri(path, mime) {
  const buf = await readFile(path);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function font(pkg, file) {
  const p = `node_modules/@fontsource/${pkg}/files/${file}`;
  if (!existsSync(p)) {
    console.error(`\n  ✗ missing font: ${p}\n`);
    console.error("  Run npm install — @fontsource/jost and");
    console.error("  @fontsource/marcellus are devDependencies.\n");
    process.exit(1);
  }
  return dataUri(p, "font/woff2");
}

/**
 * The symbol itself, as SVG paths.
 *
 * Error correction `Q` recovers about a quarter of the symbol: chosen over the
 * default `M` because this gets printed, taped to a counter, and photographed
 * at an angle in bad light, and over `H` because that packs in more modules for
 * no benefit when nothing is overlaid on top.
 *
 * ---
 *
 * **The quiet zone, and the file that shipped without one.**
 *
 * `margin` defaults to 0 here because in the story, the post and the A4 sheet
 * the quiet zone is drawn by the cream card around the code, where it can be a
 * clean measured band rather than four modules of whatever the library felt
 * like. Those three are read back by a decoder at full size and shrunk to a
 * phone, and they scan.
 *
 * `rg-qr-plain.svg` had no card, so it had no quiet zone: the symbol ran to
 * the edge of its own viewBox. It looked perfect and **did not decode at all** —
 * not shrunk, not at 600 pixels, not once. Which is the worst possible shape for
 * this bug, because the plain SVG is the file somebody hands to a printer for a
 * flyer, and nobody discovers a QR that does not scan until the flyers are in a
 * box.
 *
 * The spec asks for four clear modules and it is not being fussy: a decoder
 * finds the symbol by looking for the boundary, and against an unknown
 * background there is no boundary to find. So the standalone file asks for
 * `margin: 4` and the embedded ones keep drawing their own.
 */
async function qrSvg(colour, margin = 0) {
  return QRCode.toString(target, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin,
    color: { dark: colour, light: "#0000" },
  });
}

/* ------------------------------------------------------------------ the page */

/**
 * `lang` is load-bearing, and the reason is not accessibility.
 *
 * All-caps Greek drops its accents. `ΣΚΑΝΑΡΕ`, not `ΣΚΆΝΑΡΕ` — this is settled
 * Greek typography, not a preference, and leaving the accents on is the sort of
 * thing a Greek reader sees before they see anything else on the sheet.
 *
 * Browsers know this and apply it to `text-transform: uppercase`, but only when
 * the element declares Greek. Rendered without `lang`, Chromium kept every
 * accent; with `lang="el"` it removed them. Checked, not assumed, because the
 * two strings look identical in a source file.
 *
 * The website has this right already through `<html lang={locale}>` in
 * `layout.tsx`. This artwork is rendered from its own HTML and had to be told.
 */
function shell({ css, body, width, height, lang = "en" }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${width}px;height:${height}px}
    body{-webkit-font-smoothing:antialiased;font-family:Jost,system-ui,sans-serif}
    .mono{background-color:currentColor;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
          -webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain}
    /* The marquee rail from the site, standing still. A moving band is the
       right thing on a web page and meaningless in a JPEG. */
    .rail{display:flex;align-items:center;justify-content:center;gap:var(--gap);
          background:${C.cream200};border-top:1px solid ${C.mocha200}88;
          border-bottom:1px solid ${C.mocha200}88;overflow:hidden;white-space:nowrap}
    .rail span{font-size:var(--fs);letter-spacing:0.32em;text-transform:uppercase;color:${C.clay}}
    .rail .mono{color:${C.clay}99;flex:none}
    ${css}
  </style></head><body>${body}</body></html>`;
}

/** One rail of phrases with the mark between them. */
function rail({ phrases, gap, fs, mark, pad }) {
  const items = phrases
    .map(
      (p) =>
        `<span>${p}</span><i class="mono" style="width:${mark}px;height:${mark}px;-webkit-mask-image:url('${MONO}');mask-image:url('${MONO}')"></i>`,
    )
    .join("");
  return `<div class="rail" style="--gap:${gap}px;--fs:${fs}px;padding:${pad}px 0">${items}</div>`;
}

let MONO = "";

/* --------------------------------------------------------------- the formats */

const COPY = {
  en: {
    scan: "Scan to book",
    sub: "Reformer Pilates Larnaca",
    cta: "Book a class, see the timetable, install the app",
  },
  el: {
    scan: "Σκάναρε για κράτηση",
    sub: "Reformer Pilates Λάρνακα",
    cta: "Κλείσε μάθημα, δες το πρόγραμμα, κατέβασε την εφαρμογή",
  },
};

const RAIL_TOP = [
  "Breathe. Align. Rise.",
  "Strength. Flexibility. Core.",
  "Embrace your uniqueness",
];
const RAIL_BOTTOM = [
  "Find your balance",
  "Own your strength",
  "Embrace your uniqueness",
];

/** Instagram story, 1080 x 1920. Rendered at half and scaled x2. */
function story({ qr, wordmarkCream, photo, t, fonts, lang }) {
  return shell({
    lang,
    width: 540,
    height: 960,
    css: `${fonts}
      body{background:${C.mocha600};display:flex;flex-direction:column}
      .photo{height:210px;background:url('${photo}') center/cover;position:relative;flex:none}
      /* The veil. The photograph is a real studio shot and it is doing a
         supporting job here: without it, the top of the story competes with
         the code for attention and wins. */
      .photo::after{content:"";position:absolute;inset:0;
        background:linear-gradient(to bottom,${C.mocha600}55,${C.mocha600})}
      .body{flex:1;display:flex;flex-direction:column;align-items:center;
            justify-content:center;padding:0 46px;gap:26px;margin-top:-40px}
      .wm{width:196px;height:auto}
      .sub{font-family:Marcellus,Georgia,serif;font-size:19px;letter-spacing:0.04em;color:${C.cream}e6}
      .card{background:${C.cream};border-radius:22px;padding:22px}
      .card svg{display:block;width:250px;height:250px}
      .scan{font-size:12.5px;letter-spacing:0.3em;text-transform:uppercase;color:${C.cream}}
      .url{font-size:10.5px;letter-spacing:0.12em;color:${C.cream}80}
    `,
    body: `
      ${rail({ phrases: RAIL_TOP, gap: 17, fs: 8.5, mark: 11, pad: 11 })}
      <div class="photo"></div>
      <div class="body">
        <img class="wm" src="${wordmarkCream}" alt="">
        <div class="sub">${t.sub}</div>
        <div class="card">${qr}</div>
        <div class="scan">${t.scan}</div>
        <div class="url">${target.replace(/^https?:\/\//, "")}</div>
      </div>
      ${rail({ phrases: RAIL_BOTTOM, gap: 17, fs: 8.5, mark: 11, pad: 11 })}
    `,
  });
}

/** Instagram post, 1080 x 1080. */
function post({ qr, wordmarkCream, t, fonts, lang }) {
  return shell({
    lang,
    width: 540,
    height: 540,
    css: `${fonts}
      body{background:${C.mocha600};display:flex;flex-direction:column}
      .body{flex:1;display:flex;align-items:center;justify-content:center;gap:38px;padding:0 46px}
      .left{display:flex;flex-direction:column;gap:18px;align-items:flex-start}
      .wm{width:186px;height:auto}
      .sub{font-family:Marcellus,Georgia,serif;font-size:20px;color:${C.cream}e6}
      .scan{font-size:12px;letter-spacing:0.3em;text-transform:uppercase;color:${C.cream}}
      .url{font-size:10px;letter-spacing:0.1em;color:${C.cream}80}
      .card{background:${C.cream};border-radius:20px;padding:20px;flex:none}
      .card svg{display:block;width:196px;height:196px}
    `,
    /* Side by side rather than stacked: a square stacked the way the story is
       leaves the code small enough that somebody scanning from across a room
       has to walk towards their own phone. */
    body: `
      ${rail({ phrases: RAIL_TOP, gap: 18, fs: 8, mark: 10, pad: 10 })}
      <div class="body">
        <div class="left">
          <img class="wm" src="${wordmarkCream}" alt="">
          <div class="sub">${t.sub}</div>
          <div class="scan">${t.scan}</div>
          <div class="url">${target.replace(/^https?:\/\//, "")}</div>
        </div>
        <div class="card">${qr}</div>
      </div>
      ${rail({ phrases: RAIL_BOTTOM, gap: 24, fs: 8, mark: 10, pad: 10 })}
    `,
  });
}

/**
 * The reception sheet, A4.
 *
 * Cream ground and a big code. Bilingual on one sheet rather than two, because
 * one sheet is what fits in the frame on the counter, and both lines of a
 * two-line instruction are read by everybody regardless.
 */
function poster({ qr, wordmarkBrown, fonts }) {
  return shell({
    width: 794,
    height: 1123,
    css: `${fonts}
      body{background:${C.cream};display:flex;flex-direction:column}
      .body{flex:1;display:flex;flex-direction:column;align-items:center;
            justify-content:center;gap:34px;padding:0 70px}
      .wm{width:290px;height:auto}
      .sub{font-family:Marcellus,Georgia,serif;font-size:30px;color:${C.taupe}}
      /* No cream card here: the ground already is the light side of the code,
         so the quiet zone is plain margin. */
      .card{padding:8px}
      .card svg{display:block;width:340px;height:340px}
      .scan{font-size:15px;letter-spacing:0.3em;text-transform:uppercase;color:${C.mocha800}}
      .scan-el{font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:${C.clay}}
      .url{font-size:12px;letter-spacing:0.1em;color:${C.clay}}
      .foot{display:flex;flex-direction:column;align-items:center;gap:5px;
            font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.clay}}
      .rail span{color:${C.clay}}
    `,
    body: `
      ${rail({ phrases: RAIL_TOP, gap: 34, fs: 10, mark: 14, pad: 15 })}
      <div class="body">
        <img class="wm" src="${wordmarkBrown}" alt="">
        <div class="sub">${COPY.en.sub}</div>
        <div class="card">${qr}</div>
        <div class="scan">${COPY.en.scan}</div>
        <div class="scan-el">${COPY.el.scan}</div>
        <div class="url">${target.replace(/^https?:\/\//, "")}</div>
      </div>
      <div class="foot" style="padding-bottom:26px">
        <div>Grigori Afxentiou 9, Livadia, Larnaca</div>
      </div>
      ${rail({ phrases: RAIL_BOTTOM, gap: 34, fs: 10, mark: 14, pad: 15 })}
    `,
  });
}

/* ---------------------------------------------------------------------- run */

const jost300 = await font("jost", "jost-latin-300-normal.woff2");
const jost400 = await font("jost", "jost-latin-400-normal.woff2");
const marcellus = await font("marcellus", "marcellus-latin-400-normal.woff2");
const fonts = `
  @font-face{font-family:Jost;font-weight:300;src:url('${jost300}') format('woff2')}
  @font-face{font-family:Jost;font-weight:400;src:url('${jost400}') format('woff2')}
  @font-face{font-family:Marcellus;font-weight:400;src:url('${marcellus}') format('woff2')}
`;

MONO = await dataUri("public/brand/monogram.svg", "image/svg+xml");
const wordmarkCream = await dataUri(
  "public/brand/wordmark-cream.png",
  "image/png",
);
const wordmarkBrown = await dataUri(
  "public/brand/wordmark-brown.png",
  "image/png",
);
const photo = await dataUri("public/media/class.jpg", "image/jpeg");

const qrLight = await qrSvg(C.mocha800); // on cream
const qrDark = await qrSvg(C.mocha800); // same ink; the card behind it is cream

await mkdir(OUT, { recursive: true });

const browser = await launch();
const made = [];

/**
 * A rail wider than the frame is clipped, and on a still image that looks like
 * a mistake rather than a design.
 *
 * On the web the rails scroll, so a phrase entering half-cut is the whole point.
 * Frozen into a JPEG, `IND YOUR BALANCE` at the left edge just reads as broken
 * text. The first story came out exactly like that.
 *
 * So the fit is measured rather than eyeballed, and it complains here instead of
 * on Instagram. Anybody changing the phrases later gets told the moment they do
 * it, which is the only time the warning is any use.
 */
const warnings = [];
async function checkRails(page, where) {
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll(".rail")]
      .map((r, i) => ({ i, over: r.scrollWidth - r.clientWidth }))
      .filter((x) => x.over > 1),
  );
  for (const { i, over } of clipped) {
    warnings.push(
      `${where}: rail ${i + 1} overflows by ${over}px and will clip mid-word`,
    );
  }
}

async function shot(name, html, width, height) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  await page.setContent(html, { waitUntil: "load" });
  /* Fonts are inlined, so there is nothing to wait on the network for — but
     the face still has to be parsed and laid out before the first paint is
     right, and without this the letterspaced caps come out in the fallback. */
  await page.evaluate(() => document.fonts.ready);
  await checkRails(page, name);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, type: "png" });
  await page.close();
  made.push([`${name}.png`, `${width * 2} x ${height * 2}`]);
}

for (const [loc, t] of Object.entries(COPY)) {
  await shot(
    `rg-qr-story-${loc}`,
    story({ qr: qrDark, wordmarkCream, photo, t, fonts, lang: loc }),
    540,
    960,
  );
  await shot(
    `rg-qr-post-${loc}`,
    post({ qr: qrDark, wordmarkCream, t, fonts, lang: loc }),
    540,
    540,
  );
}

/* The printable one goes out as PDF: vector text, real A4, and no question
   about what resolution somebody's printer wanted. */
{
  const page = await browser.newPage({
    viewport: { width: 794, height: 1123 },
  });
  await page.setContent(poster({ qr: qrLight, wordmarkBrown, fonts }), {
    waitUntil: "load",
  });
  await page.evaluate(() => document.fonts.ready);
  await checkRails(page, "reception-a4");
  await page.pdf({
    path: `${OUT}/rg-qr-reception-a4.pdf`,
    format: "A4",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await page.close();
  made.push(["rg-qr-reception-a4.pdf", "A4, vector"]);
}

/**
 * And the symbol on its own.
 *
 * Because somebody will want it in a flyer, a window sticker or a WhatsApp
 * message, and the alternative is cropping it out of the story artwork and
 * losing the quiet zone doing it. SVG so it can go on a bus if it needs to.
 *
 * `margin: 4` rather than the 0 the embedded ones use: this file has no card
 * around it to supply the quiet zone, and without one it does not decode. See
 * the note on `qrSvg`. The cream background is painted inside the viewBox so
 * the zone is cream and not whatever the flyer happens to be.
 */
/**
 * Two of them: the studio's ink, and plain black on white.
 *
 * The brand pair is mocha on cream and it is the one to use on anything the
 * studio controls. The black one exists because a flyer is usually not one of
 * those things. It goes to a print shop, gets laid over a photograph, is
 * photocopied, or is dropped into somebody else's template, and every one of
 * those is a place where #2C2826 on #F6F3F0 quietly loses contrast while
 * looking fine on the screen it was approved on.
 *
 * Pure black on pure white is the maximum contrast a printer can produce and
 * the one combination no press, no photocopier and no scanner has ever
 * struggled with. Handing over both means nobody has to decide whether the
 * brown is dark enough, which is not a judgement to leave to a print run.
 */
const PLAIN = [
  ["rg-qr-plain", C.mocha800, C.cream, "studio ink on cream"],
  ["rg-qr-plain-bw", "#000000", "#FFFFFF", "black on white, for print"],
];

for (const [name, ink, ground, note] of PLAIN) {
  const svg = (await qrSvg(ink, 4)).replace(
    "<svg ",
    `<svg style="background:${ground}" `,
  );
  await writeFile(`${OUT}/${name}.svg`, svg);
  made.push([`${name}.svg`, `vector, any size, ${note}`]);

  /**
   * And a PNG of each, because SVG is the right format and not always the
   * accepted one. Word, WhatsApp, older Canva templates and most print shop
   * upload forms take a PNG and argue about anything else. 2000px so it can
   * be placed at 160mm on a poster and still be at 300dpi.
   */
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 });
  await page.setContent(
    `<body style="margin:0;background:${ground}">${svg.replace(
      "<svg ",
      '<svg width="1000" height="1000" ',
    )}</body>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: `${OUT}/${name}.png`, type: "png" });
  await page.close();
  made.push([`${name}.png`, `2000 x 2000, ${note}`]);
}

await browser.close();

console.log(`\n  \x1b[1mQR artwork\x1b[0m\n`);
console.log(`  points at   ${target}`);
console.log(
  `  correction  Q  \x1b[2m(recovers ~25% of a damaged symbol)\x1b[0m\n`,
);
const w = Math.max(...made.map(([n]) => n.length));
for (const [name, size] of made) {
  console.log(`  ${name.padEnd(w)}  \x1b[2m${size}\x1b[0m`);
}
if (warnings.length) {
  console.log(
    `\n  \x1b[33m!\x1b[0m ${warnings.length} layout warning${warnings.length === 1 ? "" : "s"}\n`,
  );
  for (const w of warnings) console.log(`    ${w}`);
}
console.log(`\n  in ${OUT}/\n`);
console.log(
  `  \x1b[2mIf the address changes, run this again with the new one:\x1b[0m`,
);
console.log(`  \x1b[2mnpm run qr -- https://your-domain.cy/link\x1b[0m\n`);
