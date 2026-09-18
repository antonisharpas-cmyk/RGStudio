#!/usr/bin/env node
/**
 * The production start command. This IS `npm start`, on purpose: a hosting
 * provider's default start command is `npm start`, and a deploy that only works
 * when somebody remembers to change a field in a dashboard is a deploy that
 * breaks. `npm run start:next` is the raw `next start` underneath, and
 * `npm run start:render` is a spelled-out alias of this script.
 *
 * Why this exists instead of plain `next start`.
 *
 * The database is a file on a persistent disk, and a host mounts that disk at
 * runtime only — not during the build, and not during a pre-deploy step, which
 * run on separate compute. So nothing that touches the database can live in the
 * build, however convenient that would be.
 *
 * That matters because the first boot on a new disk finds no file at all, and
 * `ensureSchema()` deliberately does nothing to a database with no `users`
 * table: it is a migrator, not a creator, and refusing to guess at a database
 * that does not exist yet is the right behaviour for it. Without this script the
 * first deploy goes green and every page on the website is a 500 reading
 * "no such table: users", which is a confusing way to find out.
 *
 * So: build the schema and seed the catalogue once, on the first boot only, then
 * hand over to `next start`. Every boot after that finds the table and drops
 * straight through, which is why this is safe as the permanent start command
 * rather than something to run by hand and remember.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const file = (process.env.DATABASE_URL ?? "file:./dev.db").replace(
  /^file:/,
  "",
);

/**
 * Is there a database here, or only a mount point?
 *
 * `users` is the very table `ensureSchema` looks for, so this asks exactly the
 * question the app is about to ask. Opening the handle creates an empty file if
 * there is none, which is harmless and is what drizzle-kit would do anyway.
 */
function needsBuilding() {
  const conn = new Database(file);
  try {
    return !conn
      .prepare(
        "select name from sqlite_master where type = 'table' and name = 'users'",
      )
      .get();
  } finally {
    conn.close();
  }
}

function run(label, args) {
  console.log(`[boot] ${label}`);
  const res = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.error(
      `[boot] ${label} failed. Not starting: a half-built database is worse than a failed deploy, because the deploy would go green.`,
    );
    process.exit(res.status ?? 1);
  }
}

/**
 * Two refusals, and only on a hosted service.
 *
 * `RENDER` is set by the platform, so this is silent on a developer's machine
 * where `npm start` should just start. On the host it is the last point at which
 * either mistake can still be caught, and both are mistakes that a green deploy
 * would hide until it was too late to fix cleanly.
 */
const hosted = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);

function refuse(what, lines) {
  console.error(`\n[boot] REFUSING TO START: ${what}\n`);
  for (const l of lines) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
}

if (hosted && !process.env.DATABASE_URL) {
  /* Without this the database is a file in the container's own filesystem, which
     the platform rebuilds on every deploy. The site would work perfectly and
     then lose every member, booking, payment and ledger line the next time
     anybody pushed a commit — silently, and with no copy anywhere. */
  refuse("DATABASE_URL is not set, so the database would not be on the disk.", [
    "Everything the studio owns lives in one SQLite file. Unset, that file goes",
    "into temporary storage and is deleted on the next deploy.",
    "",
    "Attach a persistent disk (mount path /var/data), then set:",
    "",
    "    DATABASE_URL = file:/var/data/rg.db",
  ]);
}

/**
 * The directory the file goes in.
 *
 * On a first run anywhere it may simply not be there yet, and making it is the
 * right answer. On a hosted service there is a second possibility that looks
 * identical from here and is not the same thing at all: the directory is a disk
 * mount point and the disk is not attached. The container runs as an ordinary
 * user, so creating it fails with EACCES — which used to arrive as a stack trace
 * from inside node:fs naming a line of this file, which tells you nothing about
 * what to go and do.
 */
const dir = dirname(file);
if (dir && dir !== "." && !existsSync(dir)) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    refuse(`${dir} does not exist and cannot be created (${e.code}).`, [
      `The database is meant to live at ${file}, and there is nothing at ${dir}.`,
      "",
      "On a hosted service this means the persistent disk is not attached. The",
      "path is a mount point, not an ordinary folder: the service cannot create",
      "it, only the platform can, by mounting a disk there.",
      "",
      "Render: your service, then Disks in the sidebar, then Add Disk.",
      "",
      "    Name         rg-data",
      `    Mount Path   ${dir}`,
      "    Size         1 GB",
      "",
      "Adding it starts a new deploy by itself. Nothing else needs changing.",
    ]);
  }
}

/**
 * The signing key for session cookies.
 *
 * `lib/auth.ts` throws if this is missing or shorter than sixteen characters,
 * and that throw lands in the middle of registering: the account row is already
 * written when the cookie is signed, so the member gets a 500, the row survives,
 * and every retry from then on says "that email is already registered". Two
 * different-looking bugs, one cause, and neither of them mentions AUTH_SECRET.
 *
 * Nobody can sign in or register without it, so there is nothing this service
 * can usefully do without one. Refusing here says so in one line.
 */
if (hosted && (process.env.AUTH_SECRET ?? "").length < 16) {
  refuse(
    process.env.AUTH_SECRET
      ? `AUTH_SECRET is only ${process.env.AUTH_SECRET.length} characters long.`
      : "AUTH_SECRET is not set.",
    [
      "It signs the session cookie, so without it nobody can register and nobody",
      "can sign in. It has to be at least 16 characters, and a placeholder is",
      "usually shorter than that.",
      "",
      "Set it to a long random string. On your own machine:",
      "",
      "    node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
      "",
      "Paste the result into the environment panel. It never goes in the repo.",
    ],
  );
}

if (
  hosted &&
  needsBuilding() &&
  !(process.env.SEED_OWNER_PASSWORD && process.env.SEED_RECEPTION_PASSWORD)
) {
  /* The seed's fallback passwords are written in src/db/seed.ts, which is in the
     repository. Creating the owner account with one of those on a public URL
     hands /admin, and every member's name, phone and history, to anybody who has
     read the source. This is the one moment it can be prevented: after the first
     boot the accounts exist and changing them is a separate errand. */
  refuse("the desk accounts would be created with the passwords from the source.", [
    "This is the first boot, so the owner and reception accounts are about to be",
    "created. src/db/seed.ts holds development passwords as a fallback, and that",
    "file is in the repository: anybody who can read it could open /admin.",
    "",
    "Set all four, then deploy again:",
    "",
    "    SEED_OWNER_EMAIL        the real owner address",
    "    SEED_OWNER_PASSWORD     a strong password",
    "    SEED_RECEPTION_EMAIL    the real reception address",
    "    SEED_RECEPTION_PASSWORD a strong password",
    "",
    "They are read once, here, and never again.",
  ]);
}

if (needsBuilding()) {
  console.log(`[boot] no database at ${file}. Building it for the first time.`);
  run("creating the schema", ["run", "db:push"]);
  run("seeding the catalogue, packs, timetable and desk accounts", [
    "run",
    "db:seed",
  ]);
  console.log(
    "[boot] database ready. Set the real desk passwords with `npm run staff` and replace the placeholder instructors.",
  );
} else {
  console.log(`[boot] database present at ${file}.`);
}

/**
 * Cap the JavaScript heap, because the container is smaller than Node thinks.
 *
 * Render runs this on a 512 MB instance, but Node does not see that limit — it
 * reads the *host* machine's memory and sizes its old-space heap for gigabytes.
 * So under load V8 lets the heap grow toward a ceiling that does not exist here,
 * sails past 512 MB, and the platform kills the instance and restarts it. That
 * is the memory-limit email, and it is not a leak: it is Node being generous
 * with memory it has not got.
 *
 * Telling it the real ceiling makes it collect garbage sooner and keep the heap
 * small. 384 MB leaves room for the parts that live outside the JS heap — the
 * image optimiser's native buffers and the SQLite library — inside the 512.
 * Only for the running site: the build runs on separate, larger compute and is
 * left alone, so this is set on the child rather than for the whole service.
 *
 * MEMORY_MB overrides it from the environment, so moving to a bigger instance is
 * one dashboard value and not a code change: set it to the new size and the cap
 * follows.
 *
 * Any heap size already in NODE_OPTIONS is *replaced*, not kept. A large value
 * inherited from the build step — where a bigger heap is wanted and the compute
 * is bigger too — is exactly what must not reach the running site, so the
 * runtime always gets this cap regardless of what it inherited.
 */
const HEAP_CAP_MB = Number(process.env.MEMORY_MB) || 384;
const priorNodeOptions = (process.env.NODE_OPTIONS ?? "")
  .replace(/--max-old-space-size=\d+/g, "")
  .replace(/--max_old_space_size=\d+/g, "")
  .trim();
const nodeOptions =
  `${priorNodeOptions} --max-old-space-size=${HEAP_CAP_MB}`.trim();

/**
 * Stop the image library hoarding memory it has finished with.
 *
 * The site's memory was seen climbing in steps over a day and settling near the
 * 512 MB ceiling — not a leak in this code, but the image optimiser (`sharp`,
 * built on `libvips`) doing what it does on Linux: each photo it resizes is
 * handled by native, multi-threaded code, and glibc's allocator keeps a separate
 * memory pool per thread and hands very little of it back to the system once the
 * work is done. RSS therefore ratchets up as more photos and sizes are processed
 * and then plateaus, high.
 *
 * `MALLOC_ARENA_MAX=2` caps the number of those pools. It is the standard fix
 * for exactly this pattern and costs nothing but a hair of allocator contention,
 * which a site serving a handful of images will never notice. Overridable from
 * the environment for anyone who wants to tune it.
 */
const child = spawn("npm", ["run", "start:next"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    MALLOC_ARENA_MAX: process.env.MALLOC_ARENA_MAX ?? "2",
  },
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => child.kill(sig));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
