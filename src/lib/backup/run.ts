/**
 * One backup, start to finish, plus the "is it time yet" clock.
 *
 * The route calls `maybeRunBackup` on a schedule and it decides whether enough
 * time has passed; a person testing calls `runBackupNow` to force one. Both end
 * up in `perform`, so the scheduled backup and the tested one are the same code.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  accessToken,
  driveConfig,
  ensureFolder,
  missingDriveConfig,
  pruneOld,
  uploadFile,
} from "./drive";
import { liveDbBytes, makeSnapshot } from "./snapshot";

export type BackupResult =
  | { ran: true; filename: string; bytes: number; encrypted: boolean; pruned: number; folder: string }
  | { ran: false; reason: string; nextInMinutes?: number };

/** Six hours by default; overridable, and floored at one so a typo cannot hammer Drive. */
function intervalHours(): number {
  const n = Number(process.env.BACKUP_INTERVAL_HOURS);
  return Number.isFinite(n) && n >= 1 ? n : 6;
}

/** How many copies to keep. Forty is about ten days at four a day. */
function keepCount(): number {
  const n = Number(process.env.BACKUP_KEEP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 40;
}

/**
 * Where the last-success time is remembered.
 *
 * A tiny file next to the database on the same persistent disk, so the schedule
 * survives a restart: a server that reboots at hour five does not start the six
 * hour clock again from zero and skip the backup, nor fire one immediately on
 * every deploy. Falls back to a temp path off a disk, where "forgets across
 * restarts" is an acceptable dev-only behaviour.
 */
function markerPath(): string {
  const dbFile = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");
  const dir = dbFile ? dirname(dbFile) : "";
  return join(dir || process.env.TMPDIR || "/tmp", "rg-last-backup.json");
}

async function readMarker(): Promise<number> {
  try {
    const raw = await readFile(markerPath(), "utf8");
    const at = (JSON.parse(raw) as { at?: number }).at;
    return typeof at === "number" ? at : 0;
  } catch {
    return 0;
  }
}

async function writeMarker(at: number) {
  await writeFile(markerPath(), JSON.stringify({ at, iso: new Date(at).toISOString() })).catch(
    () => {},
  );
}

/**
 * Do the work: snapshot, ensure the folder, upload, prune, remember the time.
 *
 * Any failure throws to the caller, which logs it. A backup that failed must be
 * loud: the whole point is the day it is needed, and a silent failure means the
 * studio believes it has copies it does not have.
 */
async function perform(): Promise<BackupResult> {
  const cfg = driveConfig();
  if (!cfg) {
    return {
      ran: false,
      reason: `not configured (missing ${missingDriveConfig().join(", ") || "credentials"})`,
    };
  }

  const snap = await makeSnapshot();
  const token = await accessToken(cfg);
  const folderId = await ensureFolder(token, cfg.folderName);
  await uploadFile(token, folderId, snap.filename, snap.body);

  /* Prune after a successful upload, never before: a failed upload must not also
     cost the studio one of the copies it already has. Best-effort. */
  let pruned = 0;
  try {
    pruned = await pruneOld(token, folderId, keepCount());
  } catch (e) {
    console.error("[backup] prune failed (harmless):", (e as Error).message);
  }

  await writeMarker(Date.now());
  return {
    ran: true,
    filename: snap.filename,
    bytes: snap.bytes,
    encrypted: snap.encrypted,
    pruned,
    folder: cfg.folderName,
  };
}

/** Force a backup regardless of the clock. For the manual test and the button. */
export async function runBackupNow(): Promise<BackupResult> {
  return perform();
}

/**
 * Run one only if the interval has elapsed since the last success.
 *
 * This is what the schedule calls. The clock lives here rather than in the timer
 * so that however often something pokes the route — every fifteen minutes, or
 * twice because two things pointed at it — a backup still happens at most once
 * per interval.
 */
export async function maybeRunBackup(): Promise<BackupResult> {
  if (!driveConfig()) {
    return {
      ran: false,
      reason: `not configured (missing ${missingDriveConfig().join(", ") || "credentials"})`,
    };
  }
  const last = await readMarker();
  const elapsed = Date.now() - last;
  const windowMs = intervalHours() * 60 * 60 * 1000;
  if (last > 0 && elapsed < windowMs) {
    return { ran: false, reason: "not due", nextInMinutes: Math.ceil((windowMs - elapsed) / 60000) };
  }
  return perform();
}

/** For the startup log line, so the operator can see the numbers in effect. */
export function backupSettings() {
  return {
    configured: Boolean(driveConfig()),
    intervalHours: intervalHours(),
    keep: keepCount(),
    encrypted: Boolean(process.env.BACKUP_ENCRYPT_PASSWORD?.trim()),
  };
}

export { liveDbBytes };
