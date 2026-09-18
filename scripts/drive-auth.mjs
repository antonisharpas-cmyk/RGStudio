/**
 * The one-time handshake that lets the studio's server write to a Google Drive.
 *
 *     npm run drive:auth
 *
 * Run it once per company, on your own computer, after you have created the
 * OAuth client in Google (see docs/backup.md). It:
 *
 *   1. opens a Google sign-in page in your browser,
 *   2. you sign in as the company whose Drive the backups should go to, and
 *      press Allow,
 *   3. catches Google's reply on a local port, swaps it for a refresh token,
 *   4. prints that refresh token.
 *
 * You then paste the printed token into Render as GDRIVE_REFRESH_TOKEN. That is
 * the durable credential; nothing else from this run is kept, and the token is
 * never shown to anyone but you, in your own terminal.
 *
 * ---
 *
 * **Why a local web server and not a code to copy.**
 *
 * Google retired the old "copy this code out of the browser" flow. The supported
 * way for a tool like this is a loopback redirect: Google sends the reply to
 * http://localhost on your own machine, which nothing outside your computer can
 * reach, and this script listens there for the one request. It shuts the server
 * the moment it has the token.
 *
 * The client id and secret come from the environment or from a .env file, so the
 * secret is never typed on a command line where a shell would remember it.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

/* Read GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET from the environment, falling
   back to .env so nobody has to export them by hand for a one-off. */
function fromEnvOrDotenv(key) {
  if (process.env[key]) return process.env[key].trim();
  try {
    const line = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    const v = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    return v || "";
  } catch {
    return "";
  }
}

const clientId = fromEnvOrDotenv("GDRIVE_CLIENT_ID");
const clientSecret = fromEnvOrDotenv("GDRIVE_CLIENT_SECRET");

if (!clientId || !clientSecret) {
  console.error(
    "\n  Missing GDRIVE_CLIENT_ID or GDRIVE_CLIENT_SECRET.\n" +
      "  Create the OAuth client in Google first (docs/backup.md), then put the\n" +
      "  two values in .env, or set them in your shell, and run this again.\n",
  );
  process.exit(1);
}

/* The narrowest scope that can write: access only to files this app creates.
   It cannot read anything else in the company's Drive. */
const SCOPE = "https://www.googleapis.com/auth/drive.file";

/* Loopback on a fixed port. It must be listed as an authorised redirect URI on
   the OAuth client in Google, exactly as written here. */
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/callback`;
const state = randomBytes(16).toString("hex");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    /* offline + consent is what makes Google return a *refresh* token, and
       return it every time rather than only on the very first authorisation. */
    access_type: "offline",
    prompt: "consent",
    state,
  });

async function exchange(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  return res.json();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (!url.pathname.startsWith("/callback")) {
    res.writeHead(404).end("not here");
    return;
  }
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const done = (msg) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<html><body style="font-family:system-ui;padding:3rem;max-width:32rem">` +
        `<h2>RG Pilates Studio backup</h2><p>${msg}</p>` +
        `<p>You can close this tab and go back to the terminal.</p></body></html>`,
    );
  };

  if (error) {
    done(`Google returned an error: ${error}. Nothing was set up.`);
    console.error(`\n  Google returned: ${error}\n`);
    server.close();
    process.exit(1);
  }
  if (returnedState !== state) {
    done("The reply did not match this request and was ignored. Please run the command again.");
    server.close();
    process.exit(1);
  }

  const token = await exchange(code);
  if (!token.refresh_token) {
    done("Google did not return a refresh token. Please run the command again.");
    console.error(
      "\n  No refresh token came back. This usually means the account has authorised\n" +
        "  this app before. Remove RG Pilates Studio from https://myaccount.google.com/permissions\n" +
        "  for that account and run `npm run drive:auth` again.\n",
    );
    server.close();
    process.exit(1);
  }

  done("All set. Your refresh token is in the terminal.");
  console.log(
    "\n  Success. Paste this into Render as GDRIVE_REFRESH_TOKEN (and keep it secret):\n\n" +
      `    ${token.refresh_token}\n\n` +
      "  It does not expire as long as the OAuth app is published to production\n" +
      "  and the account does not revoke it. Nothing else from this run is kept.\n",
  );
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(
    "\n  Open this URL in your browser and sign in as the company whose Drive the\n" +
      "  backups should go to:\n\n" +
      `    ${authUrl}\n\n` +
      `  Waiting for Google to reply on ${REDIRECT} ...\n`,
  );
});
