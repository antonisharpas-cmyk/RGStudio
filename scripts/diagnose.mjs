/**
 * Performance diagnostic for RG Pilates Studio.
 *
 *   node scripts/diagnose.mjs                      # against http://localhost:3000
 *   node scripts/diagnose.mjs http://localhost:3100
 *
 * Measures, for every route:
 *   TTFB      time to the first byte of HTML — server work: database + rendering
 *   Total     time until the whole HTML document has arrived
 *   HTML      size of the document
 *   JS        number and total size of the script chunks the page pulls in
 *
 * Then reports the slowest routes and flags anything over the thresholds.
 * Run it against a PRODUCTION build (`npm run build && npm start`) for numbers
 * that mean anything — `npm run dev` compiles each page on first request and is
 * several times slower by design.
 */
import { gzipSync } from "node:zlib";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const RUNS = Number(process.env.RUNS ?? 5);

const ROUTES = [
  ["/", "Home"],
  ["/studio", "Studio"],
  ["/classes", "Classes"],
  ["/timetable", "Timetable"],
  ["/pricing", "Pricing"],
  ["/contact", "Contact"],
  ["/login", "Sign in"],
  ["/privacy", "Privacy"],
  ["/api/sessions?days=14", "API: sessions (14d)"],
  ["/api/sessions?days=7", "API: sessions (7d)"],
];

/* Budgets are on TRANSFERRED (compressed) bytes — what the visitor waits for. */
const THRESHOLD = { ttfb: 200, total: 400, html: 120_000, js: 180_000 };

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const ms = (n) => `${n.toFixed(0)}ms`;
const kb = (n) => `${(n / 1024).toFixed(0)}kB`;
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function grade(value, limit) {
  if (value <= limit) return c.green(padL(ms(value), 8));
  if (value <= limit * 2.5) return c.amber(padL(ms(value), 8));
  return c.red(padL(ms(value), 8));
}

/** One timed request. Returns TTFB, total and the body. */
async function timed(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { "user-agent": "rg-diagnose" } });
  const reader = res.body.getReader();
  let ttfb = null;
  let bytes = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (ttfb === null) ttfb = performance.now() - t0;
    if (done) break;
    bytes += value.byteLength;
    chunks.push(value);
  }
  const total = performance.now() - t0;
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  return { ttfb, total, bytes, status: res.status, body };
}

/**
 * The script chunks a MODERN browser actually downloads.
 * Scripts marked `noModule` are the legacy polyfill bundle — around 110kB that
 * only ancient browsers fetch — so counting them overstates the real payload.
 */
function scriptsIn(html) {
  const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const modern = tags.filter((tag) => !/\bnomodule\b/i.test(tag));
  const srcs = modern
    .map((tag) => tag.match(/src="(\/_next\/static\/[^"]+\.js)"/)?.[1])
    .filter(Boolean);
  return [...new Set(srcs)];
}

/**
 * Transferred size, i.e. compressed — that is what costs the visitor time.
 * Next.js compresses responses, so we ask for it explicitly.
 */
async function sizeOf(paths) {
  let wire = 0;
  let raw = 0;
  await Promise.all(
    paths.map(async (p) => {
      try {
        const res = await fetch(BASE + p, {
          headers: { "accept-encoding": "gzip, deflate, br" },
        });
        const buf = Buffer.from(await res.arrayBuffer());
        raw += buf.byteLength;
        const len = Number(res.headers.get("content-length"));
        /* fetch transparently decompresses, so prefer the advertised length */
        wire += Number.isFinite(len) && len > 0 ? len : gzipSize(buf);
      } catch {}
    }),
  );
  return { wire, raw };
}

function gzipSize(buf) {
  try {
    return gzipSync(buf).byteLength;
  } catch {
    return buf.byteLength;
  }
}

async function main() {
  console.log(`\n${c.bold("RG Pilates Studio — performance diagnostic")}`);
  console.log(c.dim(`target ${BASE} · ${RUNS} runs per route · ${new Date().toISOString()}`));

  /* is anything there? */
  try {
    await fetch(BASE + "/", { signal: AbortSignal.timeout(8000) });
  } catch {
    console.log(
      c.red(`\n✗ Nothing responding at ${BASE}. Start the server first:\n`) +
        c.dim("   npm run build && npm start          (production — use this)\n") +
        c.dim("   npm run dev                          (development — slower)\n"),
    );
    process.exit(1);
  }

  const mode = await detectMode();
  console.log(c.dim(`mode: ${mode}\n`));

  console.log(
    c.dim(
      `${pad("route", 24)}${padL("TTFB", 8)}${padL("median", 9)}${padL("worst", 9)}${padL("HTML", 8)}${padL("JS wire", 9)}${padL("JS raw", 9)}  chunks`,
    ),
  );
  console.log(c.dim("─".repeat(86)));

  const results = [];

  for (const [path, label] of ROUTES) {
    const url = BASE + path;
    /* warm-up so we measure steady state, not first-hit compilation */
    const warm = await timed(url);
    const samples = [];
    for (let i = 0; i < RUNS; i++) samples.push(await timed(url));

    const ttfbs = samples.map((s) => s.ttfb).sort((a, b) => a - b);
    const totals = samples.map((s) => s.total).sort((a, b) => a - b);
    const median = totals[Math.floor(totals.length / 2)];
    const chunks = scriptsIn(warm.body);
    const js = chunks.length ? await sizeOf(chunks) : { wire: 0, raw: 0 };

    const row = {
      path,
      label,
      status: warm.status,
      ttfb: ttfbs[Math.floor(ttfbs.length / 2)],
      median,
      worst: totals[totals.length - 1],
      cold: warm.total,
      html: warm.bytes,
      js: js.wire,
      jsRaw: js.raw,
      chunks: chunks.length,
    };
    results.push(row);

    console.log(
      pad(label, 24) +
        grade(row.ttfb, THRESHOLD.ttfb) +
        grade(row.median, THRESHOLD.total).padStart(9) +
        padL(ms(row.worst), 9) +
        padL(kb(row.html), 8) +
        padL(row.js ? kb(row.js) : "—", 9) +
        padL(row.jsRaw ? kb(row.jsRaw) : "—", 9) +
        `  ${row.chunks || "—"}`,
    );
  }

  /* ---------------------------------------------------------------- summary */

  console.log(`\n${c.bold("Slowest routes")}`);
  [...results]
    .sort((a, b) => b.median - a.median)
    .slice(0, 3)
    .forEach((r, i) =>
      console.log(
        `  ${i + 1}. ${pad(r.label, 22)} ${ms(r.median)} total, ${ms(r.ttfb)} of it server-side`,
      ),
    );

  const findings = [];
  for (const r of results) {
    if (r.ttfb > THRESHOLD.ttfb)
      findings.push(
        `${r.label}: ${ms(r.ttfb)} TTFB — server work (database queries or rendering) is the bottleneck`,
      );
    if (r.html > THRESHOLD.html)
      findings.push(
        `${r.label}: ${kb(r.html)} of HTML — a lot of data is being embedded in the page`,
      );
    if (r.js > THRESHOLD.js)
      findings.push(
        `${r.label}: ${kb(r.js)} of JavaScript over the wire across ${r.chunks} chunks — heavy client bundle`,
      );
  }

  const cold = results.filter((r) => r.cold > r.median * 3);
  if (cold.length && mode.includes("development")) {
    findings.push(
      `First hit on ${cold.length} route(s) was 3x+ slower than steady state — that is dev-mode on-demand compilation, not a real problem.`,
    );
  }

  console.log(`\n${c.bold("Findings")}`);
  if (findings.length === 0) {
    console.log(c.green("  Nothing over threshold. Everything is inside budget."));
  } else {
    findings.forEach((f) => console.log(`  ${c.amber("•")} ${f}`));
  }

  if (mode.includes("development")) {
    console.log(
      `\n${c.cyan("Note")} these numbers are from a development build. Next.js compiles pages\n` +
        `     on demand, ships unminified code and double-renders React. Re-run against\n` +
        `     ${c.bold("npm run build && npm start")} before drawing conclusions.`,
    );
  }

  console.log(
    `\n${c.dim("Budgets: TTFB <200ms · total <400ms · HTML <120kB · JS <180kB transferred")}`,
  );
  console.log(
    c.dim(
      "JS wire = compressed bytes a modern browser downloads. JS raw = uncompressed,\n" +
        "excluding the legacy polyfill bundle that only old browsers fetch.\n",
    ),
  );
}

async function detectMode() {
  try {
    const res = await fetch(BASE + "/");
    const html = await res.text();
    /* dev builds serve webpack-hmr and unhashed chunk names */
    if (html.includes("webpack-hmr") || html.includes("react-refresh")) {
      return "development (npm run dev)";
    }
    return "production (npm start)";
  } catch {
    return "unknown";
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
