/**
 * Open an encrypted backup, turning rg-….db.enc back into a plain rg-….db.
 *
 *     npm run backup:decrypt -- rg-2026-09-07-1430.db.enc
 *
 * Only needed if BACKUP_ENCRYPT_PASSWORD was set when the backup was taken. The
 * password is asked for on the terminal (never typed on the command line, where
 * a shell would remember it), and the plain .db it writes out opens directly in
 * Navicat or any SQLite tool.
 *
 * The format is the one scripts/../src/lib/backup/snapshot.ts writes:
 * MAGIC | salt(16) | iv(12) | authTag(16) | ciphertext, AES-256-GCM with a
 * scrypt-derived key. GCM authenticates, so a wrong password or a damaged file
 * fails loudly rather than producing quiet garbage.
 */
import { createDecipheriv, scryptSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const MAGIC = Buffer.from("RGPBK01", "utf8");

const input = process.argv[2];
if (!input) {
  console.error("\n  Usage: npm run backup:decrypt -- <file.db.enc>\n");
  process.exit(1);
}

function askPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  /* Mute the echo so the password does not appear on screen. */
  const out = process.stdout;
  const write = out.write.bind(out);
  return new Promise((resolve) => {
    process.stdout.write("  Password: ");
    let muted = true;
    out.write = (chunk, ...a) => (muted ? true : write(chunk, ...a));
    rl.question("", (answer) => {
      out.write = write;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
    /* readline still needs the newline echoed; keep it muted until then. */
    void muted;
  });
}

async function main() {
  const blob = await readFile(input);
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    console.error(
      "\n  This does not look like an encrypted RG Pilates Studio backup. If the file already\n" +
        "  ends in .db it is not encrypted — just open it directly.\n",
    );
    process.exit(1);
  }
  const password = String(await askPassword()).trim();
  if (!password) {
    console.error("\n  No password given.\n");
    process.exit(1);
  }

  let p = MAGIC.length;
  const salt = blob.subarray(p, (p += 16));
  const iv = blob.subarray(p, (p += 12));
  const tag = blob.subarray(p, (p += 16));
  const body = blob.subarray(p);

  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  let plain;
  try {
    plain = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    console.error(
      "\n  Could not open it. The password is wrong, or the file is damaged.\n",
    );
    process.exit(1);
  }

  const out = input.replace(/\.enc$/, "");
  await writeFile(out, plain);
  console.log(`\n  Done. Wrote ${out} — open it in Navicat or any SQLite tool.\n`);
}

main().catch((e) => {
  console.error("\n  Failed:", e.message, "\n");
  process.exit(1);
});
