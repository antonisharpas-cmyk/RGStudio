/**
 * Run a backup right now, outside the schedule.
 *
 *     npm run backup:now              snapshot and upload to Drive
 *     npm run backup:now -- --dry     snapshot to ./backups locally, no upload
 *
 * The real run is the same code the six-hour schedule uses, so a green run here
 * proves the whole path: the credentials work, the folder is reachable, the file
 * lands in the company's Drive. Use it once, straight after setting the
 * credentials, to confirm before trusting the schedule.
 *
 * `--dry` skips Google entirely and writes the snapshot to a local `backups/`
 * folder instead — for checking the snapshot and, if a password is set, the
 * encryption, with no Google setup at all.
 *
 * It runs against the same DATABASE_URL the app uses, which on the studio's own
 * machine is the local dev.db. To back up production you do not run anything: the
 * server does it itself every six hours. This is for testing and for an
 * on-demand extra copy.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { makeSnapshot } from "@/lib/backup/snapshot";
import { runBackupNow } from "@/lib/backup/run";

/* Load .env so the GDRIVE_* values (and any BACKUP_ENCRYPT_PASSWORD) are picked
   up when this is run by hand on the studio's own machine. Node 20.6+ has this
   built in; the try/catch means a machine with no .env (or an older Node) just
   falls back to whatever is already in the environment, which is how the live
   server runs. Real environment variables always win over the file. */
try {
  process.loadEnvFile(".env");
} catch {
  /* No .env, or a Node without loadEnvFile — use the ambient environment. */
}

const dry = process.argv.includes("--dry") || process.argv.includes("--dry-run");

async function main() {
  if (dry) {
    const snap = await makeSnapshot();
    await mkdir("backups", { recursive: true });
    const out = `backups/${snap.filename}`;
    await writeFile(out, snap.body);
    console.log(
      `\n  Dry run. Wrote ${out} (${(snap.bytes / 1024).toFixed(0)} KB` +
        `${snap.encrypted ? ", encrypted" : ""}). Nothing was uploaded.\n`,
    );
    return;
  }

  const r = await runBackupNow();
  if (r.ran) {
    console.log(
      `\n  Done. Uploaded ${r.filename} (${(r.bytes / 1024).toFixed(0)} KB` +
        `${r.encrypted ? ", encrypted" : ""}) to "${r.folder}" in the company's Drive.` +
        (r.pruned ? ` Pruned ${r.pruned} old copies.` : "") +
        "\n",
    );
  } else {
    console.error(`\n  Did not run: ${r.reason}\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n  Backup failed:", (e as Error).message, "\n");
  process.exit(1);
});
