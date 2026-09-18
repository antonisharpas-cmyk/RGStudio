/**
 * A small fixed-window rate limiter, in memory.
 *
 * A penetration probe put twelve wrong passwords through `/api/auth/login` in
 * two seconds and none was refused. bcrypt at cost 11 is a real brake — each
 * guess costs the server about a sixth of a second — but "slow" is not "capped",
 * and an account whose email is known (every member's is their login) deserves a
 * ceiling on guesses rather than only a tax on them.
 *
 * ---
 *
 * **Why in memory, and where that is enough.**
 *
 * The studio runs as a single instance. The reminder sweep in
 * instrumentation.ts is an in-process timer on that same assumption, and the
 * desk's idle lock is in-process too. So a `Map` here shares their fate exactly:
 * correct on one instance, and the thing to replace the day the studio runs two.
 * That day is named rather than pretended away — see the note on `hit`.
 *
 * It is deliberately not reached for a database table. A limiter that writes a
 * row on every login attempt turns a burst of guesses into a burst of writes,
 * which is a denial-of-service dressed as a defence against one. The whole point
 * is to spend nothing per attempt, and a Map costs nothing.
 *
 * **What it is and is not.** It slows online guessing against one key to a crawl
 * and it stops a script hammering an endpoint. It is not a defence against a
 * botnet spread across ten thousand addresses, and nothing that fits in a
 * `Map` is. The honest claim is "brute force from a handful of sources", and
 * that is the threat a studio booking site actually faces.
 */

type Window = { count: number; resetAt: number };

/**
 * One bucket per limiter, so login attempts and contact submissions do not
 * share a budget. Keyed inside each bucket by whatever the caller passes.
 */
const buckets = new Map<string, Map<string, Window>>();

/** Stop the map growing without bound on a long-lived process. */
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const bucket of buckets.values()) {
    for (const [key, w] of bucket) {
      if (w.resetAt <= now) bucket.delete(key);
    }
  }
}

export type RateResult = {
  ok: boolean;
  /** Attempts left in the current window, for a Retry-After or a header. */
  remaining: number;
  /** Seconds until the window resets, when `ok` is false. */
  retryAfter: number;
};

function disabled() {
  /* The suites drive login, registration and the contact form hundreds of
     times from one address, which is exactly the shape this is built to stop.
     A single explicit flag turns it off for them, and it is never set in
     production. Named rather than sniffed from NODE_ENV so that the test server,
     which runs as a production build, can still opt out. */
  return process.env.RATE_LIMIT_DISABLED === "true";
}

/**
 * Is `key` currently under its limit, without spending an attempt?
 *
 * For callers that only want to charge some attempts — login charges failures
 * and lets a correct password through free, so a working member is never
 * rate-limited by their own success. Peek at the top to refuse a caller already
 * over, then `hit` only on the outcome that should count.
 */
export function peek(
  name: string,
  key: string,
  limit: number,
  now = Date.now(),
): RateResult {
  if (disabled()) return { ok: true, remaining: limit, retryAfter: 0 };
  const w = buckets.get(name)?.get(key);
  if (!w || w.resetAt <= now) return { ok: true, remaining: limit, retryAfter: 0 };
  if (w.count >= limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: limit - w.count, retryAfter: 0 };
}

/**
 * Record one attempt against `key` in `name`, and say whether it is allowed.
 *
 * A fixed window: `limit` attempts per `windowMs`, then refusals until the
 * window rolls over. Fixed rather than sliding because it is a third of the code
 * and the difference — a caller who times the boundary getting up to twice the
 * limit across it — does not matter for slowing password guesses.
 *
 * The attempt is counted whether or not it is allowed, so a caller that keeps
 * trying through a refusal only pushes its own reset further out.
 */
export function hit(
  name: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateResult {
  if (disabled()) return { ok: true, remaining: limit, retryAfter: 0 };
  sweep(now);
  let bucket = buckets.get(name);
  if (!bucket) {
    bucket = new Map();
    buckets.set(name, bucket);
  }

  const existing = bucket.get(key);
  if (!existing || existing.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
    };
  }
  return { ok: true, remaining: limit - existing.count, retryAfter: 0 };
}

/**
 * The caller's IP, as well as it can be known behind a proxy.
 *
 * Render (and most hosts) put the real address first in `x-forwarded-for`. The
 * header is attacker-settable in principle, but the platform overwrites it at
 * the edge, so the first entry is the connecting address rather than anything a
 * client chose. Falls back to a constant, which means "one shared bucket" — a
 * safe direction, since the worst it does is rate-limit an unknown-IP caller
 * slightly too eagerly rather than not at all.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** A 429 with a Retry-After, in the shape the routes already return errors in. */
export function tooMany(retryAfter: number) {
  return Response.json(
    { error: "TOO_MANY_REQUESTS" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
