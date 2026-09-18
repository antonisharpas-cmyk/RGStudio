/**
 * `next dev`, with every page compiled before you click on it.
 *
 * Why this exists: in development Next compiles each route the first time it is
 * asked for, and not before. That is why the site feels slow until you have
 * been everywhere once and instant afterwards — the first visit to a page is
 * paying for its compile, and the second is not. Measured on this project:
 *
 *     /            first 7.9s   after 0.4s
 *     /contact     first 2.2s   after 0.1s
 *     /studio      first 2.0s   after 0.1s
 *
 * A production build has none of this. The same pages served by
 * `npm run build && npm start` answer in 10 to 36 milliseconds, cold, every
 * time. Nobody visiting the real site will ever see what you are seeing.
 *
 * So this walks the routes once at startup, quietly, while you are still
 * reaching for the browser. One wait at the beginning instead of a stall on
 * every first click.
 *
 * It is strictly best effort: if anything here fails it says so and gets out of
 * the way. The dev server is a child process and is never interfered with.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/* Worth compiling up front: everything a person clicks through while working on
   the site. Order roughly matches how often you land on them. */
const ROUTES = [
  "/",
  "/timetable",
  "/pricing",
  "/classes",
  "/studio",
  "/contact",
  "/account",
  "/checkout?pack=month-2",
  "/login",
  "/register",
  "/terms",
  "/privacy",
];

/* Spawning the binary through node rather than through a shell keeps this
   working the same way on Windows, macOS and Linux. */
const bin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [bin, "dev", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "inherit"],
  env: process.env,
});

let started = false;

child.stdout.on("data", (buf) => {
  const text = buf.toString();
  process.stdout.write(text);
  if (started) return;
  const found = text.match(/Local:\s+(https?:\/\/\S+)/);
  if (found) {
    started = true;
    warm(found[1].replace(/\/+$/, "")).catch(() => {});
  }
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

/* Ctrl+C should stop the server, not orphan it. */
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}

async function warm(base) {
  const started = Date.now();
  let done = 0;

  for (const route of ROUTES) {
    /* Two attempts: the first request can arrive before the server is
       listening, which is not a failure, just early. */
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fetch(base + route, { redirect: "manual" });
        done++;
        break;
      } catch {
        await pause(700);
      }
    }
  }

  if (done === 0) return; /* nothing to boast about; stay quiet */

  console.log(
    `\n   ▲ ${done} pages compiled in ${((Date.now() - started) / 1000).toFixed(
      1,
    )}s — moving between them is instant from here.\n`,
  );
}

function pause(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
