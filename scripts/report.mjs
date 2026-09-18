/**
 * Writes report.txt: everything needed to diagnose "it does not work on my
 * machine", in one file, with no copying and pasting.
 *
 *     npm run report
 *
 * It records the versions, whether the dependencies are actually installed, the
 * full output of a production build, and the doctor's verdict. Secrets are never
 * written: for each key in .env it records only the name, whether it is set or
 * still a placeholder, and how long it is.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const out = [];
const say = (s = "") => out.push(s);

say("RG Pilates Studio — installation report");
say(new Date().toISOString());
say("");

/* ---------------------------------------------------------------- machine */
say("## Machine");
say(`node            ${process.version}`);
say(`platform        ${process.platform} ${process.arch} (${os.release()})`);
say(`cwd             ${process.cwd()}`);
const npm = spawnSync("npm", ["-v"], { encoding: "utf8", shell: true });
say(`npm             ${(npm.stdout ?? "").trim() || "could not read"}`);
say("");

/* ----------------------------------------------------------- dependencies */
say("## Dependencies");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const want = { ...pkg.dependencies, ...pkg.devDependencies };
const missing = [];
for (const name of Object.keys(want)) {
  const there = existsSync(join("node_modules", ...name.split("/")));
  if (!there) missing.push(name);
}
say(`declared        ${Object.keys(want).length}`);
say(
  missing.length
    ? `NOT INSTALLED   ${missing.join(", ")}   <-- run: npm install`
    : "installed       all of them",
);

/* better-sqlite3 is native, and the usual cause of a broken install. */
try {
  const dir = join("node_modules", "better-sqlite3", "build", "Release");
  const built = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".node"))
    : [];
  say(
    built.length
      ? `better-sqlite3  compiled (${built.join(", ")})`
      : "better-sqlite3  NO .node BINARY — the database driver did not build",
  );
} catch {
  say("better-sqlite3  could not be checked");
}
say("");

/* ------------------------------------------------------------------- .env */
say("## .env (names only, never values)");
if (!existsSync(".env")) {
  say("MISSING — run: npm run setup");
} else {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    const value = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    const state = !value
      ? "EMPTY"
      : /x{3,}|change-me/i.test(value)
        ? "placeholder"
        : "set";
    say(`${key.padEnd(38)} ${state.padEnd(12)} ${value.length} chars`);
  }
}
say("");

/* ------------------------------------------------------------------ build */
say("## Production build");
say("(this is the definitive answer on whether the code compiles here)");
say("");
let bin = null;
try {
  bin = require.resolve("next/dist/bin/next");
} catch {
  say("Next is not installed at all. Run: npm install");
}
if (bin) {
  const build = spawnSync(process.execPath, [bin, "build"], {
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    maxBuffer: 40 * 1024 * 1024,
  });
  const text = `${build.stdout ?? ""}${build.stderr ?? ""}`.trim();
  say(`exit code       ${build.status}`);
  say("");
  say(text || "(no output at all, which is itself unusual)");
  say("");
}

/* ----------------------------------------------------------------- doctor */
say("## Doctor");
if (existsSync(join("scripts", "doctor.mjs"))) {
  const doc = spawnSync(process.execPath, ["scripts/doctor.mjs"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  /* Strip the colour codes so the file stays readable. */
  say(
    `${doc.stdout ?? ""}${doc.stderr ?? ""}`
      // eslint-disable-next-line no-control-regex
      .replace(/\[[0-9;]*m/g, "")
      .trim(),
  );
}

const body = out.join("\n") + "\n";
writeFileSync("report.txt", body, "utf8");

console.log(
  `\n  Written to report.txt (${(body.length / 1024).toFixed(1)} kB).`,
);
console.log(
  "  Nothing secret is in it — send it over and it should be enough.\n",
);
