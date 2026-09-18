/**
 * Catch Tailwind classes that silently produce no CSS.
 *
 *   npm run build && node scripts/check-classes.mjs
 *
 * The specific trap this exists for: Tailwind's colour-opacity shorthand only
 * accepts values from its opacity scale, so `border-cream/12` compiles to
 * nothing at all — no warning, no error. The border simply falls back to the
 * default colour and looks close enough to plausible that it survives review.
 * (`border-cream/[0.12]` is the way to ask for twelve percent.)
 *
 * This reads the built stylesheets, collects every `utility/opacity` class used
 * in src, and reports any that never made it into the CSS. Variants and
 * combinator-based selectors are handled, so `hover:border-cream/60` and
 * `divide-mocha-200/70` are not reported as missing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const cssDir = ".next/static/css";
let css = "";
try {
  css = readdirSync(cssDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(join(cssDir, f), "utf8"))
    .join("\n");
} catch {
  console.error("No built CSS found. Run `npm run build` first.");
  process.exit(1);
}

const PREFIXES =
  "bg|text|border|ring|ring-offset|from|via|to|divide|decoration|outline|shadow|fill|stroke|placeholder|accent|caret";
const pattern = new RegExp(
  `\\b((?:${PREFIXES})-[a-z]+(?:-\\d{2,3})?)/(\\d{1,3})\\b`,
  "g",
);

const used = new Map();
for (const file of walk("src")) {
  if (!/\.(tsx?|mdx)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(pattern)) {
    const cls = `${m[1]}/${m[2]}`;
    if (!used.has(cls)) used.set(cls, new Set());
    used.get(cls).add(file);
  }
}

/* Escaped as Tailwind writes it in the selector, then matched anywhere after a
   dot so `hover:` prefixes and `> :not(...)` suffixes both still count. */
const escaped = (cls) => cls.replace(/[/:[\].]/g, (c) => "\\" + c);

const missing = [];
for (const [cls, files] of [...used].sort()) {
  if (!css.includes(escaped(cls))) missing.push([cls, [...files].sort()]);
}

console.log(
  `\n${used.size} colour-opacity classes used across src; ${missing.length} produce no CSS\n`,
);
for (const [cls, files] of missing) {
  console.log(`  ✗ ${cls}`);
  for (const f of files) console.log(`      ${f}`);
}
if (missing.length) {
  console.log(
    "\nUse bracket syntax for values outside Tailwind's opacity scale, " +
      "e.g. border-cream/[0.12].\n",
  );
  process.exit(1);
}
console.log("  ✓ every one of them compiles\n");
