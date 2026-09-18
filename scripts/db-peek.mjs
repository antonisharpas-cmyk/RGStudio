/**
 * Look at the live database, from Render's Shell, without breaking anything.
 *
 *     npm run db:peek                      what is in there, and how big
 *     npm run db:peek -- users             one table's columns and last rows
 *     npm run db:peek -- "select ..."      a read-only query
 *
 * ---
 *
 * **Why this exists.**
 *
 * The studio's database is a SQLite file on Render's persistent disk, which
 * means Render's dashboard has nothing to show for it: the database browser in
 * their UI is for Render's own Postgres, and a file on a disk is invisible to
 * it. `npm run db:studio` is the nice graphical answer and it cannot help
 * either, because Drizzle Studio reads a file on the machine it runs on — point
 * it at a hosted studio and it opens an empty database sitting next to the
 * repository.
 *
 * So the honest answer to "where can I see the database" was, until this file,
 * "paste a Node one-liner into the Shell tab". That is a bad answer to a
 * question somebody will ask again every few weeks.
 *
 * ---
 *
 * **Read-only, and it means it.**
 *
 * Opened with SQLite's own readonly flag, so a mistyped `delete` fails at the
 * driver rather than at a person's judgement. A query is additionally checked
 * for being a select before it runs — belt as well as braces, because this is a
 * tool for a live database with real members' bookings in it, typed at a prompt,
 * probably while something is going wrong.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const file = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");

/**
 * `--csv` prints the result as comma-separated text instead of a table.
 *
 * Because Render's Shell has no way to download a file. The only route from a
 * hosted shell to a spreadsheet on somebody's desk is the clipboard, and an
 * aligned table full of box-drawing characters pastes into Excel as one column
 * that then needs Text to Columns and a guess at the delimiter. CSV pastes as a
 * spreadsheet.
 *
 * Dates are written as the studio's own clock rather than as the Unix seconds
 * stored in the file, because a column of numbers like 1801674000 is not
 * something anybody can analyse, and Excel will read `2026-10-28 10:00` as a
 * date on its own.
 */
const wantsCsv = process.argv.includes("--csv");
const arg = process.argv
  .slice(2)
  .filter((a) => a !== "--csv")
  .join(" ")
  .trim();

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};

if (!existsSync(file)) {
  console.error(`\n  ${c.red("✗")} no database at ${c.bold(file)}\n`);
  console.error(`  DATABASE_URL is ${process.env.DATABASE_URL ?? "(not set)"}`);
  console.error(
    `  On Render this should be ${c.bold("file:/var/data/rg.db")}, and the`,
  );
  console.error(`  disk must be mounted at /var/data.\n`);
  process.exit(1);
}

const db = new Database(file, { readonly: true });

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The columns holding whole Unix seconds, so `--csv` can write them as dates.
 *
 * Read out of `src/db/schema.ts`, which is the only place that knows: SQLite
 * stores a date and a price as the same kind of integer, so the meaning is not
 * in the file. Matching on the column name is safe because no name is a date in
 * one table and a number in another.
 */
const TIMESTAMP_COLUMNS = (() => {
  try {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/db/schema.ts"),
      "utf8",
    );
    return new Set(
      [
        ...src.matchAll(
          /integer\(\s*"([a-z0-9_]+)"\s*,\s*\{\s*mode:\s*"timestamp"/g,
        ),
      ].map((m) => m[1]),
    );
  } catch {
    return new Set();
  }
})();

const studioTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Nicosia",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** One row as a CSV line, quoted the way a spreadsheet expects. */
function csvRow(values) {
  return values
    .map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      /* A comma, a quote or a newline inside a field has to be quoted, and an
         inner quote doubled. Member names and class notes contain all three. */
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

function csv(rows) {
  if (rows.length === 0) {
    console.error("  no rows");
    return;
  }
  const cols = Object.keys(rows[0]);
  /* Written to stdout with nothing else, so `> members.csv` gives a clean file
     and a copy-paste gives clean text. Every message goes to stderr. */
  console.log(csvRow(cols));
  for (const r of rows) {
    console.log(
      csvRow(
        cols.map((k) => {
          const v = r[k];
          if (v !== null && TIMESTAMP_COLUMNS.has(k) && Number.isFinite(Number(v))) {
            return studioTime.format(new Date(Number(v) * 1000)).replace(",", "");
          }
          return v;
        }),
      ),
    );
  }
}

/** Prints rows as a plain aligned table, which is all a terminal needs. */
function table(rows) {
  if (wantsCsv) return csv(rows);
  if (rows.length === 0) {
    console.log(`  ${c.dim("no rows")}`);
    return;
  }
  const cols = Object.keys(rows[0]);
  const width = {};
  for (const k of cols) {
    width[k] = Math.max(
      k.length,
      ...rows.map((r) => String(r[k] ?? "").length),
    );
    /* A base64 avatar would otherwise wrap the terminal into uselessness. */
    width[k] = Math.min(width[k], 40);
  }
  const cut = (v, w) => {
    const s = String(v ?? "");
    return s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w);
  };
  console.log(`  ${c.dim(cols.map((k) => cut(k, width[k])).join("  "))}`);
  for (const r of rows) {
    console.log(`  ${cols.map((k) => cut(r[k], width[k])).join("  ")}`);
  }
}

const tables = db
  .prepare(
    `select name from sqlite_master
      where type = 'table' and name not like 'sqlite_%'
      order by name`,
  )
  .all()
  .map((r) => r.name);

/* ------------------------------------------------------------- a whole query */
if (arg && !tables.includes(arg)) {
  if (!/^\s*(select|with|pragma|explain)\b/i.test(arg)) {
    console.error(
      `\n  ${c.red("✗")} only select, with, pragma and explain are allowed here.\n`,
    );
    console.error(`  This tool is read-only on a live database. To change`);
    console.error(`  something, use the desk console — that is what it is for.\n`);
    process.exit(1);
  }
  try {
    table(db.prepare(arg).all());
    console.log("");
  } catch (e) {
    console.error(`\n  ${c.red("✗")} ${e.message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

/* -------------------------------------------------------------- one table */
if (arg) {
  const cols = db.prepare(`pragma table_info(${arg})`).all();
  const n = db.prepare(`select count(*) as n from ${arg}`).get().n;
  console.log(`\n  ${c.bold(arg)}  ${c.dim(`${n} rows`)}\n`);
  table(cols.map((x) => ({ column: x.name, type: x.type, notnull: x.notnull, default: x.dflt_value })));

  /* The newest rows, because "what does this table look like" almost always
     means "what went in most recently". Ordered by created_at when the table
     has one, which nearly all of them do. */
  const hasCreated = cols.some((x) => x.name === "created_at");
  const recent = db
    .prepare(
      `select * from ${arg} ${hasCreated ? "order by created_at desc" : ""} limit 5`,
    )
    .all();
  console.log(`\n  ${c.dim("last 5 rows")}\n`);
  table(recent);
  console.log("");
  process.exit(0);
}

/* ------------------------------------------------------------- the overview */
const st = statSync(file);

console.log(`\n  ${c.bold("RG Pilates Studio database")}\n`);
console.log(`  file        ${file}`);
console.log(`  size        ${human(st.size)}`);
console.log(`  changed     ${st.mtime.toISOString()}`);
console.log(
  `  on a disk   ${
    file.startsWith("/var/data")
      ? `${c.green("yes")} ${c.dim("(Render's persistent disk, snapshotted daily)")}`
      : `${c.red("no")} ${c.dim("— this file dies with the container")}`
  }`,
);
/* WAL means a write was in flight recently. Worth seeing, because a viewer
   reading the main file alone can show slightly stale data. */
console.log(
  `  wal         ${existsSync(`${file}-wal`) ? `${human(statSync(`${file}-wal`).size)}` : c.dim("none")}`,
);

console.log(`\n  ${c.bold("tables")}\n`);
const counts = tables.map((name) => ({
  table: name,
  rows: db.prepare(`select count(*) as n from ${name}`).get().n,
}));
table(counts.filter((r) => r.rows > 0));
const empty = counts.filter((r) => r.rows === 0).map((r) => r.table);
if (empty.length) console.log(`\n  ${c.dim(`empty: ${empty.join(", ")}`)}`);

/**
 * The numbers somebody actually came here for.
 *
 * Anybody opening a database at a prompt is usually answering one of about six
 * questions, and all of them are here. Wrapped so a schema that has moved on
 * cannot make this whole tool fail.
 */
console.log(`\n  ${c.bold("the studio, right now")}\n`);
const one = (label, sql) => {
  try {
    const row = db.prepare(sql).get();
    console.log(`  ${label.padEnd(26)}${Object.values(row)[0]}`);
  } catch {
    console.log(`  ${label.padEnd(26)}${c.dim("n/a")}`);
  }
};
one("members", "select count(*) n from users where role = 'MEMBER'");
one(
  "confirmed",
  "select count(*) n from users where role = 'MEMBER' and email_verified_at is not null",
);
one(
  "sessions in hand",
  `select coalesce(sum(credits_remaining), 0) n from credit_batches
     where credits_remaining > 0
       and (expires_at is null or expires_at > unixepoch('now'))`,
);
one(
  "bookings still to come",
  `select count(*) n from bookings b
     join class_sessions s on s.id = b.session_id
    where b.status = 'CONFIRMED' and s.starts_at > unixepoch('now')`,
);
one(
  "classes on the books",
  "select count(*) n from class_sessions where starts_at > unixepoch('now')",
);
one(
  "last class generated",
  "select date(max(starts_at), 'unixepoch') n from class_sessions",
);
one(
  "paid, all time",
  `select printf('EUR %.2f', coalesce(sum(amount_cents), 0) / 100.0) n
     from purchases where status = 'PAID'`,
);

console.log(`\n  ${c.dim("npm run db:peek -- users          one table")}`);
console.log(`  ${c.dim('npm run db:peek -- "select ..."   a read-only query')}\n`);
