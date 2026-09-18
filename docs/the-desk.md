# The desk: what each control actually does

> There is a printable version of all of this: **`docs/RG-pilates-desk-manual.pdf`**,
> 50 pages, English then Greek, with a screenshot of every screen. Give that to
> whoever is on the desk. This file is the same ground covered for whoever is
> working on the code, and it goes into more detail on the why.
>
> To rebuild the PDF after a change to the console: start the app, then
> `npm run manual -- http://localhost:3100`. It recaptures every screenshot from
> the running console, numbers the chapters, builds the contents page and prints
> the PDF. The source is `docs/manual/manual.html`.

For the person at the counter. Written because a few of these do more than their
label suggests, and one of them looks alarming and is not.

---

## Closures → Generate schedule

**What it is.** The weekly rota is a set of *templates*: "Reformer Flow, Mondays
at 06:00", "Reformer Flow, Mondays at 07:00", and so on. A member cannot book a
template — they book a class on a date. This button walks forward the number of
weeks in the box beside it and writes a real, bookable class for every day each
template falls on. That is what puts the timetable on the website.

**Where to see what it did.** Straight after pressing it, in the box that appears
underneath: *"42 classes added, 301 were already there."* The class count above
it — "344 classes on the books" — is the running total.

Everything it creates shows up on **Timetable** on the public site, and in the
**Bookings** tab at the desk. There is no separate list of "things this button
made", because what it makes is ordinary classes.

**Pressed it by mistake?** Almost certainly nothing happened.

Rolling forward is *idempotent*: each class is unique by template and time, so a
second run over weeks that already exist creates nothing at all and reports
everything as "already there". That is by design, and it is why the button is
safe to press when you are not sure whether somebody already did.

The one case worth undoing is a run that went **further ahead than you meant** —
26 weeks instead of 6 — because that puts four months of classes on the timetable
for members to book into. So after a run that added anything, there is an **Undo
this** button beside the result. It removes only the classes that run added, and
only the ones **nobody has booked**; a class with a member on it is kept and
reported as kept. A booked class is a commitment, not a mistake to tidy away.

The undo stays available until you leave the page. After that, a class you no
longer want is removed the same way as any other — by closing the day, which
cancels it properly and gives the members their sessions back.

**What it never does.** It does not touch classes that already exist, does not
change times, does not remove anything, and skips any day that is closed.

---

## Members

**Search** by name, email or phone. Partial is fine, and the phone match ignores
spaces, so `99123` finds `+357 99 123 456`.

**Browse** when you do not know who you are looking for — the member who came in
last week, the one whose name you half remember. Ten at a time, newest account
first, with *newer* and *older* underneath. This used to be capped at twelve with
no way past them, which made the list useless for anything but a name you already
knew.

**The three pills** — All / Members / Test — appear only once at least one test
account exists.

### Test accounts

A **Test account** switch on each member's page. It marks a dummy account the
studio keeps for trying things out, and it does two things:

- The account is left out of everything the Notices tab sends, unless *Include
  test accounts* is ticked before sending.
- It stops being counted as a member — in the reach figures, and in the "3 of 40
  read" on each sent notice.

"Left out" means left out of all four channels, the in-app copy included, so a
test account does not see an announcement it was excluded from. Its own booking
confirmations are unaffected — those belong to it.

It is **not** a role. A test account still books classes, buys packs and holds a
balance, because that is what it is for.

### Saving a member's profile

The page reloads and lands back on **Members** after a save. That is deliberate rather than lazy: what the desk
edits here — an email, a phone, a consent, the test marker — changes nothing
visible on the screen, so "Saved" was the only evidence and it looked identical
whether the save had worked or not. Reloading means everything on the screen
afterwards was read back out of the database.

The tab now lives in the address bar (`/admin?tab=members`), so a refresh comes
back where you were instead of resetting to Bookings — which is what a plain
reload after a save used to do.

**One phone number, one account.** Correcting a phone to one another member
already has is refused, the same way registration refuses it. Numbers are
compared in normalised form, so `+357 99 123456`, `99123456` and `0035799123456`
all count as the same number rather than three different ones. The database now
enforces it as well, so two people cannot slip through by registering in the same
second.

Errors here are said in words rather than in codes. `PHONE_TAKEN` in capitals
told a receptionist neither what had gone wrong nor whose fault it was.

### "Email not confirmed"

An amber panel on the member's card. It means they registered but never typed the
six-digit code the site emailed them, and until they do the account can do
nothing — no booking, no payment, not even its own profile page.

There is nothing for the desk to press. The member can ask for a new code from
the site at any time, from the box they were left on. What the desk can usefully
do is check the address on the account is the one they meant to type, correct it
if not, and tell them to look in their spam folder.

If **every** new member is showing this, the problem is not the members: the
studio's email provider has stopped sending. `npm run doctor` says so in one line.

**The desk cannot sell to them either, and that is the point.** Nothing lands on
an account until its address is proved, and that has to include the counter or it
is not a rule. So *Sessions at the desk* refuses to add sessions to an
unconfirmed member: no cash sale, no card at the desk, no comped session.

The reason is worth knowing, because at the counter it will feel like an
obstruction. If reception takes €110 against an account whose email is a typo,
the studio now has a paying customer it cannot send a receipt to, cannot remind
about a class, and cannot reach when one moves. The member thinks they are a
member; the studio thinks it has told them things.

**The fix takes half a minute and reception is the only person who can do it.**
The member is standing there with their phone:

1. Correct the email on their page if it is wrong, and save.
2. Ask them to sign in on their phone. They land on the code box.
3. They press "send the code again", read it, type it.
4. Sell them the pack.

That is the only moment anybody will ever have both the member and the right
address in the same room.

**Taking sessions back still works**, whatever state the account is in, and so
does cancelling their classes. The asymmetry is deliberate: an unconfirmed
account can never be *given* anything, and the studio can always correct itself.

**They clear themselves after a week.** An account that never confirmed its
address can do nothing at all, so leaving the row there for ever means holding an
email address and a phone number belonging to somebody the studio has no
relationship with. A sweep runs alongside the reminder job and removes any
unconfirmed registration older than seven days.

The sweep will not delete a row that has a payment or a session against it. That
should now be impossible, because of the rule above. For one version it was not,
and any row left over from then is reported by `npm run doctor` rather than swept,
because a sweep must never delete a record of money.

**And they are left out of anything the Notices tab sends** — all four channels,
including the in-app copy, which they could not reach anyway. The reach line says
how many were excluded, so the number never drops without an explanation.

### Erasing a member's personal data

**Owner only.** Reception does not see this panel and the route refuses them.

For a member who has asked to be forgotten — which in the EU they are entitled to
do, and the studio has a month to answer. What it does:

- **Overwritten or deleted:** name, email, phone, date of birth, height, weight,
  the instructor's notes, their photograph, every registered device, and the
  password — which is replaced with one nobody holds, so the account cannot be
  signed in to. Anyone already signed in on it is signed out.
- **Kept, deliberately:** every payment, every booking, every session in the
  ledger. Cyprus requires accounting records for six years, and that obligation
  outranks the erasure request for the *invoice* while the *person* still goes.
  It also means the studio's takings do not change — a button that quietly
  rewrote last March would be worse than no button.

Afterwards the row reads **Erased member**, with a grey panel saying who erased
it and when.

Two things to know before pressing it:

- **You have to type their email address.** There is no undo, and "are you sure?"
  is a button people press without reading. Typing the address means looking at
  which member is selected.
- **It does not cancel their upcoming classes.** If they have any, the panel says
  so before you start. Somebody may want their data gone and their Thursday class
  kept — so that is a conversation, not a keystroke. Cancel them first if that is
  what they want, otherwise the roster will show "Erased member".

The studio's own accounts cannot be erased here. Use `npm run staff` for those.

---

## Notices

Covered in full in [notifications.md](./notifications.md). The short version:

- Write it, pick who it goes to, pick which channels.
- **Type the Greek version too.** Members reading the site in Greek see the Greek
  in their account, and the email carries both languages with a rule between
  them. Leave it blank and everyone gets English.
- The history on the right filters by channel and pages five at a time.

### Exclusive categories

The last block in the composer, below **How it goes out**. It picks out who a
message is *relevant* to, and that is a different question from who has agreed to
hear from you.

Last on purpose. The first two sections are the decisions every message needs —
who, and how — while this one is optional narrowing most announcements never
touch, and in the middle it read as a required step. The **include test
accounts** switch lives here too, for the same reason: it is not "who may we
write to" but "which of them is this actually for". The matching count sits at
the very bottom, after that switch, since the switch is one of the things that
changes it.

| | Finds |
| --- | --- |
| **Never bought a pack** | No payment yet, by card or at the desk. Free sessions given as an adjustment do not count as buying — a comped session is not a deposit. |
| **No sessions left** | Nothing in the balance, or everything they had has expired. |
| **Not been for N days / weeks / months** | Last class that long ago or longer — **and members who have never come at all**, because for a "we have not seen you" message they are the same audience, and the most winnable part of it. |

They combine, so *never bought* plus *not been for 3 months* is the cold-lead
list. The count under them — "19 members match" — updates as you change them, and
**Send is disabled when nothing matches**, so a campaign never goes out to an
empty list without you noticing.

**Consent still wins, always.** A filter can only ever narrow. Picking
*never bought* with the **Offers only** audience reaches members who never bought
*and* accepted offers — a member who declined offers is never in it, whatever is
selected on screen. That is enforced on the server, and there is a test that
sends a filtered promotion and checks a member who declined never receives it.

Months count as 30 days. You are choosing a rough cohort, not a billing period.

**Each sent notice records who it went to** — "offers audience · never bought ·
away 30d+" — under its date in the history. That cannot be worked out afterwards:
the audience for "not been for three months" is different today, because people
came back. Without it recorded at the time, a notice that reached 38 people would
give no way of ever knowing which 38, or why.

---

## What is behind the lock

The console asks for a password again even though you are already signed in,
because it can change balances, cancel classes and reset passwords. It stays
open for **15 minutes of doing nothing**, and every action pushes that window
out again — so working through a queue is never interrupted, and a counter
nobody has touched for a quarter of an hour asks for the password.

**Reception cannot see Analytics** — members, revenue and takings are the owner's
business — and cannot open another desk account's profile. Both are enforced on
the server, not by hiding a tab.
