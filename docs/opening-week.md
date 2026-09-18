# The opening-week offer

One free session for everyone who joins before the studio opens, spendable only
on opening week.

Everything about it lives in **`src/lib/promo.ts`**. One file, so there is no
`2026-09-20` hiding in a route somewhere waiting to be missed.

---

## What it does

| | |
| --- | --- |
| Who gets it | Any account created **28 August – 19 September 2026** |
| How many | **1** free session |
| Bookable for | Classes **Monday 14 – Saturday 19 September** |
| Expires | End of Saturday 19 September |
| Accounts older than 28 August | Nothing. The studio's decision — those are development and staff accounts. |

Granted at the moment of registration, not by a job that sweeps later, so the
member sees it when they land on the timetable — which is when they are most
likely to use it.

**Why Saturday the 19th and not Sunday the 20th.** The studio is closed on
Sundays. A window ending on the 20th would promise a day with no classes in it,
and somebody would save their free session for it and lose it to a closed door.
There is a test asserting the last day is not a Sunday.

---

## The thing that makes it work

The credit system already understood **expiry** — the last moment a session can
be *spent*. It did not understand **which class** a session may be spent on, and
those are different questions.

Without the second one, the offer does nothing: a member granted a free session
on 5 September could spend it on the 6th to book a class in **November**. The
free session would leak straight into the paid schedule and "opening week only"
would constrain nothing at all.

So `credit_batches` gained two columns — `usable_from` and `usable_to` — and
`spendOneCredit` now takes the class date and only considers batches allowed to
pay for a class on that date. Ordinary bought sessions leave both null and behave
exactly as they always did.

### Which session gets spent

This falls out of the existing "soonest expiry first" rule, and it lands the
right way round:

| The member books | Pays with | Why |
| --- | --- | --- |
| A class in opening week | **the free session** | It expires soonest and it is valid, so the member gets the benefit rather than losing it |
| A class after opening week | **their bought pack** | The free session is not allowed to pay, so it is skipped and left intact |

A member with a free session and a 5-pack who books an opening-week class ends up
with five sessions, not four. Tested both directions.

### Cancelling

The session goes back to the batch it came from, keeping its window. Cancel an
opening-week booking and the free session returns, still only good for opening
week. Also tested.

---

## What the member sees

A free session nobody can work out how to spend is worse than no free session,
because they try, fail, and conclude the site is broken. So the window is said
three times:

- **On registration**, as a notice and an email in both languages, naming the
  first and last day it can be spent on and the day it expires, and nothing else:
  a welcome message that carries on into seat counts stops being read before it
  reaches the part that matters. Emailed as well as shown, which is an exception
  to the usual rules — this is the only place the window is explained, and they
  are being told during the thirty seconds of signing up, when nobody reads
  anything.
- **On their balance**: *"1 of these is a free opening-week session — it can only
  be used for a class between 14 September and 19 September."*
- **When they try a class it cannot pay for**, they are told exactly that, with
  the suggestion to pick a class that week or buy a pack. Not "no sessions" —
  a member with a visible balance of 1 being told they have none is how a site
  loses somebody's trust in one sentence.

---

## Seats, and the escape hatch

The rota puts **59 classes and 295 seats** in the week of the 14th:

| | Classes | Seats |
| --- | --- | --- |
| Mon–Fri 14–18 Sept | 11 each | 55 each |
| Sat 19 Sept | 4 | 20 |
| Sun 20 Sept | 0 | 0 |
| **Total** | **59** | **295** |

One free session each therefore fits about 295 members *if every single one
redeems*. Realistic redemption is well under that, so it is comfortable — but not
enormous.

**If the week fills up, widen it.** Move `spendUntil` and `expiresAt` in
`promo.ts` a week later and every unredeemed session becomes usable for two
weeks. No member loses anything, nobody needs telling, and it is one line. That
is the whole reason the dates are constants rather than a hard-coded string, and
it is a better answer than a cap that turns away a new customer on opening week.

---

## Switching it off

```
PROMO_ENABLED=false
```

Stops new grants immediately. Sessions already given out keep working — turning
the offer off should not take back something a member was promised.

---

## Testing it

The offer changes what a new account starts with, so **the suites need it off**
and it gets its own suite that needs it on:

```bash
npm run build

# everything else, offer off
PROMO_ENABLED=false npx next start -p 3100
npm run test:notify -- http://localhost:3100
npm run test:payments -- http://localhost:3100

# the offer itself, offer on
PROMO_ENABLED=true npx next start -p 3100
npm run test:promo -- http://localhost:3100      # 23 checks
```

`test:promo` is the one that matters. It registers a member, checks the session
arrives with a message naming the week, then **tries to book a class in October
and asserts it is refused** — that being the bug the whole feature exists to
prevent. Then it cancels, checks the session comes back still tied to the week,
buys a pack, and proves each kind of session is spent on the right class.

`test:flows` covers the same rules against the database directly, including the
grant-window boundaries and the exact dates, so a careless edit to `promo.ts` is
caught here rather than discovered in September.

If a suite fails with balances one too high, it is running against a server with
the offer on. `test-payments` and `test-notify` say so in one line rather than
producing a dozen confusing failures.
