/**
 * Putting a file into the studio's own Google Drive, over plain HTTPS.
 *
 * ---
 *
 * **Why no Google library.**
 *
 * The whole conversation with Drive is three REST calls — swap a refresh token
 * for a short-lived access token, find or make a folder, upload a file — and
 * every one of them is a `fetch`. Pulling in `googleapis` (tens of megabytes,
 * its own release cycle, a native-ish dependency tree) to save writing those
 * three calls is a bad trade on a small server. So this file has no
 * dependencies at all beyond `fetch`, which Node has built in.
 *
 * ---
 *
 * **Whose Drive, and how little access it has.**
 *
 * The credentials belong to an OAuth client the studio created once, and the
 * refresh token was granted by the company's own Google account signing in and
 * pressing Allow (see scripts/drive-auth.mjs). So the upload happens *as that
 * company*, into *their* Drive, and every file is owned by them and counts
 * against their storage — which is exactly what "the data lives in their own
 * Google account" means.
 *
 * The scope is `drive.file`, the narrowest one that can write: it grants access
 * only to files this app itself created. It cannot read, list, or touch anything
 * else in the company's Drive. So even though the app can drop a backup in, it
 * could never rifle through their documents, and the consent screen says so.
 *
 * A service account was the obvious alternative and does not work here: a service
 * account has no Drive storage of its own, so a file it uploads into a normal
 * Gmail account is refused with `storageQuotaExceeded`. Acting as the real user
 * is the path that works on an ordinary business Gmail.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export type DriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The folder the backups go into, created on first use. */
  folderName: string;
};

/**
 * Read the configuration from the environment, or say why it is not there.
 *
 * Returns null rather than throwing when nothing is configured, so a deploy that
 * has not set backups up yet is a no-op with one clear log line, not a crash on
 * a timer. The three secrets are all-or-nothing: one or two set is a
 * half-configured backup, which is worse than none because it looks done.
 */
export function driveConfig(): DriveConfig | null {
  const clientId = process.env.GDRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN?.trim();
  const folderName = process.env.BACKUP_FOLDER_NAME?.trim() || "RG Pilates Studio backups";
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, folderName };
}

/** Which of the three secrets are missing, for a log line that tells the truth. */
export function missingDriveConfig(): string[] {
  const need = [
    ["GDRIVE_CLIENT_ID", process.env.GDRIVE_CLIENT_ID],
    ["GDRIVE_CLIENT_SECRET", process.env.GDRIVE_CLIENT_SECRET],
    ["GDRIVE_REFRESH_TOKEN", process.env.GDRIVE_REFRESH_TOKEN],
  ] as const;
  return need.filter(([, v]) => !v?.trim()).map(([k]) => k);
}

/**
 * Trade the long-lived refresh token for a short-lived access token.
 *
 * The refresh token is the durable credential and never leaves the environment;
 * the access token it mints lasts about an hour and is used for the calls below.
 * If Google refuses here, the message is passed through, because the two things
 * that go wrong — a revoked token, or an app still in "testing" whose tokens
 * expire after a week — both say so in that response, and both need the studio
 * to re-run the one-time auth rather than anything in the code.
 */
export async function accessToken(cfg: DriveConfig): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google refused the refresh token (${res.status}): ${data.error ?? "unknown"}` +
        (data.error_description ? ` — ${data.error_description}` : "") +
        ". Re-run `npm run drive:auth` to grant a fresh one.",
    );
  }
  return data.access_token;
}

type DriveFile = { id: string; name: string; createdTime?: string };

/**
 * Find the backup folder, or make it.
 *
 * With `drive.file` this only ever sees folders this app created, so the query
 * cannot collide with a folder of the same name the company made themselves —
 * it is looking in its own small world. First match wins; a folder created once
 * is reused forever after.
 */
export async function ensureFolder(token: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
  );
  const found = await fetch(`${API}/files?q=${q}&fields=files(id,name)&pageSize=1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const list = (await found.json().catch(() => ({}))) as { files?: DriveFile[] };
  if (list.files?.[0]?.id) return list.files[0].id;

  const made = await fetch(`${API}/files?fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = (await made.json().catch(() => ({}))) as DriveFile & { error?: unknown };
  if (!made.ok || !folder.id) {
    throw new Error(`Could not create the Drive folder "${name}": ${made.status} ${JSON.stringify(folder)}`);
  }
  return folder.id;
}

/**
 * Upload one file into the folder.
 *
 * A multipart upload: a small JSON part naming the file and its parent, then the
 * bytes. Fine for a file this size — Drive's resumable upload is for large media
 * and would be three round-trips to move a few megabytes.
 */
export async function uploadFile(
  token: string,
  folderId: string,
  filename: string,
  body: Buffer,
): Promise<DriveFile> {
  const boundary = `rgp${randomBoundary()}`;
  const meta = JSON.stringify({ name: filename, parents: [folderId] });
  const pre = Buffer.from(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const post = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const multipart = Buffer.concat([pre, body, post]);

  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id,name,createdTime`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  const file = (await res.json().catch(() => ({}))) as DriveFile & { error?: unknown };
  if (!res.ok || !file.id) {
    throw new Error(`Upload of ${filename} failed: ${res.status} ${JSON.stringify(file)}`);
  }
  return file;
}

/**
 * Keep the newest `keep` backups in the folder and delete the rest.
 *
 * Every 6 hours is four a day, so without this the folder grows forever. Keeping
 * a bounded window is the point of a rolling backup: enough history to go back a
 * week or two, not a decade of files nobody will ever open. Only ever touches
 * files this app made, and only inside its own folder.
 *
 * Deliberately best-effort: a failure to prune is logged and swallowed by the
 * caller, because an old file left lying around is a tidiness problem, and a
 * backup that refused to complete because the *cleanup* failed is a real one.
 */
export async function pruneOld(token: string, folderId: string, keep: number): Promise<number> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await fetch(
    `${API}/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=1000`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const list = (await res.json().catch(() => ({}))) as { files?: DriveFile[] };
  const files = list.files ?? [];
  const doomed = files.slice(keep);
  let removed = 0;
  for (const f of doomed) {
    const del = await fetch(`${API}/files/${f.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (del.ok) removed++;
  }
  return removed;
}

function randomBoundary() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
