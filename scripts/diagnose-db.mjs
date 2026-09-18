/**
 * Database-level diagnostic — where the server-side time actually goes.
 *
 *   npx tsx scripts/diagnose-db.mjs
 *
 * Times every query the app runs on a page load, and prints SQLite's own query
 * plan for the expensive ones so you can see whether an index is being used.
 */
import Database from "better-sqlite3";

const file = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");
const db = new Database(file, { readonly: true });

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};

function bench(label, sql, params = [], runs = 50) {
  let stmt;
  try {
    stmt = db.prepare(sql);
  } catch (e) {
    console.log(`  ${c.red("✗")} ${label} — ${e.message}`);
    return null;
  }
  /* warm the page cache */
  try {
    stmt.all(...params);
  } catch (e) {
    console.log(`  ${c.red("✗")} ${label} — ${e.message}`);
    return null;
  }

  const times = [];
  let rows = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    rows = stmt.all(...params).length;
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const worst = times[times.length - 1];

  const colour = median < 1 ? c.green : median < 5 ? c.amber : c.red;
  console.log(
    `  ${colour(`${median.toFixed(2)}ms`.padStart(9))} ${`(worst ${worst.toFixed(1)}ms)`.padEnd(18)} ${label} ${c.dim(`→ ${rows} rows`)}`,
  );
  return { label, median, worst, rows, sql, params };
}

function plan(sql, params = []) {
  try {
    const rows = db.prepare(`explain query plan ${sql}`).all(...params);
    return rows.map((r) => r.detail);
  } catch {
    return [];
  }
}

/* Drizzle's sqlite `timestamp` mode stores Unix SECONDS, not milliseconds. */
const now = Math.floor(Date.now() / 1000);
const in14Days = now + 14 * 86_400;
const memberId =
  db.prepare("select id from users where role = 'MEMBER' limit 1").get()?.id ?? "none";

console.log(`\n${c.bold("RG Pilates Studio — database diagnostic")}`);
console.log(c.dim(`${file} · 50 runs per query\n`));

const counts = {
  users: db.prepare("select count(*) n from users").get().n,
  sessions: db.prepare("select count(*) n from class_sessions").get().n,
  bookings: db.prepare("select count(*) n from bookings").get().n,
  batches: db.prepare("select count(*) n from credit_batches").get().n,
  ledger: db.prepare("select count(*) n from credit_ledger").get().n,
};
console.log(
  c.dim(
    `rows: ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}\n`,
  ),
);

console.log(c.bold("Queries run on every page load (layout)"));
bench("layout: look up signed-in user", "select * from users where id = ?", [memberId]);
bench(
  "layout: credit balance",
  `select * from credit_batches
   where user_id = ? and credits_remaining > 0
     and (expires_at is null or expires_at > ?)
   order by expires_at, created_at`,
  [memberId, now],
);

console.log(`\n${c.bold("Timetable page")}`);
const timetableSql = `
  select s.*, ct.name_en, i.name,
    (select count(*) from bookings b where b.session_id = s.id and b.status != 'CANCELLED') as booked,
    (select b.id from bookings b where b.session_id = s.id and b.user_id = ? and b.status != 'CANCELLED' limit 1) as mine
  from class_sessions s
  inner join class_types ct on s.class_type_id = ct.id
  left join instructors i on s.instructor_id = i.id
  where s.starts_at >= ? and s.starts_at <= ?
  order by s.starts_at`;
const timetable = bench("14 days of classes with occupancy", timetableSql, [
  memberId,
  now,
  in14Days,
]);
bench("7 days of classes with occupancy", timetableSql, [
  memberId,
  now,
  now + 7 * 86_400,
]);

console.log(`\n${c.bold("Account page")}`);
bench(
  "my bookings with class and instructor",
  `select b.*, s.starts_at, ct.name_en, i.name from bookings b
   inner join class_sessions s on b.session_id = s.id
   inner join class_types ct on s.class_type_id = ct.id
   left join instructors i on s.instructor_id = i.id
   where b.user_id = ? order by s.starts_at`,
  [memberId],
);
bench(
  "credit ledger (25 most recent)",
  "select * from credit_ledger where user_id = ? order by created_at desc limit 25",
  [memberId],
);

console.log(`\n${c.bold("Admin dashboard")}`);
bench("member list with credits, classes and spend", `
  select u.*,
    (select coalesce(sum(cb.credits_remaining),0) from credit_batches cb
      where cb.user_id = u.id and (cb.expires_at is null or cb.expires_at > ?)) as credits,
    (select count(*) from bookings b where b.user_id = u.id and b.status != 'CANCELLED') as classes,
    (select coalesce(sum(p.amount_cents),0) from purchases p
      where p.user_id = u.id and p.status = 'PAID') as spent
  from users u order by u.created_at desc limit 100`, [now]);

/* ------------------------------------------------------------------- plans */

console.log(`\n${c.bold("Query plan for the timetable query")}`);
console.log(
  c.dim("  looking for SEARCH … USING INDEX (good) rather than SCAN (full table)"),
);
for (const line of plan(timetableSql, [memberId, now, in14Days])) {
  const good = /USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY/.test(line);
  const bad = /^SCAN/.test(line.trim());
  const mark = bad ? c.red("✗") : good ? c.green("✓") : " ";
  console.log(`  ${mark} ${line}`);
}

console.log(`\n${c.bold("Indexes present")}`);
for (const row of db
  .prepare(
    "select tbl_name, name from sqlite_master where type='index' and sql is not null order by tbl_name",
  )
  .all()) {
  console.log(c.dim(`  ${row.tbl_name.padEnd(18)} ${row.name}`));
}

if (timetable && timetable.median > 5) {
  console.log(
    `\n${c.amber("→")} The timetable query is the one to watch. It runs two correlated`,
  );
  console.log(
    `  subqueries per class. At ${counts.sessions} classes that is fine; if it grows past`,
  );
  console.log(`  a few thousand, switch the occupancy count to a single grouped join.`);
}

console.log("");
db.close();
