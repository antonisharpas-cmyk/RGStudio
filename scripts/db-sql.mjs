/**
 * A SQL prompt on the mirror, for asking the database questions.
 *
 *     npm run db:sql                          an interactive prompt
 *     npm run db:sql -- "select ..."          one query and out
 *
 * At the prompt:
 *
 *     \dt              list the tables, with row counts
 *     \d users         one table's columns and types
 *     \q               leave
 *
 * ---
 *
 * **Why this and not `db:peek`.**
 *
 * `db:peek` reads the studio's real SQLite file, so it is deliberately locked
 * down: read-only at the driver, and it refuses anything that is not a select.
 * That is right for a tool pointed at live bookings, and it makes it a poor
 * place to *explore*. Every experiment has to be phrased perfectly the first
 * time, dates come out as integers like `1801674000`, and there is no room to be
 * wrong.
 *
 * This one points at the Postgres mirror instead, which changes what is safe.
 * The mirror is a disposable copy rebuilt by `npm run db:mirror`, so nothing
 * typed here can reach the studio's data: no query, no `update`, not a `drop
 * table`. The worst outcome is a mangled copy and a rerun of the mirror. So
 * this tool allows anything, on purpose, because a sandbox that punishes
 * mistakes is not a sandbox.
 *
 * It also gets Postgres' own SQL, which is the point of having gone to the
 * trouble: real dates, `date_trunc`, `interval '7 days'`, window functions,
 * `filter (where ...)`.
 *
 * ---
 *
 * **On being handed a live connection anyway.**
 *
 * The one thing this cannot check is whether `MIRROR_DATABASE_URL` really points
 * at a mirror. If somebody one day points it at a database that matters, this
 * script will cheerfully run a `delete` against it. The guard is the naming and
 * the banner rather than the code, and it is worth knowing about rather than
 * assuming away.
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

/**
 * The studio's timezone, and why this matters more than it looks.
 *
 * Postgres defaults a connection to UTC, and Cyprus is two or three hours ahead
 * of it depending on the season. Left alone, two things go quietly wrong: a
 * class at 16:00 in Larnaca prints as `13:00`, and — worse, because it is
 * invisible — `starts_at::date` and `date_trunc('day', ...)` cut the day at
 * midnight UTC, so a 01:00 Saturday class is filed under Friday. A query asking
 * "how many classes on the 1st of October" then quietly answers about a day that
 * is not the 1st of October.
 *
 * So the session is put into studio time on connect and dates are printed in it.
 * Read from src/lib/studio.ts rather than written twice, because the studio
 * moving is exactly the kind of change that gets made in one place.
 */
const STUDIO_TZ = (() => {
  try {
    const f = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/studio.ts");
    return readFileSync(f, "utf8").match(/timezone:\s*"([^"]+)"/)?.[1] ?? "Asia/Nicosia";
  } catch {
    return "Asia/Nicosia";
  }
})();

/** "2026-10-28 10:00" in the studio's own clock, never UTC. */
const studioTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: STUDIO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const target = process.env.MIRROR_DATABASE_URL;

if (!target) {
  console.error(`\n  ${c.red("✗")} MIRROR_DATABASE_URL is not set.\n`);
  console.error(`  This is the Postgres mirror, not the studio's own database.`);
  console.error(`  Set it to the Postgres service's Internal Database URL on the`);
  console.error(`  web service, then run ${c.bold("npm run db:mirror")} to fill it.\n`);
  console.error(`  To query the real SQLite database instead, read-only:`);
  console.error(`  ${c.bold('npm run db:peek -- "select ..."')}\n`);
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//.test(target)) {
  console.error(
    `\n  ${c.red("✗")} MIRROR_DATABASE_URL is not a Postgres URL.\n`,
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString: target,
  ssl: /\.render\.com|sslmode=require/.test(target)
    ? { rejectUnauthorized: false }
    : undefined,
});

try {
  await client.connect();
  /* Before any query runs, so `now()`, `::date` and `date_trunc` all cut the
     day where Larnaca cuts it. See STUDIO_TZ above. */
  await client.query(`set time zone '${STUDIO_TZ}'`);
} catch (e) {
  console.error(`\n  ${c.red("✗")} could not connect: ${e.message}\n`);
  console.error(`  The Internal Database URL only resolves from inside Render,`);
  console.error(`  so run this from the web service's Shell tab.\n`);
  process.exit(1);
}

/** Rows as an aligned table, which is all a terminal needs. */
function render(res) {
  if (!res.rows || res.rows.length === 0) {
    /* An insert or update says how many it touched; a select that matched
       nothing says so. Reporting "0 rows" for a successful delete of 40 would
       be actively misleading. */
    const verb = res.command?.toLowerCase();
    if (verb && verb !== "select") {
      console.log(`  ${c.green("✓")} ${verb} ${res.rowCount ?? 0}\n`);
    } else {
      console.log(`  ${c.dim("no rows")}\n`);
    }
    return;
  }
  const cols = res.fields.map((f) => f.name);
  const cell = (v) => {
    if (v === null || v === undefined) return c.dim("null");
    if (v instanceof Date) {
      /* en-CA gives YYYY-MM-DD, and the comma between date and time is the only
         thing that needs taking out. */
      return studioTime.format(v).replace(",", "");
    }
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  /* Widths measured on the printed text, but with the colour codes stripped:
     `null` is dimmed, and counting its escape sequence as nine characters put
     every column after it out of line. */
  const bare = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const width = {};
  for (const k of cols) {
    width[k] = Math.min(
      44,
      Math.max(k.length, ...res.rows.map((r) => bare(cell(r[k])).length)),
    );
  }
  const pad = (s, w) => {
    const b = bare(s);
    return b.length > w ? b.slice(0, w - 1) + "…" : s + " ".repeat(w - b.length);
  };
  console.log(`  ${c.bold(cols.map((k) => pad(k, width[k])).join("  "))}`);
  console.log(`  ${c.dim(cols.map((k) => "─".repeat(width[k])).join("  "))}`);
  for (const r of res.rows) {
    console.log(`  ${cols.map((k) => pad(cell(r[k]), width[k])).join("  ")}`);
  }
  console.log(
    `\n  ${c.dim(`${res.rows.length} row${res.rows.length === 1 ? "" : "s"}`)}\n`,
  );
}

/** The two shortcuts worth having, spelled the way psql spells them. */
async function meta(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);

  if (cmd === "\\dt") {
    /* Row counts alongside the names, because "which tables are there" and
       "which of them has anything in it" are the same question in practice. */
    const { rows } = await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    const out = [];
    for (const { table_name } of rows) {
      const n = await client.query(`select count(*) c from "${table_name}"`);
      out.push({ table: table_name, rows: Number(n.rows[0].c) });
    }
    render({ rows: out, fields: [{ name: "table" }, { name: "rows" }] });
    return true;
  }

  if (cmd === "\\d" && rest[0]) {
    const { rows, fields } = await client.query(
      `select column_name as column, data_type as type, is_nullable as nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by ordinal_position`,
      [rest[0]],
    );
    if (rows.length === 0) {
      console.log(`  ${c.red("✗")} no table called ${c.bold(rest[0])}\n`);
      return true;
    }
    render({ rows, fields });
    return true;
  }

  if (cmd === "\\q" || cmd === "exit" || cmd === "quit") return "quit";
  if (cmd?.startsWith("\\")) {
    console.log(
      `  ${c.dim("only \\dt, \\d <table> and \\q are supported here")}\n`,
    );
    return true;
  }
  return false;
}

async function run(sql) {
  const handled = await meta(sql);
  if (handled === "quit") return "quit";
  if (handled) return;
  try {
    render(await client.query(sql));
  } catch (e) {
    /* Postgres says where it went wrong; passing that through unedited is far
       more useful than a tidier message of our own. */
    console.log(`  ${c.red("✗")} ${e.message}`);
    if (e.hint) console.log(`  ${c.dim(`hint: ${e.hint}`)}`);
    console.log("");
  }
}

/* -------------------------------------------------------- one query and out */

const oneShot = process.argv.slice(2).join(" ").trim();
if (oneShot) {
  await run(oneShot);
  await client.end();
  process.exit(0);
}

/* --------------------------------------------------------------- the prompt */

const info = await client
  .query(`select mirrored_at, rows from zz_mirror_info`)
  .catch(() => null);

console.log(`\n  ${c.bold("RG Pilates Studio — SQL on the mirror")}\n`);
if (info?.rows?.[0]) {
  const { mirrored_at, rows } = info.rows[0];
  const mins = Math.round((Date.now() - new Date(mirrored_at)) / 60000);
  const age =
    mins < 1
      ? "just now"
      : mins < 60
        ? `${mins} min ago`
        : `${Math.round(mins / 60)} h ago`;
  /* An old copy is the one thing that will quietly mislead somebody here, so
     it is said before the first query rather than left for them to think of. */
  console.log(
    `  copy taken ${age} ${c.dim(`(${rows} rows)`)}${mins > 180 ? `  ${c.yellow("← stale, run npm run db:mirror")}` : ""}`,
  );
} else {
  console.log(
    `  ${c.yellow("no mirror found")} ${c.dim("— run npm run db:mirror first")}`,
  );
}
console.log(
  `\n  ${c.dim("This is a disposable copy. Nothing you type here can reach")}`,
);
console.log(
  `  ${c.dim("the studio's real data, so break it as much as you like:")}`,
);
console.log(`  ${c.dim("npm run db:mirror puts it all back.")}\n`);
console.log(
  `  ${c.dim("\\dt  tables    \\d users  columns    \\q  quit    ; ends a query")}\n`,
);

const rl = createInterface({ input: process.stdin, output: process.stdout });

/**
 * Read one line, finish with it, then read the next.
 *
 * Deliberately `for await` over the interface rather than an `rl.on("line")`
 * handler. An async handler is not awaited by readline: it fires again as soon
 * as the next line arrives, so a pasted block of SQL started every statement at
 * once on a single connection. `pg` warned about it ("client.query() when the
 * client is already executing a query"), results came back interleaved or not at
 * all, and a trailing `\q` closed the connection out from under queries still
 * running. The async iterator applies backpressure to stdin for free, which is
 * the whole fix.
 *
 * Statements are gathered until a semicolon, so a long join can be typed over
 * several lines the way it would be written in a file.
 */
let buffer = "";
const setPrompt = () =>
  rl.setPrompt(buffer ? `  ${c.dim("...")} ` : `  ${c.cyan("sql>")} `);

setPrompt();
rl.prompt();

for await (const line of rl) {
  const trimmed = line.trim();

  if (!buffer && (trimmed === "" || trimmed.startsWith("--"))) {
    rl.prompt();
    continue;
  }

  /* Backslash shortcuts and \q are single lines and never need a semicolon. */
  if (!buffer && (trimmed.startsWith("\\") || /^(exit|quit)$/i.test(trimmed))) {
    if ((await run(trimmed)) === "quit") break;
    setPrompt();
    rl.prompt();
    continue;
  }

  buffer += (buffer ? "\n" : "") + line;
  if (!buffer.trimEnd().endsWith(";")) {
    setPrompt();
    rl.prompt();
    continue;
  }

  const sql = buffer.trimEnd().replace(/;$/, "");
  buffer = "";
  await run(sql);
  setPrompt();
  rl.prompt();
}

rl.close();
await client.end();
console.log(`  ${c.dim("bye")}\n`);
