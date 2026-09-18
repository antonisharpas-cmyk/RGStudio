import { NextResponse } from "next/server";
import { desk } from "@/lib/api-guard";
import { maybeRunBackup, runBackupNow } from "@/lib/backup/run";

/**
 * The backup, on a schedule.
 *
 *   curl -X POST -H "authorization: Bearer $CRON_SECRET" \
 *        https://<the site>/api/cron/backup
 *
 * A separate door from /api/cron/reminders on purpose. The reminder route is
 * poked every minute and must stay light; a backup that snapshots the database
 * and talks to Google over the network has no business on that hot path, and it
 * runs on a different clock (every six hours, not every two minutes). Its own
 * route also keeps `@googleapis`-shaped work — here, plain fetch — out of the
 * reminder route's module graph, the same care instrumentation.ts takes.
 *
 * Two ways in, like the reminder sweep: the shared secret for the machine, or a
 * signed-in member of staff for a person testing it. Open, this would let
 * anyone trigger an unbounded run of snapshots and uploads.
 *
 * `?force=1` (or `{ force: true }`) runs a backup regardless of the clock, for
 * the manual test and the owner console's button. Without it the route respects
 * the six-hour window and answers "not due" cheaply — which is what the timer
 * calls, so the interval is enforced no matter how often it is poked.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const offered = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const bySecret = Boolean(secret) && offered === secret;

  if (!bySecret) {
    const gate = await desk();
    if ("res" in gate) return gate.res;
  }

  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { force?: boolean } | null;
  const force = url.searchParams.get("force") === "1" || body?.force === true;

  try {
    const result = force ? await runBackupNow() : await maybeRunBackup();
    if (result.ran) {
      console.log(
        `[backup] uploaded ${result.filename} (${(result.bytes / 1024).toFixed(0)} KB` +
          `${result.encrypted ? ", encrypted" : ""}) to "${result.folder}"` +
          (result.pruned ? ` · pruned ${result.pruned} old` : ""),
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[backup] failed:", (e as Error).message);
    return NextResponse.json({ ran: false, error: (e as Error).message }, { status: 500 });
  }
}
