# Backups to Google Drive

Every six hours the site takes a consistent copy of its database and uploads it
into a folder in the studio's own Google Drive, owned by the studio. This is the
copy that protects you against losing Render itself, and it doubles as the file
you open in Navicat for analysis.

You set it up once per company. It is about fifteen minutes in Google, then three
values pasted into Render.

---

## What you end up with

- A folder in the company's Google Drive called **RG Pilates Studio backups**, filling
  with files named `rg-2026-09-07-1430.db` (or `.db.enc` if you turn on
  encryption). Four a day, the oldest deleted so it never grows without bound.
- Each file is the whole database — every member, booking, payment, note — and it
  opens directly in Navicat (choose SQLite, point it at the file) or in another
  copy of this app.
- Nothing on the website depends on any of this. If backups are switched off the
  site runs exactly the same; it just stops keeping the off-site copy.

---

## The one-time Google setup

You need a Google account for the company — the business Gmail whose Drive the
backups should live in.

### 1. Make a Google Cloud project

1. Go to <https://console.cloud.google.com> and sign in as the company account.
2. Top bar, the project dropdown, **New Project**. Name it something like
   `RG Pilates Studio backups`. Create it, then make sure it is selected.

### 2. Turn on the Drive API

1. Left menu (or the search bar): **APIs & Services → Library**.
2. Search **Google Drive API**, open it, **Enable**.

### 3. Set up the consent screen (the "Google Auth Platform")

In the current console this lives under **APIs & Services → OAuth consent
screen**; the first time, press **Get started**. It is a set of tabs — Branding,
Audience, Data access, Clients.

1. **Branding / Get started**: App name `RG Pilates Studio backup`, user support email
   the company address, audience **External**, a contact email, agree, Create.
2. **Data access** tab → **Add or remove scopes**. Filter for `drive.file`, tick
   `.../auth/drive.file` ("See, edit, create and delete only the specific Google
   Drive files you use with this app"). Update, then Save.
3. **Audience** tab → **Publish app** → Confirm, so the status becomes **In
   production**. This matters: while an app is in *Testing* the refresh token
   expires after seven days and backups would quietly stop after a week.
   Published, it does not expire.
   - Google may say the app is unverified. That is fine for a private tool like
     this — you will see one "Google hasn't verified this app" screen when you
     grant access in Part 2, and you click **Advanced → Go to RG Pilates Studio backup
     (unsafe)** to proceed. It is your own app; the warning is only because you
     have not paid Google to review it, which you do not need to.

### 4. Create the OAuth client

1. **Clients** tab (or **APIs & Services → Credentials**) → **Create client**.
2. Application type **Web application**. Name it `RG backup client`.
3. Under **Authorised redirect URIs**, Add URI, and paste **exactly**:

   ```
   http://localhost:53682/callback
   ```

   This must match the tool in Part 2 character for character — same port, the
   `/callback` on the end, `http` not `https`.
4. Create. Google shows a **client ID** and a **client secret**. Copy both
   somewhere safe (the secret especially — you can download the JSON). You need
   them in Part 2.

> **Web application** rather than Desktop app on purpose: the new UI lets you see
> and set the redirect URI on a Web client, so you can confirm it matches the
> tool exactly. A Desktop-app client also works (it allows any `localhost`
> redirect automatically) but hides the field, which is one more thing to get
> wrong.

### 5. Get the refresh token

On your own computer, in the project folder:

1. Put the client id and secret into `.env`:

   ```
   GDRIVE_CLIENT_ID=....apps.googleusercontent.com
   GDRIVE_CLIENT_SECRET=....
   ```

2. Run:

   ```
   npm run drive:auth
   ```

3. It prints a URL. Open it, sign in **as the company account**, click through
   the unverified-app warning (Advanced → Go to …), and press **Allow**.
4. The terminal prints a **refresh token**. That is the durable credential.

---

## Putting it into Render

In the Render dashboard, the web service, **Environment**, set:

| Key | Value |
| --- | --- |
| `GDRIVE_CLIENT_ID` | the client id from step 4 |
| `GDRIVE_CLIENT_SECRET` | the client secret from step 4 |
| `GDRIVE_REFRESH_TOKEN` | the token `npm run drive:auth` printed |
| `BACKUP_ENCRYPT_PASSWORD` | a password you choose (recommended — see below) |

`BACKUP_FOLDER_NAME`, `BACKUP_INTERVAL_HOURS` and `BACKUP_KEEP` already have
sensible defaults in the blueprint; leave them unless you want to change the
folder name, the frequency, or how many copies are kept.

Save. Render redeploys. Within a few minutes the first backup appears in the
Drive folder, and then every six hours after.

### Should you set the encryption password?

The backup holds members' health notes. With a password, a copy sitting in Drive
is unreadable to anyone who does not have that password — so even if someone got
into the Google account, the backups would be sealed. Without one, the file opens
with a double-click, which is friendlier for analysis and less private.

The recommendation is to **set it**. Write the password down somewhere safe and
separate from the Google account, because:

- to analyse an encrypted backup you first run `npm run backup:decrypt -- <file>`,
  which asks for the password and writes a plain `.db` beside it;
- **if you lose the password, the encrypted backups cannot be opened by anyone,
  ever.** That is the point of encryption and also its one danger.

---

## Testing it, and using a backup

**Confirm it works**, once, after setting the credentials. On your own machine,
with the four `GDRIVE_*` (and optional password) values in `.env`:

```
npm run backup:now
```

It runs the exact same code the schedule uses and uploads one file. Check the
Drive folder — it should be there.

**To dig into the numbers**, download any backup from Drive, and:

- if it ends in `.db` — open it in Navicat (SQLite) directly.
- if it ends in `.db.enc` — run `npm run backup:decrypt -- rg-….db.enc`, enter
  the password, and open the `.db` it writes out.

**If Render ever disappeared entirely**, the newest backup file *is* the studio.
The same app can be deployed anywhere and pointed at that file, and everything is
back. That is the whole reason the copy lives in a place you control.

---

## For several companies later

Each company's backups go into *their own* Google account, so each one needs its
own `GDRIVE_REFRESH_TOKEN` (step 5, signed in as that company) set on that
company's Render service. You can reuse one Google Cloud project and one OAuth
client across all of them — only the refresh token is per-company, because only
it decides whose Drive is written to.

The files are tiny, so storage is never the issue: ten companies' backups are a
few hundred megabytes, which fits many times over in a free Drive. What scales is
the list of tokens, one per company, each in its own place.
