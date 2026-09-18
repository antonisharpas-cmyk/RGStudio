/**
 * Copy the studio's database into Postgres, so it can be looked at.
 *
 *     npm run db:mirror              copy everything
 *     npm run db:mirror -- --dry     say what it would do, touch nothing
 *
 * ---
 *
 * **Why this exists.**
 *
 * The studio's database is a SQLite file on Render's persistent disk. That is
 * the right place for it: one machine, one writer, a few hundred members, and a
 * disk Render snapshots every night. What it is not is *visible*. Render's
 * dashboard has a perfectly good database browser and it only works for Render's
 * own Postgres, so the honest answer to "let me look at the bookings" was
 * `npm run db:peek` at a shell prompt, which is a fine tool and is not a table
 * you can click around in.
 *
 * So: leave the app exactly where it is, and copy the data somewhere that can be
 * browsed. Nothing in `src/` changes, no query is rewritten, and the live
 * database is opened read-only. If this script is deleted the website does not
 * notice.
 *
 * This is an ordinary arrangement rather than a workaround. Reporting replicas
 * exist because the database that takes the bookings and the database somebody
 * runs curious queries against want different things: the first wants to be left
 * alone, and the second wants to be poked at by a person who is guessing.
 *
 * ---
 *
 * **It is a copy, and it is one-way.**
 *
 * Every run drops the mirrored tables and rebuilds them. There is no attempt to
 * work out what changed, because a mirror that tries to be clever about deltas is
 * a mirror that will one day be subtly wrong, and a wrong copy is worse than no
 * copy. Rebuilding twenty small tables costs a second or two.
 *
 * Nothing here ever writes to SQLite, and nothing ever reads *back* from
 * Postgres. Anything typed into the mirror is gone on the next run, which is the
 * point: it means a mistyped `update` in Render's dashboard cannot cost the
 * studio a booking. The mirror is a photograph, not a second original.
 *
 * ---
 *
 * **Types get better on the way across, not worse.**
 *
 * SQLite stores a date as an integer count of seconds, which is why `db:peek`
 * shows `1757068200` where a person wanted `3 Sep 2026, 10:30`. Postgres has a
 * real timestamp type, so the mirror converts on the way in and the dashboard
 * shows dates as dates. Booleans stop being 0 and 1 for the same reason.
 *
 * Which columns are dates and which are flags is not guessed. It is read out of
 * `src/db/schema.ts`, the one place that already knows, so a column added there
 * tomorrow arrives in the mirror with the right type and nobody has to remember
 * this file exists. See `readModes()`.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/**
 * The studio's timezone, read from the one place that already knows.
 *
 * Used to put the mirror database itself into studio time, so every client that
 * connects to it reads class times as Larnaca reads them. See the ALTER
 * DATABASE below for why that matters more than it looks.
 */
const STUDIO_TZ =
  readFileSync(join(root, "src/lib/studio.ts"), "utf8").match(
    /timezone:\s*"([^"]+)"/,
  )?.[1] ?? "Asia/Nicosia";

const dry = process.argv.includes("--dry");

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const die = (...lines) => {
  console.error(`\n  ${c.red("✗")} ${lines[0]}\n`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
};

/* ------------------------------------------------------------------ the ends */

const source = (process.env.DATABASE_URL ?? "file:./dev.db").replace(
  /^file:/,
  "",
);

/**
 * Deliberately its own variable, and deliberately not `DATABASE_URL`.
 *
 * Putting a Postgres URL in `DATABASE_URL` is exactly the mistake this whole
 * arrangement exists to make impossible. `src/db/index.ts` treats that variable
 * as a *file path*: handed `postgresql://...` it does not fail, it creates a new
 * empty SQLite database in a directory named `postgresql:` and serves the studio
 * from it, while the real data sits untouched on the disk. It looks like a
 * working deploy. So the mirror gets its own name, and the check below refuses
 * the two ways round to swap them by accident.
 */
const target = process.env.MIRROR_DATABASE_URL;

if (!target) {
  die(
    "MIRROR_DATABASE_URL is not set.",
    "This is the Postgres database to copy into. In Render, open the",
    "Postgres service, copy the Internal Database URL, and add it to the",
    c.bold("web service's") + " environment as MIRROR_DATABASE_URL.",
    "",
    c.yellow("Do not put it in DATABASE_URL.") +
      " That one is the SQLite file path",
    "and must stay file:/var/data/rg.db.",
  );
}
if (!/^postgres(ql)?:\/\//.test(target)) {
  die(
    "MIRROR_DATABASE_URL does not look like a Postgres URL.",
    `It is ${c.bold(target.slice(0, 24) + "…")}, and it should start with postgresql://`,
  );
}
if (/^postgres(ql)?:\/\//.test(source)) {
  die(
    "DATABASE_URL is a Postgres URL, and it must be a file path.",
    "The website cannot read Postgres: it is SQLite throughout, and that",
    "variable is the name of the file. On Render it should be:",
    "",
    `    ${c.bold("DATABASE_URL = file:/var/data/rg.db")}`,
    "",
    "Left as it is, the site quietly serves from a throwaway database that",
    "is deleted on every deploy. Fix that first, then mirror.",
  );
}
if (!existsSync(source)) {
  die(
    `no database at ${c.bold(source)}`,
    `DATABASE_URL is ${process.env.DATABASE_URL ?? "(not set)"}`,
    "On Render this should be file:/var/data/rg.db, with the disk",
    "mounted at /var/data.",
  );
}

/**
 * Refuse to push a development database over the studio's mirror.
 *
 * This is the trap that opens the moment somebody puts the *external* Postgres
 * URL in their own `.env` so they can query the mirror from a laptop, which is
 * a perfectly sensible thing to want. The next `npm run db:mirror` typed on
 * that laptop then does exactly what it is told: it copies `./dev.db` — three
 * thousand invented members, a hundred thousand euro of imaginary takings —
 * straight over the copy the studio is reading its real figures from.
 *
 * Nothing breaks. No error appears. The website is untouched, because the
 * website has never read Postgres. The only symptom is that the numbers are now
 * fiction, and they look exactly as plausible as the real ones did.
 *
 * The two ends are told apart by shape rather than by configuration: an
 * external Render host is the public one (`*.render.com`), and a source on
 * `/var/data` is the mounted disk, which only exists on the server. Local file
 * plus public host is the mistake, and there is no legitimate reason to do it,
 * so `--force` exists for the one case nobody has thought of yet and prints
 * what it is doing.
 */
const targetIsHosted = /\.render\.com/.test(target);
const sourceIsLive = source.startsWith("/var/data");

if (targetIsHosted && !sourceIsLive && !process.argv.includes("--force")) {
  die(
    "this would copy a local database over the studio's mirror.",
    `  source  ${c.bold(source)} ${c.dim("(a file on this machine)")}`,
    `  target  ${c.bold("the hosted Postgres")} ${c.dim("(external Render host)")}`,
    "",
    "The mirror is meant to be filled from the live database, which lives on",
    "Render's disk at /var/data/rg.db. Run this from the web service's",
    "Shell tab instead, where it already points at the right file:",
    "",
    `    ${c.bold("npm run db:mirror")}`,
    "",
    "To read the mirror from here without overwriting it, query it:",
    "",
    `    ${c.bold('npm run db:sql -- "select count(*) from users"')}`,
    "",
    c.dim("(--force overrides this, and is almost certainly not what you want.)"),
  );
}
if (targetIsHosted && !sourceIsLive) {
  console.log(
    `  ${c.yellow("--force")} ${c.dim("copying a local database over the hosted mirror")}\n`,
  );
}

/* --------------------------------------------------- what the columns mean */

/**
 * Which columns are dates and which are flags, read from the schema itself.
 *
 * Drizzle spells both as `integer(...)` with a `mode`, and SQLite forgets the
 * distinction entirely: by the time the data is in the file, a date and a
 * true/false and a price are all just integers. So the meaning has to come from
 * `src/db/schema.ts`.
 *
 * Read at run time rather than imported, because this file is plain Node and the
 * schema is TypeScript. Matching on the column name alone is safe here and was
 * checked before relying on it: no name is a date in one table and a flag in
 * another, and the two sets do not overlap. If that ever stops being true this
 * script will put a date in a boolean column and Postgres will refuse the insert,
 * which is the failure mode to want.
 */
async function readModes() {
  const src = await readFile(join(root, "src/db/schema.ts"), "utf8");
  const timestamps = new Set();
  const booleans = new Set();
  const re =
    /integer\(\s*"([a-z0-9_]+)"\s*,\s*\{\s*mode:\s*"(timestamp|boolean)"/g;
  for (const m of src.matchAll(re)) {
    (m[2] === "timestamp" ? timestamps : booleans).add(m[1]);
  }
  if (timestamps.size === 0) {
    die(
      "could not read any column modes out of src/db/schema.ts",
      "Either the file moved or the way columns are declared changed.",
      "Without this, every date would arrive in the mirror as a number.",
    );
  }
  const both = [...timestamps].filter((x) => booleans.has(x));
  if (both.length) {
    die(
      `these column names are a date in one table and a flag in another: ${both.join(", ")}`,
      "This script matches on the column name, so it cannot tell them apart.",
      "Rename one of them, or teach this script about tables.",
    );
  }
  return { timestamps, booleans };
}

/** SQLite's declared type, plus what the schema says it means. */
function pgType(col, modes) {
  if (modes.timestamps.has(col.name)) return "timestamptz";
  if (modes.booleans.has(col.name)) return "boolean";
  const t = (col.type || "").toUpperCase();
  if (t.startsWith("INT")) return "bigint";
  if (t.startsWith("REAL") || t.startsWith("FLOA") || t.startsWith("DOUB")) {
    return "double precision";
  }
  if (t.startsWith("BLOB")) return "bytea";
  return "text";
}

/** One SQLite value, as Postgres wants it. */
function convert(v, col, modes) {
  if (v === null || v === undefined) return null;
  if (modes.timestamps.has(col)) {
    /* Whole Unix seconds, per the `integer({ mode: "timestamp" })` convention
       used throughout the schema. Anything non-numeric that somehow got in
       there is passed straight through so Postgres complains about it loudly
       rather than this script inventing a date. */
    const n = Number(v);
    return Number.isFinite(n) ? new Date(n * 1000) : v;
  }
  if (modes.booleans.has(col)) return Boolean(Number(v));
  return v;
}

/* -------------------------------------------------------------------- go */

const modes = await readModes();

const sqlite = new Database(source, { readonly: true });

const tables = sqlite
  .prepare(
    `select name from sqlite_master
      where type = 'table' and name not like 'sqlite_%'
      order by name`,
  )
  .all()
  .map((r) => r.name);

console.log(`\n  ${c.bold("mirroring the studio database into Postgres")}\n`);
console.log(`  from   ${source} ${c.dim("(read-only)")}`);
/* Never the whole URL: it has the password in it, and this output ends up in
   Render's logs and in screenshots. */
console.log(`  to     ${target.replace(/\/\/[^@]*@/, "//…@")}`);
if (dry) console.log(`\n  ${c.yellow("dry run — nothing will be written")}`);
console.log("");

const client = new pg.Client({
  connectionString: target,
  /* Render's own Postgres presents a certificate the Node default does not
     accept. On the internal network this is a private hop inside the account's
     own VPC; over the external hostname it is still encrypted, just not
     verified. Worth knowing about rather than being surprised by. */
  ssl: /\.render\.com|sslmode=require/.test(target)
    ? { rejectUnauthorized: false }
    : undefined,
});

try {
  await client.connect();
} catch (e) {
  die(
    `could not connect to the mirror: ${e.message}`,
    "If this says the host is unknown, the Internal Database URL only",
    "resolves from inside Render. Run this from the web service's Shell",
    "tab, not from your own machine.",
  );
}

let totalRows = 0;
const report = [];

try {
  /**
   * One transaction for the whole mirror.
   *
   * Halfway through a rebuild the mirror is nonsense: some tables new, some
   * dropped, some missing. Anybody who opens the dashboard at that moment sees
   * a database that appears to have lost half the studio. Inside a transaction
   * they see the old copy until the moment they see the new one, and a failure
   * anywhere leaves the previous copy exactly as it was.
   */
  /**
   * Put the whole database into the studio's timezone, permanently.
   *
   * Postgres defaults a connection to UTC and Cyprus is two or three hours
   * ahead, so every client that is not told otherwise reads the timetable
   * wrong: a 16:00 class in Larnaca shows as 13:00. Worse, and invisible,
   * `starts_at::date` and `date_trunc('day', ...)` cut the day at midnight UTC,
   * so a query about the 1st of October quietly answers about a different day.
   *
   * `npm run db:sql` sets this per session, but that only helps the one tool.
   * Set on the database itself, it reaches everything that ever connects —
   * Render's dashboard, DBeaver, Navicat, pgAdmin, Excel — with nobody having
   * to remember. New sessions pick it up; this one has already started, so
   * `set time zone` below covers the rest of this run.
   *
   * Outside the transaction because ALTER DATABASE cannot run inside one.
   */
  if (!dry) {
    const { rows } = await client.query("select current_database() as db");
    await client.query(
      `alter database "${rows[0].db}" set timezone to '${STUDIO_TZ}'`,
    );
    await client.query(`set time zone '${STUDIO_TZ}'`);
  }

  if (!dry) await client.query("begin");

  for (const name of tables) {
    const cols = sqlite.prepare(`pragma table_info("${name}")`).all();
    const rows = sqlite.prepare(`select * from "${name}"`).all();

    const defs = cols.map((col) => {
      const type = pgType(col, modes);
      /* Primary keys come across so the browser can sort and identify rows.
         Foreign keys and unique indexes do not: they would force the tables to
         be built in dependency order, and a constraint tripping on a copy would
         stop the mirror over something that is not a problem in a photograph.
         NOT NULL is dropped for the same reason. */
      return `  "${col.name}" ${type}${col.pk ? " primary key" : ""}`;
    });

    if (!dry) {
      await client.query(`drop table if exists "${name}" cascade`);
      await client.query(`create table "${name}" (\n${defs.join(",\n")}\n)`);
    }

    /* Batched, because one insert per row is 21,000 round trips and a
       single insert of 21,000 rows is past Postgres' parameter limit. 500 rows
       of the widest table here sits comfortably inside both. */
    const BATCH = 500;
    if (!dry) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const names = cols.map((x) => `"${x.name}"`).join(", ");
        const values = [];
        const params = [];
        let p = 1;
        for (const row of slice) {
          values.push(`(${cols.map(() => `$${p++}`).join(", ")})`);
          for (const col of cols) {
            params.push(convert(row[col.name], col.name, modes));
          }
        }
        await client.query(
          `insert into "${name}" (${names}) values ${values.join(", ")}`,
          params,
        );
      }
    }

    totalRows += rows.length;
    report.push({ table: name, rows: rows.length, columns: cols.length });
  }

  /**
   * A row saying when this happened.
   *
   * Without it the mirror is a copy of unknown age, and somebody will read a
   * member count off it on Thursday that was true on Monday and act on it. The
   * table is named to sort to the bottom of the dashboard's list and to be
   * obviously not part of the app.
   */
  if (!dry) {
    await client.query(`drop table if exists "zz_mirror_info" cascade`);
    await client.query(
      `create table "zz_mirror_info" (
         mirrored_at timestamptz,
         source text,
         tables bigint,
         rows bigint,
         note text
       )`,
    );
    await client.query(
      `insert into "zz_mirror_info" values ($1, $2, $3, $4, $5)`,
      [
        new Date(),
        source,
        report.length,
        totalRows,
        "Read-only copy. Rebuilt by npm run db:mirror. Edits here are lost on the next run and never reach the website.",
      ],
    );
    await client.query("commit");
  }
} catch (e) {
  if (!dry) await client.query("rollback").catch(() => {});
  die(
    `mirror failed, nothing was changed: ${e.message}`,
    "The previous copy in Postgres is untouched, and so is the studio's",
    "own database. Nothing was written to SQLite at any point.",
  );
} finally {
  await client.end();
}

/* ---------------------------------------------------------------- the receipt */

const w = Math.max(...report.map((r) => r.table.length), 5);
for (const r of report) {
  const n = String(r.rows).padStart(6);
  console.log(
    `  ${r.table.padEnd(w)}  ${n} ${r.rows === 1 ? "row " : "rows"}  ${c.dim(`${r.columns} columns`)}`,
  );
}

console.log("");
if (dry) {
  console.log(
    `  ${c.yellow("dry run")}  would copy ${report.length} tables, ${totalRows} rows\n`,
  );
  process.exit(0);
}

console.log(
  `  ${c.green("✓")} ${report.length} tables, ${totalRows} rows copied\n`,
);
console.log(`  ${c.dim("Render dashboard → the Postgres service → Connect")}`);
console.log(
  `  ${c.dim("Dates are real dates and flags are true/false, not 0 and 1.")}`,
);
console.log(
  `  ${c.dim("Nothing here writes back. Run it again for a fresh copy.")}\n`,
);
