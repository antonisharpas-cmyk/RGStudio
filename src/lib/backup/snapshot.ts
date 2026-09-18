/**
 * A consistent copy of the database, ready to send somewhere safe.
 *
 * ---
 *
 * **Why not just copy the file.**
 *
 * The database is a single SQLite file, and the obvious backup is `cp rg.db
 * rg-backup.db`. It is also wrong, quietly. SQLite in WAL mode (which this app
 * uses) is writing to the file and a side `-wal` file at the same time the copy
 * is being read, so a plain copy taken mid-write is a *torn* file: it looks like
 * a database, opens like a database, and is missing the last few transactions or
 * is corrupt in a way nobody notices until the day it is the only copy left.
 *
 * SQLite ships the correct tool for exactly this, and better-sqlite3 exposes it:
 * `.backup()` performs an online backup that is transactionally consistent even
 * while the app keeps taking bookings. The output is a clean, standalone `.db`
 * that opens in anything — Navicat, another copy of this app, the `sqlite3` CLI.
 *
 * ---
 *
 * **Encryption is optional, and it is the honest default to offer.**
 *
 * The file contains members' names, emails, phones and their health notes.
 * Passwords inside it are already hashed and safe, but the personal data is
 * readable by anyone who opens the file. So if `BACKUP_ENCRYPT_PASSWORD` is set,
 * the snapshot is sealed with AES-256-GCM before it leaves the building, and
 * only that password opens it again (see scripts/backup-decrypt.mjs).
 *
 * Left unset, the snapshot is a plain `.db` that opens with a double-click. That
 * is the friendlier choice for analysis and the weaker one for privacy, and the
 * studio makes the call by whether it sets the password. The docs recommend
 * setting it; the code does not force it, because a backup nobody can open in a
 * hurry is its own kind of failure.
 */
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sqlite } from "@/db";

/** The magic header on an encrypted backup, so the decrypt tool can refuse a plain file clearly. */
const ENC_MAGIC = Buffer.from("RGPBK01", "utf8");

export type Snapshot = {
  /** The bytes to upload. */
  body: Buffer;
  /** What to call it in Drive, including the extension. */
  filename: string;
  /** Whether it is sealed. */
  encrypted: boolean;
  /** For the log line. */
  bytes: number;
};

/**
 * A UTC stamp that sorts and reads correctly: 2026-09-07-1430.
 *
 * UTC rather than studio time on purpose. A backup is an operational record, not
 * something a member reads, and naming files in a fixed zone means they sort in
 * the order they were taken no matter where the server runs or when the clocks
 * change.
 */
function stamp(now: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
  );
}

/**
 * Seal the bytes with a password nobody but the studio holds.
 *
 * scrypt turns the password into a key (slow on purpose, so a stolen file is not
 * brute-forced in an afternoon), AES-256-GCM encrypts and authenticates, and the
 * salt and IV travel with the file because they are not secrets — the password
 * is. Layout: MAGIC | salt(16) | iv(12) | authTag(16) | ciphertext.
 */
function seal(plain: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, salt, iv, tag, body]);
}

/**
 * Take the snapshot.
 *
 * Writes a consistent copy to a fresh temp file with better-sqlite3's `.backup()`,
 * reads it back, optionally seals it, and cleans the temp file up. The database
 * being backed up is the live one this process already holds open, so there is
 * no second connection to the disk and nothing to configure.
 */
export async function makeSnapshot(now = new Date()): Promise<Snapshot> {
  const dir = mkdtempSync(join(tmpdir(), "rg-backup-"));
  const tmp = join(dir, "snapshot.db");
  try {
    /* The online backup. Resolves once the copy is complete and consistent. */
    await sqlite.backup(tmp);

    /* Round-trip check: open the copy and read one integrity pragma before we
       trust it. A backup that does not open is worse than a loud failure,
       because it is discovered at the worst possible moment. */
    const check = new Database(tmp, { readonly: true });
    const ok = check.pragma("integrity_check", { simple: true });
    check.close();
    if (ok !== "ok") {
      throw new Error(`snapshot failed its integrity check: ${ok}`);
    }

    const plain = await readFile(tmp);
    const password = process.env.BACKUP_ENCRYPT_PASSWORD?.trim();
    const base = `rg-${stamp(now)}`;

    if (password) {
      const body = seal(plain, password);
      return { body, filename: `${base}.db.enc`, encrypted: true, bytes: body.length };
    }
    return { body: plain, filename: `${base}.db`, encrypted: false, bytes: plain.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The live database's size on disk, for the log line and a sanity check. */
export async function liveDbBytes(): Promise<number> {
  const file = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}
