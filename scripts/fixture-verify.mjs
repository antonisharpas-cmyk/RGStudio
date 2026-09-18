/**
 * Mark a test fixture's email address as confirmed, by writing to the database.
 *
 * Registration now emails a six-digit code, and an account can do nothing until
 * that code comes back. None of the HTTP suites can read that email — and none
 * of them should be able to, because a code reachable by anything other than the
 * mailbox it was sent to would be a hole rather than a convenience.
 *
 * So each suite proves the gate exists over HTTP (see test-http.mjs, section 3b)
 * and then steps over it here, exactly the way a member typing the right code
 * would: one column, one row, nothing else touched.
 *
 * Written directly rather than through the app because these suites run as
 * separate processes against a server that already holds the file. WAL mode
 * makes that safe.
 *
 * **This is only half of it.** The middleware decides where a request goes from
 * the session *cookie*, not from the row — it runs on the edge runtime and
 * cannot read SQLite. So a fixture stamped here is still carrying a cookie that
 * says otherwise, and every page it asks for is still redirected to the code
 * box. Each suite therefore signs the fixture in again straight afterwards,
 * which is exactly what a real member does and what re-issues the cookie:
 *
 *     if (markVerified(email) !== 1) throw new Error("fixture did not verify");
 *     await req(j, "/api/auth/login", { method: "POST", body: { email, password } });
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

let conn = null;

function db() {
  if (!conn) {
    conn = new Database(
      (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, ""),
    );
  }
  return conn;
}

/**
 * Confirm one fixture by email address.
 *
 * Returns the number of rows changed — 1 for a fresh unverified fixture, 0 if it
 * was already verified or the address does not exist. Suites assert on that,
 * because a silent 0 would mean the rest of the run was testing an account that
 * cannot do anything, and every failure afterwards would point at the wrong
 * thing.
 */
export function markVerified(email) {
  return db()
    .prepare(
      `update users
          set email_verified_at = unixepoch()
        where email = ? and email_verified_at is null`,
    )
    .run(email).changes;
}

/**
 * Answer the three welcome questions for a fixture, by writing to the database.
 *
 * The same bargain as `markVerified` above, one gate later. Registration now has
 * two mandatory steps rather than one: the emailed code, and then three
 * questions about the member's pilates and anything to be careful of. A booking
 * is refused until both are done — deliberately, because the alternative is five
 * people on reformers and an instructor who does not know which of them is new.
 *
 * Every suite that books a class therefore has to get past it. `test-http`
 * proves the gate and answers the questions over HTTP, the way a member does,
 * because that is worth testing once properly. Everywhere else it is scaffolding
 * in the way of the thing actually being tested, so it is stepped over here:
 * three columns and the date the step was completed, nothing else touched.
 *
 * Returns rows changed, so a suite can assert rather than assume: a silent 0
 * would leave the rest of the run testing an account that cannot book, and every
 * failure afterwards would point at the wrong thing.
 */
export function markOnboarded(email, condition = null) {
  return db()
    .prepare(
      `update users
          set pilates_level  = coalesce(pilates_level, 'BEGINNER'),
              pilates_since  = coalesce(pilates_since, 'NONE'),
              health_condition = coalesce(health_condition, ?),
              intake_at      = coalesce(intake_at, unixepoch())
        where email = ?`,
    )
    .run(condition, email).changes;
}

/**
 * Plant a code we know, so a suite can verify the way a member does.
 *
 * `markVerified` above steps *over* the gate by writing the column. That is the
 * right trade for a suite whose subject is something else, and it became the
 * wrong one for the opening offer the day the free session moved from
 * registration to verification: a fixture that writes `email_verified_at`
 * directly runs none of the code that hands the session over, so the suite
 * would have been asserting against a path no member ever takes.
 *
 * This goes the other way. It does not skip the gate, it forges the *mailbox*:
 * the stored value is an HMAC of the six digits keyed with AUTH_SECRET, so
 * knowing the secret is enough to write the hash of a code of our choosing. The
 * suite then posts that code to `/api/auth/verify` and every line of the real
 * route runs, grant included.
 *
 * That it needs AUTH_SECRET is the point rather than an inconvenience. Without
 * the secret this is not possible, which is the property the hash exists to
 * give: a suite on the same machine as the server can do it, and nothing
 * reaching the server over the network can.
 *
 * Returns the code to type. Throws rather than returning null if there is no
 * challenge to overwrite, because a silent failure here would show up later as
 * a wrong code and read as a broken verify route.
 */
export function plantCode(email, code = "424242") {
  const secret = authSecret();
  const row = db()
    .prepare(`select id from users where email = ?`)
    .get(email);
  if (!row) throw new Error(`plantCode: no such account ${email}`);

  const hash = createHmac("sha256", secret).update(code).digest("hex");
  const changed = db()
    .prepare(
      `update email_verifications
          set code_hash = ?,
              expires_at = unixepoch() + 900,
              attempts = 0
        where user_id = ?`,
    )
    .run(hash, row.id).changes;
  if (changed !== 1) {
    throw new Error(`plantCode: no open challenge for ${email}`);
  }
  return code;
}

/**
 * AUTH_SECRET, read the same way the server reads it.
 *
 * The suites are plain node processes and do not get Next's automatic .env
 * loading, so the file is parsed here rather than requiring every caller to
 * remember `--env-file`. The environment still wins, which is what makes this
 * work unchanged against a server started with the secret exported.
 */
function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    const text = readFileSync(".env", "utf8");
    const line = text
      .split(/\r?\n/)
      .find((l) => /^\s*AUTH_SECRET\s*=/.test(l));
    const value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  } catch {
    /* Falls through to the error below, which says what to do about it. */
  }
  throw new Error(
    "plantCode needs AUTH_SECRET. Put it in .env or export it before the suite.",
  );
}

/**
 * How many sessions this fixture holds, read from the database.
 *
 * Needed because the member-facing balance is behind the verification gate, and
 * the interesting moment is precisely *before* that gate opens: asking the API
 * for the balance of an unconfirmed account gets a refusal rather than a
 * number, and "the request was refused" is not the same claim as "nothing was
 * granted". This reads the batches themselves, so the assertion says what it
 * means.
 */
export function creditsHeld(email) {
  const row = db()
    .prepare(
      `select coalesce(sum(b.credits_remaining), 0) as n
         from credit_batches b
         join users u on u.id = b.user_id
        where u.email = ?`,
    )
    .get(email);
  return row?.n ?? 0;
}
