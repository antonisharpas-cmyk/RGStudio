# Notifications — push, email and SMS

Everything below already works. What is missing is accounts with two companies,
and one command you run once. Until then the site behaves exactly as it will
afterwards, except the emails and texts go to a log instead of to people.

---

## What a new member gets

Signing up requires agreeing to **studio and timetable notices** — a class
cancelled, the studio shut, the timetable changed. That is a condition of holding
an account, because a member who is not told their class is off has been let down
by the studio, not spared an interruption.

Straight after registering, their Notifications screen reads:

| Channel  | State                | Can they change it?                          |
| -------- | -------------------- | -------------------------------------------- |
| **Push** | **Always on**        | Not in the app — see the honest bit below     |
| Email    | On                   | Yes, they can turn it off                     |
| SMS      | Off                  | Yes, they can turn it on                      |

And **offers, news and new class types** is unticked. Nothing marketing-shaped
reaches them until they tick it.

**Accepting offers switches SMS on.** Somebody who has just said they want to
hear about offers and new classes should not have to hunt for a second switch,
and a text is the channel that reliably arrives. It happens on the transition
only: a member who accepts offers and then turns SMS off stays off, because from
that point the choice is theirs and the studio should not keep overruling it.
Note the cost implication — more members with SMS on means more members reachable
by a paid channel, so keep an eye on the SMS reach figure at the desk.

## The honest bit about "push can't be turned off"

The studio's side of push is genuinely always on: there is no switch in the app,
and the server refuses a request that tries to turn it off, so an edited payload
cannot do what the screen does not offer.

What no website can do is make the *browser* deliver it. Push requires the member
to grant permission on each device, and they — or their phone's settings — can
withdraw it at any time without telling us. So:

- A member who has never granted permission has no device registered. Push skips
  them silently; they still see the notice in the app with the count on their
  photograph.
- **On iPhone, web push only works once the site has been added to the Home
  Screen.** Safari will not even offer the prompt before that. This matters in
  Cyprus, where a large share of members are on iPhones. On such a browser the
  push box simply does not appear — there is no button that could work, so there
  is nothing shown to press.
- Chrome on Android, and desktop Chrome/Edge/Firefox, work straight away.

Push is therefore best understood as: *we always try, and it costs nothing when
it works.* The in-app notice is the channel that never fails.

---

## What you need to set up

### 1. Push — no account, no bill, one command

```bash
npm run push:keys
```

That writes the keys into `.env` itself — there is nothing to copy. Restart the
server and it is done. There is no company in the middle: the message goes from
your server straight to Google's, Apple's or Mozilla's push service, signed with
a key pair that belongs to the studio.

It also generates `CRON_SECRET` while it is there, which the reminder sweep needs.
Use `npm run push:keys -- --print` if you would rather paste the lines yourself.

Two rules:

- **Keep the keys.** Regenerating them silently cuts off every device that has
  already subscribed — no error, the notifications just stop. The command refuses
  to overwrite an existing pair unless you pass `--force`.
- **`VAPID_PRIVATE_KEY` is a secret.** Not in git, not in a chat window.

Push also requires the site to be served over **HTTPS** (localhost is exempt for
development). Any normal hosting gives you that.

### 2. Email — a mailbox you already own, or a provider

Three routes, and they differ in what they ask of you *before* they will send
anything. Start at the top; move down when the studio outgrows it.

#### The quick one: an existing mailbox (`smtp`)

This signs in to an ordinary mailbox and sends as it — the same credentials a
mail client uses. **Nothing about the domain changes, no DNS records are added.**
It is running in the ten minutes it takes to create an app password.

For `info@rgpilatesstudio.com`, the studio's Google mailbox:

1. The mailbox needs 2-Step Verification on — Google will not issue an app
   password without it. <https://myaccount.google.com/security>
2. Then **App passwords** → create one → Google shows 16 characters in four
   groups. Copy them; the spaces do not matter.
3. In `.env`:

```
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=info@rgpilatesstudio.com
SMTP_PASS=xxxxxxxxxxxxxxxx
EMAIL_FROM="RG Pilates Studio <info@rgpilatesstudio.com>"
```

4. Restart, then:

```bash
npm run email:test -- you@example.com
```

That sends one real message and prints the entire conversation with the mail
server. It is there because "the email did not arrive" has six causes and an
empty inbox cannot tell you which: a wrong app password says `535`, sending as
the wrong mailbox says `550`, a blocked port says nothing at all and times out.
Each has a different fix.

**Two rules this route imposes**, both enforced by the mail server rather than by
us, and both checked by `npm run doctor`:

- **`SMTP_USER` and the address in `EMAIL_FROM` must be the same mailbox.** No
  mail server will let you send as somebody else — that is the one thing they all
  exist to prevent. An alias the mailbox owns is fine.
- **The app password, never the account password.** Google rejects the real one.

**And one limit worth knowing before it bites.** A mailbox is not a bulk sender.
Google allows roughly 2,000 messages a day on a Workspace account and throttles
bursts, so booking and payment confirmations — a handful an hour — sit
comfortably inside it, while a single announcement to 400 members is at the edge
of what it tolerates. That is the point at which you move to the next route.

If port 465 is blocked (some office networks and ISPs do block it), try
`SMTP_PORT=587`, which starts unencrypted and upgrades. Both are supported and
both are encrypted before the password is sent — a server that refuses to
upgrade is refused in turn rather than being handed the credentials anyway.

#### The proper one: a sending provider

Built to send thousands, reports bounces, does not throttle. **Resend** (simplest,
generous free tier):

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxx
EMAIL_FROM="RG Pilates Studio <info@rgpilatesstudio.com>"
```

or **Brevo**, which does SMS too, so one account covers both:

```
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-xxxxxxxx
EMAIL_FROM="RG Pilates Studio <info@rgpilatesstudio.com>"
```

Either way the important part is not the API key — it is **verifying the sending
domain**. The provider gives you two or three DNS records (SPF, DKIM, usually a
DMARC suggestion) to add wherever the domain is managed. Without them mail either
bounces or lands in spam, which is worse than not sending it: the studio would
believe forty people had been told about a cancelled class.

This is the route that needs a domain, and it is why the `smtp` route exists —
an existing mailbox's domain is already trusted to send its own mail.

Do not use a Gmail or Hotmail address as the `From` with a provider. Google and
Microsoft publish rules that make other providers reject it.

#### The address, and why it is the studio's own

Until September 2026 this ran from `info@ergonsite.com`, the builder's mailbox,
and that was always meant to be temporary. A member receiving mail whose display
name says RG Pilates Studio and whose address says somebody else's domain is looking
at exactly the shape of a phishing email — and the message is telling them their
class is cancelled or that they have been charged €200, which is precisely the
mail you most need believed.

The studio now has `info@rgpilatesstudio.com`, so the display name and the
address agree and that problem is gone. It is the address a member sees in the
footer, the address mail arrives from, and the address a reply lands in.
One mailbox doing all three is not laziness: a member who hits reply on a
booking confirmation should reach the studio, and any arrangement where they do
not is one the studio will find out about from a complaint rather than from a
setting.

The one thing still worth doing eventually: if the studio outgrows a mailbox and
moves to Resend or Brevo, that domain needs its own SPF and DKIM records. Not
today, and nothing is broken without them while the route is `smtp`.

#### Which messages actually use it

Configuring a provider does not mean every message emails. Which ones do is the
`SENDS` table in `src/lib/messaging/events.ts` — currently the payment receipt
only — plus whatever the desk ticks when it sends a notice. See *Every message
the studio sends* below.

### 3. SMS — SMS.to, a sender name, and a real cost

The studio's provider is **SMS.to** — a Cyprus company, so a euro invoice, a
Cyprus route and support in the same timezone. About **€0.02** a message, against
roughly €0.074 for Twilio at the same destination.

```
SMS_PROVIDER=smsto             # log | smsto | twilio | brevo
SMSTO_API_KEY=xxxxxxxx
SMS_SENDER=RGPILATES         # 11 characters maximum
SMS_PRICE_PER_SEGMENT=0.02     # so the desk sees euros, not only a count
SMS_MAX_SEGMENTS=4             # the guard on an accidental blast
```

**Turning it on is one line.** Everything works before the account exists:
`SMS_PROVIDER=log` runs the whole pipeline, fills in the desk's counts, writes
the history and prints each message to the server console. Change `log` to
`smsto`, paste the key, restart. Change it back to stop dead.

Twilio and Brevo are still there, unchanged, in case the studio ever moves. That
is the point of four transports rather than one: the day a provider raises its
price or loses a route should be an afternoon, not a rewrite.

#### The sender is a name, not a number

`RGPILATES` appears in the recipient's inbox where a phone number would be. It
costs nothing, and it beats an unrecognised +357 that reads as spam. Two things
follow from it:

- **It must be whitelisted with SMS.to before the first send.** Their
  documentation says Cyprus requires this; Messente and Vonage both say Cyprus
  needs no pre-registration. Either way it is a support ticket rather than a
  regulator filing — but ask about the lead time, because discovering it takes
  three days is fine in July and a disaster on opening week.
- **It is strictly one-way.** There is no number, so a member cannot reply and
  **"reply STOP" cannot work**. The opt-out is the switch in their account. If
  the studio ever wants replies, SMS.to rent virtual Cyprus numbers — that is the
  real reason to pay for one, not the sending.

#### Greek costs three times English, and both costs five

This is the part that surprises people, so the desk is told rather than trusted
to know. An SMS is billed per **segment**, and the segment size depends on the
alphabet:

| | Characters per segment |
| --- | --- |
| Latin | **160** (153 once it splits) |
| Anything with one Greek letter | **70** (67 once it splits) |

There is no partial penalty. One `ά` in an otherwise English message re-encodes
the whole thing, English half included. So for a ~140-character announcement:

| What goes out | Segments each | Relative cost |
| --- | --- | --- |
| English | 1 | ×1 |
| Greek | 3 | ×3 |
| **Both in one message** | **5** | **×5** |

Both-languages is not double. It is five times, because the English half is
billed at Greek prices — which is why the desk defaults to English and gets a
warning when it picks Greek.

#### What the desk sees

Ticking SMS opens a panel with three language buttons and a **preview of the
message as it will arrive** — sender name and all — with the cost under it:

```
106 characters · one message holds 160 · 26 billed to 26 people ≈ €0.52
Everyone gets one text. Billed as 1 message each.
```

Two numbers, said separately on purpose, because conflating them is what confuses
people. **The member always receives one text**, however long it is: the network
splits a long message into pieces and the handset stitches them back together
before showing it. The invoice counts the pieces. So past 160 characters it reads:

```
Everyone still sees one text, but it is billed as 2 messages each.
Drop 22 characters to make it 1.
```

"Billed as 2 each" is a true statement nobody can act on. "Drop 22 characters" is
the same fact as an instruction, so it gets read.

**There is nothing to fill in.** The text follows the message the desk already
wrote — an earlier version of this had its own empty box, which meant typing the
same announcement twice, and the second copy is the one that gets forgotten.

The preview is **always** visible, editing or not. That matters most for *Both*,
where the interesting question is not what the two texts say but how they read
stacked in one message — so the preview shows exactly that, English then a blank
line then Greek, which is what arrives.

If different words are wanted on a lock screen than on a screen, *Change the
wording* opens **one box per language actually going out, each named**: English
alone shows one box, Greek alone shows one box, Both shows two. Each starts
pre-filled with what was about to be sent, so changing three words is changing
three words — except the Greek box when no Greek has been typed upstairs, which
starts empty rather than pre-filled with English, since a box labelled Greek
containing English words invites somebody to send exactly that.

*Use the message above* clears the override and goes back to following. Cleared
rather than hidden, so there is never a stale draft lurking behind a closed
panel.

Past `SMS_MAX_SEGMENTS` the send is **refused by the server**, not just warned
about in the screen, and refused *before* the notice is written so the desk can
shorten it and send once. A screen is a suggestion; this one has an invoice
attached.

#### Running out of credit

The silent failure: credit hits zero, every send fails, and nothing on the site
looks different. `npm run doctor` reports the SMS.to balance and warns under €2.
The balance endpoint is unverified — there is no account yet — so it reports
"could not read the balance" rather than inventing a number.

Numbers are normalised automatically: a member typing `99 123 456` becomes
`+35799123456`. Set `SMS_DEFAULT_COUNTRY` if the studio ever has members outside
Cyprus as the majority.

#### Testing it

```bash
npm run test:sms
```

55 checks, no account and no network. Half of them are the segment arithmetic at
its boundaries — 160/161, 70/71, the euro sign costing two — because if that is
wrong the desk is quoting a price the studio will not be charged, and nothing
would reveal it until the invoice. The other half point the transport at a local
server standing in for api.sms.to and assert what actually goes on the wire: the
endpoint, the bearer token, `sender_id`, Greek surviving intact, and a 401 being
reported as a failure rather than swallowed.

### 4. Nothing configured?

The default is `EMAIL_PROVIDER=log` and `SMS_PROVIDER=log`: the pipeline runs
end to end and writes what it would have sent to the server log. The desk screen
says **"not connected yet"** next to those channels, so nobody at the counter
believes a text went out when it did not. That label turns itself off as soon as
a provider is configured — it reads the transport rather than being set by hand.

---

## Every message the studio sends, and where it goes

Five kinds of message. Four of them nobody writes — they fire on their own — and
the fifth is whatever the desk types.

| | In the app | Email | Phone pop-up | SMS |
| --- | --- | --- | --- | --- |
| A class is booked | always | no | no | no |
| A booking is cancelled | always | no | no | no |
| **A payment goes through** | always | **yes** | no | no |
| **Before the class** | always | no | **yes** | no |
| The desk sends a notice | always | desk chooses | desk chooses | desk chooses |

**"In the app" is the column that never fails.** The number on the member's
photograph goes up and the message waits under Notifications. It is written
first, before any channel is attempted, so a mail server outage or a phone with
notifications switched off never means the message was lost. It is also the copy
they can go back and read a week later, which the others are not.

That table lives in exactly one place — `SENDS` in
`src/lib/messaging/events.ts` — and changing a `false` to a `true` is the whole
of changing your mind:

```ts
const SENDS = {
  booked:    { email: false, push: false, sms: false },
  cancelled: { email: false, push: false, sms: false },
  purchased: { email: true,  push: false, sms: false },
  reminder:  { email: false, push: true,  sms: false },
};
```

It used to be an environment variable (`REMINDER_CHANNELS`) plus a second
constant, which meant the answer to "does a booking send an email?" was spread
across two files and a `.env`. If that line is still in your `.env` it does
nothing, and `npm run doctor` says so.

### The one that is not in that table

**The confirmation code.** It is email only, it ignores every consent switch, and
it writes nothing into the member's account. All three are deliberate.

Email only, because that is the point of it: the message exists to prove that the
address someone typed is an address they can read.

It ignores `notifyEmail` because that switch is consent to be *contacted* —
reminders, receipts, news — and this is the address proving itself, asked for by
the person who typed it thirty seconds ago. An account that cannot be confirmed
because its owner turned off emails is an account nobody can use.

And it writes no copy into the account, unlike every other message here, because
a one-time code sitting in a list readable by anyone already signed in is a
credential filed next to the door it opens. The member cannot reach that list
before verifying anyway.

The code is in the **subject line** as well as the body, which is the one place
this system puts anything sensitive in a subject. The reasoning: the member is
sitting in front of the site with the box open, and reading six digits off a lock
screen is three steps fewer than opening a mail app and scrolling. Every large
service does the same, and what it guards here is an email address rather than
money.

**Until the code comes back, the site is closed.** Not just booking and paying —
every address. A signed-in member whose address is unconfirmed is redirected to
the code box whatever they ask for, and API calls are answered with
`EMAIL_UNVERIFIED` rather than a redirect, since `fetch` would follow one and get
HTML where it expected JSON. Four things stay open, each because it has to: the
code box, the two routes behind it, and **signing out** — which is the only
remedy for the one mistake people actually make, a typo in their own address, and
a person locked in a room with no door is a worse bug than the one this fixes.

That decision is made by `src/middleware.ts` from a claim in the session cookie,
not from the database — middleware runs on the edge runtime, where SQLite does
not exist. The cookie is re-issued the moment a code is accepted. The database
stays the authority for anything that *acts*: every route re-reads the row, so a
stale cookie can at worst let somebody look at a page, never use one.

**And the studio does not write to them either.** An unconfirmed account is left
out of every notice on every channel, the in-app copy included. Three reasons, any
one of which would do: the address may not exist, and a campaign bouncing off a
dozen invented mailboxes damages the studio's ability to reach the real ones; the
in-app copy would be filed somewhere they cannot open; and a rule that only runs
in one direction is not a rule. The reach line at the desk says how many were
excluded, so the figure never drops without saying why.

**This makes email a hard dependency of registration.** In `log` mode nothing is
sent, so nobody can finish signing up at all — `npm run doctor` reports that as a
problem rather than a warning, because it is the one misconfiguration that looks
fine from the outside and lets nobody in.

The limits, all in `src/lib/verify.ts`: six digits, fifteen minutes, five wrong
answers before the code dies, sixty seconds between sends, five sends an hour on
a rolling window. Each resend generates a genuinely new code and the previous one
stops working — a resend that produced the same digits would look to the member
as though nothing had happened.

### Why the reminder is the one that buzzes

It is the only automatic message that reaches outside the app, and that is the
whole point of it. A member two hours before their class is not looking at the
website — if they were, they would not need reminding. An inbox message nobody
opens is not a reminder, it is a diary entry.

Push is also the only channel that can carry it for nothing. Email would work
and costs nothing per message either, but a reminder is time-critical in a way
email is not: people check email in the evening, and a notification two hours
before a class has to arrive in those two hours. SMS would arrive reliably and
cost a few cents on every booking the studio takes, hundreds of times a month,
which is a real invoice for a message push delivers free.

It is proved rather than assumed:

```bash
npm run test:reminders
```

That stands a TLS server on a local port in place of Google's push service and
passes only if an encrypted payload actually lands on it — and only if the other
three channels stayed shut. Reading `push: true` in the table is not the same as
watching the message leave.

### Why a booking gets no pop-up on the phone

Somebody who has just pressed *Book* is standing in the app looking at the
screen that already told them it worked. A system notification on top of that is
the app talking over itself, and it is what makes people switch notifications off
altogether. So the badge goes up, the message is in the list, and the phone stays
quiet.

A payment is the exception that gets an email, because it is the one thing a
member may need to produce later — to check what they were charged, or when the
sessions expire — and email is the copy that survives outside the app.

### Push notification, or SMS?

They are different things that both end up on a phone, and the difference is
mostly cost.

| | Phone pop-up (push) | SMS |
| --- | --- | --- |
| What it is | a banner from the website, like an app notification | a real text message |
| Where it lands | the phone's notification tray or lock screen | the Messages app |
| Cost | **nothing, ever** | a few cents per message |
| Needs a phone number | no | yes |
| Needs permission | yes — once per device | no |
| Needs internet | yes | no, just signal |
| iPhone | only once the site is added to the Home Screen | always works |
| Can be silenced without telling us | yes | no |

**Push** is free and instant, and it is the reason there is a service worker in
`public/sw.js`. Its weakness is that it depends on the member having pressed
*Enable on this device* — and on iPhone, on having added the site to their Home
Screen first, which most people never do. So push reaches the members who
happened to opt in, and skips the rest silently.

**SMS** reaches essentially everybody with a phone, which is exactly why it costs
money. A text to 400 members is a real invoice, every time, and Greek text halves
the characters per message so the same words can cost twice as much. That is why
it is off by default for members and unticked by default at the desk.

The short version: push for things that happen often and matter a little, SMS for
things that happen rarely and matter a lot.

### The exact words

Anything in `{braces}` is filled in per member. Every message exists in both
languages. Where each goes:

- **In the app** — both are stored, and the site shows whichever language the
  member is reading it in, because it already knows.
- **Email** — both, English above Greek, separated by a rule, each half signed.
  We never ask a member which language they prefer, and guessing wrong is worse
  than showing two.
- **Push** — English only. A notification is one line on a lock screen and there
  is no room for a second language in it.

**When a class is booked** — `notifyBooked`

> **Booking confirmed**
> Reformer Flow — Saturday 29 August at 18:00. See you at the studio.

> **Η κράτηση επιβεβαιώθηκε**
> Ροή Reformer — Σάββατο 29 Αυγούστου στις 18:00. Σας περιμένουμε στο στούντιο.

**When a booking is cancelled** — `notifyCancelled`

> **Booking cancelled**
> Reformer Flow — Saturday 29 August at 18:00 is cancelled. The session is back in your balance.

> **Η κράτηση ακυρώθηκε**
> Ροή Reformer — Σάββατο 29 Αυγούστου στις 18:00 ακυρώθηκε. Η συνεδρία επέστρεψε στο υπόλοιπό σας.

The last sentence is the one that changes. Inside the 24-hour window it reads
*"This was inside the 24-hour window, so the session was used."* — so the member
is told the consequence at the moment it happens rather than discovering a
missing session later.

**When a payment goes through** — `notifyPurchased`. This is the one that emails.

> **Payment received**
> 10 sessions added to your balance — €200. They expire on 25 November 2026.

> **Η πληρωμή ελήφθη**
> 10 συνεδρίες προστέθηκαν στο υπόλοιπό σας — 200 €. Λήγουν στις 25 Νοεμβρίου 2026.

Sent once, by whichever of the three reports of a card payment actually granted
the sessions. The expiry is read from the batch that was just written rather than
recalculated, so this cannot promise a date the balance disagrees with.

**Before the class** — `runDueReminders`. This is the one that buzzes the phone.

> **Your class is coming up**
> Your class starts in 2 hours — Saturday 29 August at 18:00.

> **Το μάθημά σας πλησιάζει**
> Το μάθημά σας ξεκινά σε 2 ώρες — Σάββατο 29 Αυγούστου στις 18:00.

The lead time is each member's own, from the slider on their Notifications
screen; new accounts start at two hours. It is copied onto the reminder when they
book, so somebody who later changes two hours to fifteen minutes keeps the
two-hour reminder for classes already on the books. A class booked *inside* its
own lead time gets no reminder at all, because one that arrives immediately, or
for a time already past, is noise.

**A notice from the desk**

Whatever is typed in the Notices tab. Type the Greek version as well and every
member receives both in one email; leave it blank and the email is English only,
with no empty second half. The desk picks the audience and the channels, and sees
how many people each one will reach before pressing anything.

**And one that is only ever sent to the person who asked for it**

> **RG Pilates Studio**
> Notifications are working. This is the only test you will get.

That is the *Send a test* button under the push row in My account →
Notifications. It goes to that member's own devices and nobody else's.

### What the email looks like

Both languages in one letter, with a rule between them:

```
Subject: Payment received · Η πληρωμή ελήφθη

10 sessions added to your balance — €200. They expire on 25 November 2026.

Best regards,
RG Pilates Studio Team

———

10 συνεδρίες προστέθηκαν στο υπόλοιπό σας — 200 €. Λήγουν στις 25 Νοεμβρίου 2026.

Με εκτίμηση,
Η ομάδα του RG Pilates Studio
```

In the HTML version that rule is an actual line rather than three dashes. The
sign-off belongs to email and nothing else: a push notification saying "Best
regards" would be absurd, and the in-app card already sits under the studio's
name.

### The other things worth knowing

- **A personal message is nobody else's business.** Confirmations live in the
  same table as the studio's announcements, keyed to the member, so they share
  one unread count and one read state — but they are invisible to every other
  member, and they are kept out of the desk's Notices history, which stays a list
  of announcements rather than hundreds of confirmations.
- **A new member starts with an empty list.** Notices sent before they signed up
  are not theirs — they had not joined, and thirty unread messages with thirty on
  their photograph is a poor welcome. Anything sent from the moment they register
  onwards reaches them normally.
- A failed email or push never affects the booking. Both are sent without being
  waited for, so a slow mail server cannot leave somebody looking at a spinner
  after their class is already booked.

### Nothing arriving? Check these three, in order

1. **Are the keys there?** `npm run doctor` says `push: no VAPID keys` when they
   are not, and the desk's Notices tab says *"not set up — run npm run
   push:keys"* beside the push channel. Without keys nothing can be delivered,
   including booking confirmations. This is the usual answer.
2. **Has any device allowed it?** A member has to press **Enable on this device**
   once, per device, in My account → Notifications. `npm run doctor` prints how
   many devices have. Zero devices means every push is skipped — correctly, and
   silently.
3. **Is it an iPhone that has not been added to the Home Screen?** Then Safari
   will not offer the prompt at all, and the push box does not appear.

**Chrome in a private/Incognito window turns the Push API off entirely** — not
just the permission, the whole feature ([crbug.com/401439](https://crbug.com/401439)).
The screen can only report "blocked", because Chrome deliberately makes Incognito
undetectable. Test in a normal window.

Once a browser has been allowed, the member never presses anything again: the
page registers the device by itself on every later visit. There is also a **Send a
test** button under the push row, which notifies only the person pressing it.

Localhost counts as a secure context, so all of this works in development
without HTTPS.

### The reminder needs something to wake it

**This is fixed now, and it was genuinely broken.** A real database was found
with thirteen reminders sitting unsent, the oldest from the previous day, every
one of them still marked pending. The cause: the sweep was only ever nudged by
ordinary traffic — a visit to the timetable pushed the queue along — and nobody
had happened to load the right page in the right minute. A reminder that depends
on somebody visiting the site is not a reminder, because the member it is for is
by definition not visiting the site.

The server now keeps its own clock. `src/instrumentation.ts` — the one Next.js
hook that runs without a request — sets a timer that **every sixty seconds** posts
to `/api/cron/reminders`, the same route a production scheduler will call. It logs
a line whenever it sends something:

```
[reminders] sweeping every 60s
[reminders] 1 due · pushed 1 · emailed 0 · texted 0
```

If that first line is not in the server log at startup, nothing is sweeping. The
usual reason is a missing `CRON_SECRET`, which the file says out loud rather than
failing quietly every minute — the route refuses an unauthenticated caller, and
it should, or anyone could make four hundred phones buzz.

**It knocks on its own front door rather than calling the function**, and that is
not squeamishness. Next compiles `instrumentation.ts` for *every* runtime, edge
included, and follows every import — including a dynamic one, and including one
behind a runtime check that correctly returns first. Importing the sweep from
there dragged `web-push` into an edge bundle, then `https-proxy-agent`, then
Node's `http`, which edge does not have: `Module not found: Can't resolve 'http'`
and every page 500 on the dev server, while `next build` was perfectly happy.
That is the worst kind of difference to have between the two.

So the file imports nothing at all. The module graph from it is empty and cannot
break again, and the timer exercises the *same* code path as the production
scheduler rather than a second one that could drift away from it.

`next.config.ts` also names `web-push` and `better-sqlite3` in
`serverExternalPackages`, so webpack leaves both as ordinary server-side requires
— one is Node-only, the other is a compiled binary, and neither belongs in a
bundle.

**A reminder for a class that has already started is closed without being sent.**
This matters the first time a sweep runs after an outage: without it, a server
coming back up would tell somebody their Tuesday class starts "now" on Thursday,
once for every class they had booked in between. A merely *late* reminder still
goes out — "starts in 5 minutes" when thirty was intended is worth having.

Three mechanisms now, in order of reliability:

**0. The server's own clock (already on).** Enough on its own for development and
for a single always-on server. Not enough on hosting that sleeps an idle process
or runs several copies — each copy would keep its own clock, and `markSent` is
what stops them duplicating.

**1. A scheduled call (do this in production).** Every five minutes:

```
POST https://rgpilatesstudio.onrender.com/api/cron/reminders
authorization: Bearer <CRON_SECRET>
```

Set `CRON_SECRET` in `.env` to any long random string. Most hosting has a
scheduler built in; on a Windows machine, Task Scheduler running:

```
curl -X POST -H "authorization: Bearer YOUR_SECRET" https://rgpilatesstudio.onrender.com/api/cron/reminders
```

The sweep sends everything that has come due, so a missed run catches up on the
next one — nobody's reminder is lost by the scheduler hiccuping.

**2. A nudge from ordinary traffic (still on).** Any visit to the timetable or
the account page pushes the queue along, at most once a minute. Kept as a third
line of defence, but no longer load-bearing — it was the only mechanism, and that
is exactly why reminders silently stopped working.

### Nothing arrived? Ask the queue

```bash
npm run reminders
```

That prints every scheduled reminder, what is overdue, what was too late to send,
and — the one that catches people — **how many devices each account has
registered for push**:

```
  8 waiting
    28 Aug, 16:30 → class 28 Aug, 17:00  (30m lead)  ronaldo7@hotmail.com  ⚠ no device registered — no pop-up possible
  0 sent

  Devices registered for push, by account:
    ·  1  mixalis.athanasiades1998@gmail.com
    ⚠  0  ronaldo7@hotmail.com
```

**A pop-up needs a device, and a device belongs to an account, not to a browser.**
Pressing *Enable on this device* while signed in as one member does not register
it for another — so testing with a second account means signing in as that
account and opening My account → Notifications once. This used to be worse than
useless: the screen said "on for this device" because a browser subscription
existed, without checking whose it was, so the second member received nothing and
had no way of telling. The page now re-registers the browser for whoever is
signed in, on every visit.

`npm run reminders -- --run` sweeps immediately and prints the result.

The owner can also run it by hand from the desk — it is the same endpoint, and a
signed-in member of staff is the second way in.

---

## Sending, from the desk

Notices tab → write the message → then two decisions.

**Who it goes to**

| | Reaches | Use it for |
| --- | --- | --- |
| **Everyone** | every member with an account | a cancelled class, a closure, a timetable change |
| **Offers only** | members who ticked offers, news and new class types | a promotion, a new class type, studio news |

"Offers only" can never reach somebody who did not tick that box, whatever is
selected on screen — the audience is enforced on the server, and also on the way
*out*: a member who withdraws that consent stops seeing offers already sent, so
turning it off means something retrospectively.

**The history**, on the right, filters by channel — all, push, email, SMS, each
with its count — and pages five at a time, newest first, back to the first notice
the studio ever sent. "What did we send by SMS" is a question with a bill attached
to it, so it gets its own answer rather than a scroll through everything.

The member's own Notifications list works the same way: unread / all / read, five
at a time. That replaced a list of "the most recent thirty, filtered in the
browser" — which meant the thirty-first message could never be reached, and worse,
that "3 unread" meant three unread *within those thirty*. A member with forty
unread was told three. Counting and filtering now happen in SQL.

**How it goes out** — three sections, each showing how many people it will
actually reach before you press anything:

- **Push notification** — pre-selected. Free, instant, on devices that allowed it.
- **Email** — to members who left email on.
- **SMS** — costs money per message; only members who turned SMS on.

The notice lands in every member's account whichever of these you choose. That
copy always exists, so a provider outage never means the message was lost.

**Test accounts.** A member can be marked as a test account on their page in the
Members tab — a dummy account the studio keeps for trying things out. Marked
accounts are left out of everything the desk sends, and out of the member counts,
unless the *Include test accounts* box is ticked before sending.

"Left out" means left out of all four channels, the in-app copy included. That is
worth stating because the obvious implementation gets it wrong: excluding them
from email, SMS and push while still writing them one shared in-app notice leaves
the notice visible in their list, and the desk's "3 of 40 read" counting people it
had just been told were excluded. Each notice records whether test accounts were
included, and the visibility rule reads it. A test account's own booking
confirmations are unaffected — those belong to it.

The checkbox only appears when at least one test account exists.

Afterwards the history shows what each channel actually did — `push 38 · email 41
(2 failed) · sms 0` — rather than the word "sent". If forty emails were refused,
the desk finds out immediately instead of a week later.

---

## Testing it without spending anything

```bash
npm run build && npx next start -p 3100
npm run test:notify -- http://localhost:3100     # 81 checks
npm run test:smtp                                # 49 checks, no mailbox needed
npm run test:reminders                           # proves the reminder pushes
```

`test:smtp` stands up a mail server on a local port and makes the client talk to
it, in both of the shapes a real one comes in — encrypted from the first byte,
and upgraded with STARTTLS. It checks the things that would otherwise be found by
a member receiving gibberish: that a Greek subject line is encoded, that a Greek
body survives, that a message containing a line with a single dot on it is not
silently truncated, and that the password is never written to the wire before the
connection is encrypted or into the diagnostic log afterwards.

That suite covers the consent rules specifically: what a new member starts with,
that push cannot be switched off even by an edited request, that email and SMS
can be, that an offer reaches exactly the members who accepted offers and no one
else, and that a member who declined never sees it — in the app or out of it.
