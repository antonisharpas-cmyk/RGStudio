/**
 * The server's own clock.
 *
 * Next.js calls `register()` once when the server starts. It is the only hook
 * that runs without a request, which makes it the only place a clock can live.
 *
 * Why the clock is needed: the reminder sweep used to be nudged by ordinary
 * traffic — any visit to the timetable pushed the queue along. That is fine as a
 * backstop and useless as a mechanism, and the evidence was thirteen reminders
 * sitting unsent in a real database, the oldest from the previous day, because
 * nobody had happened to load the right page in the right minute. A reminder
 * that depends on somebody visiting the site is not a reminder: the member it is
 * for is, by definition, not visiting the site.
 *
 * ---
 *
 * Why it knocks on its own front door instead of calling the function.
 *
 * Next compiles this file for **every** runtime, edge included, and it follows
 * every import — including a dynamic one, and including one hidden behind a
 * runtime check that correctly returns first. Importing the sweep from here
 * therefore dragged `web-push` into an edge bundle, which dragged in
 * `https-proxy-agent`, which needs Node's `http`, which edge does not have. The
 * result was `Module not found: Can't resolve 'http'` and every page returning
 * 500 on the dev server — while `next build` was perfectly happy, which is the
 * worst kind of difference to have between the two.
 *
 * So this file imports nothing. It sends an HTTP request to the route that
 * already exists for exactly this job, which is compiled for the node runtime
 * like any other route. Two things fall out of that, both good: the module graph
 * from here is empty and cannot break again, and the timer now exercises the
 * *same* code path as the scheduled call a production host will make, rather
 * than a second one that could quietly drift away from it.
 */

/** Guards against a second timer when the dev server recompiles. */
declare global {
  // eslint-disable-next-line no-var
  var __rgSweep: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __rgBackup: NodeJS.Timeout | undefined;
}

const EVERY_MS = 60_000;

/**
 * How often the backup door is knocked on.
 *
 * Not the backup interval — that is six hours and lives in the route, which
 * checks a marker on the disk and answers "not due" the rest of the time. This
 * is only how often it is *asked*. Every fifteen minutes means a server that
 * came up part way through a window still takes its backup close to on time,
 * while the route's own clock guarantees at most one actual backup per six
 * hours however often this fires.
 */
const BACKUP_POKE_MS = 15 * 60_000;

export async function register() {
  /* Edge has no timers worth the name and no database. Node only. */
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  /* `next dev` re-evaluates modules on change. Without this, every edit would
     leave another timer running and a member would be reminded four times. */
  if (global.__rgSweep) return;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    /* Said once, loudly, rather than failing every sixty seconds in silence.
       The route refuses an unauthenticated caller — correctly, since otherwise
       anyone could make four hundred phones buzz — so with no secret there is
       no sweep, and the only symptom would be reminders never arriving. */
    console.warn(
      "[reminders] CRON_SECRET is not set, so nothing will sweep the queue. Run: npm run push:keys",
    );
    return;
  }

  /* Next sets PORT to whatever the server is actually listening on, including
     when it was chosen with -p. 127.0.0.1 rather than localhost: on a machine
     where localhost resolves to ::1 first, the request can go to a port nothing
     is listening on. */
  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/api/cron/reminders`;

  const tick = async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      if (!res.ok) {
        console.error(`[reminders] sweep refused: ${res.status}`);
        return;
      }
      const r = (await res.json()) as {
        due?: number;
        pushed?: number;
        emailed?: number;
        texted?: number;
        stale?: number;
      };
      if (r.due || r.stale) {
        console.log(
          `[reminders] ${r.due ?? 0} due · pushed ${r.pushed ?? 0} · emailed ${r.emailed ?? 0} · texted ${r.texted ?? 0}` +
            (r.stale ? ` · ${r.stale} too late, closed` : ""),
        );
      }
    } catch (e) {
      /* Logged rather than swallowed. The old code caught this silently, which
         is how a sweep that never worked went unnoticed for two days. */
      console.error("[reminders] sweep failed", (e as Error).message);
    }
  };

  global.__rgSweep = setInterval(tick, EVERY_MS);
  /* Do not hold the process open on account of a timer. */
  global.__rgSweep.unref?.();

  /* And shortly after startup, so a server that has just come up catches
     anything that fell due while it was down. Not immediately: the route it
     calls has to be compiled first, and on a cold dev server that takes a few
     seconds. */
  setTimeout(() => void tick(), 5_000);

  console.log(`[reminders] sweeping every ${EVERY_MS / 1000}s`);

  /**
   * The backup clock, on the same knock-on-a-door pattern.
   *
   * Its own route and its own timer because it runs on a different cadence and
   * does heavier work (a database snapshot, then an upload to Google), which has
   * no place on the every-minute reminder path. The route decides whether a
   * backup is actually due from a marker on the disk, so this can poke often and
   * cheaply without over-backing-up. Guarded, like the sweep, so a dev reload
   * does not leave two timers running.
   */
  if (!global.__rgBackup) {
    const backupUrl = `http://127.0.0.1:${port}/api/cron/backup`;
    const backupTick = async () => {
      try {
        const res = await fetch(backupUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
        });
        if (!res.ok) {
          console.error(`[backup] poke refused: ${res.status}`);
          return;
        }
        const r = (await res.json()) as {
          ran?: boolean;
          filename?: string;
          reason?: string;
          error?: string;
        };
        /* Silent on "not due", which is almost every poke. Loud on a real run
           and on a failure, because a backup nobody knows failed is the whole
           problem it exists to prevent. */
        if (r.error) console.error(`[backup] ${r.error}`);
        else if (r.ran) console.log(`[backup] done: ${r.filename}`);
      } catch (e) {
        console.error("[backup] poke failed", (e as Error).message);
      }
    };
    global.__rgBackup = setInterval(backupTick, BACKUP_POKE_MS);
    global.__rgBackup.unref?.();
    /* A little after the reminder catch-up, so the two cold-start requests do
       not land on the compiler at once. */
    setTimeout(() => void backupTick(), 20_000);
    console.log(`[backup] checking every ${BACKUP_POKE_MS / 60000} min`);
  }
}
