import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  classSessions,
  classTypes,
  creditBatches,
  notices,
  purchases,
  subscriptions,
  users,
} from "@/db/schema";
import { getAvailableCredits } from "@/lib/credits";
import { createNotice } from "@/lib/notices";
import { invoiceForPurchase } from "@/lib/invoice-for";
import { isSpecimen } from "@/lib/invoice";
import { dueReminders, markSent } from "@/lib/reminders";
import { emailTransport } from "./email";
import { sendPush, subscriptionsFor } from "./push";
import { smsTransport, toE164 } from "./sms";
import type { Attachment, Channel, Outgoing } from "./types";
import { STUDIO_OPS_EMAIL } from "@/lib/personal";
import { currentSubscription, subscriptionById, sweepSubscriptions } from "@/lib/subscriptions";
import {
  studioAddDays,
  studioDateKey,
  studioParts,
  studioStartOfDay,
} from "@/lib/time";
import {
  bookedWords,
  cancelledWords,
  contactAckWords,
  contactStudioWords,
  forEmail,
  instructorChangedWords,
  leadWords,
  personalBookedWords,
  personalCancelledWords,
  promoWords,
  purchasedWords,
  reminderWords,
  repeatBookedWords,
  tomorrowWords,
  studioPaidWords,
  studioAppointmentWords,
  studioNewMemberWords,
  grantedWords,
  studioGrantedWords,
  say,
  verifySentWords,
  verifyWords,
  whenWords,
  type Bilingual,
  planDueWords,
  planLapsedWords,
  planPaidWords,
} from "./wording";

/**
 * The four messages the studio sends without anybody writing them.
 *
 *   booked      "The booking is confirmed" — the moment a class is taken
 *   cancelled   "That booking is cancelled" — and whether the session came back
 *   purchased   "Payment received" — the sessions, the price, when they expire
 *   reminder    "Your class is in two hours" — at each member's own lead time
 *
 * Which channels each one uses is the table below and nothing else. It used to
 * be an environment variable plus a second constant, which meant the answer to
 * "does a booking send an email?" lived in two files and a `.env` — so the table
 * is now the only place, and it reads like the decision it encodes.
 */

/** Where each automatic message is allowed to go. The studio's own spec. */
const SENDS: Record<
  | "booked"
  | "cancelled"
  | "purchased"
  | "reminder"
  | "appointment"
  | "instructor"
  | "nightly",
  { email: boolean; push: boolean; sms: boolean }
> = {
  /**
   * Booking and cancelling: the buzz as well as the in-app copy.
   *
   * This was push-off for a while, on the reasoning that a member who has just
   * pressed Book is looking at the screen that told them it worked, so a
   * notification is the app talking over itself. The studio's decision went the
   * other way and there is a good argument for it: the phone notification is
   * the thing that survives leaving the site, and a member who books on the bus
   * has something to look at later without opening anything. It is also the
   * only channel the studio pays nothing for.
   *
   * Still no email. A booking is not a receipt, and an inbox full of "you
   * booked a class" is how a studio teaches its members to filter its mail —
   * which is a problem the day it needs to tell them a class is cancelled.
   */
  booked: { email: false, push: true, sms: false },
  cancelled: { email: false, push: true, sms: false },

  /* Money gets all three. A payment is the one thing a member may need to
     produce later — to check what they were charged, or when it expires — so
     the email is the copy that survives outside the app, and the push is the
     acknowledgement that arrives before they have put the phone down. */
  purchased: { email: true, push: true, sms: false },

  /* The one that buzzes the phone, and the only one that should. It exists
     precisely because the member is *not* looking at the site: an inbox message
     two hours before a class, that nobody opens, is not a reminder — it is a
     diary entry. Push costs nothing and needs no provider, so this is the one
     place the free channel earns its keep. */
  reminder: { email: false, push: true, sms: false },

  /**
   * An appointment, to the member: the buzz and the in-app copy, no email.
   *
   * It briefly sent an email as well, on the reasoning that a stricter
   * cancellation rule deserves a copy that survives outside the app. The
   * studio's answer was simpler and it is right: the member is looking at the
   * screen that just confirmed the booking, exactly as with a class. The one
   * party who is *not* looking at a screen is the studio, which has to find an
   * instructor, so the email goes there and only there. The hour and the rule
   * are on the member's own booking in their account, which is where they would
   * look for them anyway.
   */
  appointment: { email: false, push: true, sms: false },

  /**
   * An instructor swapped on a class somebody has booked.
   *
   * Push, because this is the one kind of change a member may want to know about
   * before they arrive, and they are not looking at the site when it happens: the
   * decision is made at the desk, hours or days after they booked. No email,
   * because it is not a receipt and nothing about it needs to survive outside the
   * app. It is also one of the things the studio's own consent rule says a member
   * cannot opt out of, alongside a class being moved or cancelled.
   */
  instructor: { email: false, push: true, sms: false },

  /**
   * The nightly note about tomorrow, at 23:30.
   *
   * Push and the in-app copy, and deliberately not email or SMS. Email because
   * a message every single night is the fastest way to teach four hundred
   * people to filter the studio's mail, and the studio needs that inbox to work
   * on the day a class is cancelled. SMS because it is the same message times
   * four hundred nights times two cents, which is a standing order nobody
   * agreed to.
   *
   * Push costs nothing and is the right shape for it: a line on a lock screen
   * at bedtime, which is exactly when somebody is deciding what time to get up.
   */
  nightly: { email: false, push: true, sms: false },
};

/**
 * The appointment row, exported so the test suite asserts the decision rather
 * than a copy of it. A table like this is only a decision while something
 * checks it is still the one that was taken.
 */
export const APPOINTMENT_SENDS = SENDS.appointment;

/**
 * The in-app copy is not in that table because it is not a channel. It is
 * written first, unconditionally, for every message — it is what puts the number
 * on the member's photograph, and it is the one copy that cannot fail to be
 * delivered because nothing has to deliver it.
 */

/* ------------------------------------------------------- one member, one push */

/** Every device this member has allowed. Returns how many were reached. */
export async function pushToUser(userId: string, msg: Outgoing) {
  const subs = subscriptionsFor([userId]);
  let sent = 0;
  for (const sub of subs) {
    const res = await sendPush(sub, msg);
    if (res.ok) sent++;
  }
  return sent;
}

/* ------------------------------------------------------------ what to say */

type BookingFacts = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  notifyEmail: boolean;
  notifySms: boolean;
  /**
   * Which language they read the site in, straight off the row.
   *
   * Carried on the facts rather than looked up when a message is composed,
   * because every one of these queries already joins `users` — a second read
   * per notification, to answer a question the first read could have answered,
   * is the kind of thing that is invisible until a reminder sweep does it two
   * hundred times.
   */
  locale: string | null;
  startsAt: Date;
  classEn: string;
  classEl: string;
  /** GROUP or PERSONAL. Decides which of two entirely different messages goes. */
  classKind: string;
  /** The second person on a duet, when there is one. */
  guestName: string | null;
};

function factsFor(bookingId: string): BookingFacts | null {
  const row = db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
      locale: users.locale,
      startsAt: classSessions.startsAt,
      classEn: classTypes.nameEn,
      classEl: classTypes.nameEl,
      classKind: classTypes.kind,
      guestName: bookings.guestName,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.userId, users.id))
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .innerJoin(classTypes, eq(classSessions.classTypeId, classTypes.id))
    .where(eq(bookings.id, bookingId))
    .get();
  if (!row) return null;
  /* An older class type may have no Greek name. Falling back to the English one
     is better than a message with a hole in it. */
  return { ...row, classEl: row.classEl || row.classEn };
}

/**
 * The member's own account copy, in both languages.
 *
 * Both are stored so the site can show whichever the member is reading it in —
 * it already knows that, and a bilingual card in a list would be twice as tall
 * for no gain.
 *
 * Never throws outward: this is called from a booking that has already
 * succeeded, and a failure to write a courtesy message must not surface as a
 * failure to book.
 */
function inbox(userId: string, words: Bilingual) {
  try {
    createNotice({
      titleEn: words.en.subject,
      bodyEn: words.en.body,
      titleEl: words.el.subject,
      bodyEl: words.el.body,
      userId,
      staffId: null,
    });
  } catch {
    /* Nothing to do about it, and nothing worth failing a booking over. */
  }
}

/* ------------------------------------------------------------- the four sends */

/**
 * Fired when a class is booked. Never awaited by the booking route: a message
 * that fails must not turn a successful booking into an error on screen.
 */
export async function notifyBooked(bookingId: string) {
  const f = factsFor(bookingId);
  if (!f) return 0;

  /* An appointment is a different message to a different set of people, so the
     branch is here rather than in the four callers. Whoever books it — the
     member on the site, the desk on their behalf — the studio gets told. */
  if (f.classKind === "PERSONAL") {
    void tellStudio(f, false);
    return deliverPersonal(f, personalBookedWords(f), SENDS.appointment);
  }

  return deliverPersonal(f, bookedWords(f), SENDS.booked);
}

/**
 * Fired once when a whole run of weeks is booked in one press.
 *
 * ---
 *
 * **One message, and it took two attempts to get right.**
 *
 * The first attempt was fifty-two of them: `notifyBooked` per booking. That is
 * a phone buzzing every few hundred milliseconds and it is how a member learns
 * to turn notifications off, which costs the studio the only channel it has for
 * saying a class is cancelled.
 *
 * The second was one `notifyBooked` for the first class of the run, which is
 * quiet and misleading. A member who booked a year of Mondays was told
 * "Reformer Flow, Monday 8 September at 16:00" — true about one class, silent
 * about the fifty-one others and the fifty-two sessions that had just left
 * their balance.
 *
 * This is the third: one message that describes the run. The account copy is
 * one card as well, for the same reason — fifty-two cards in a list is not a
 * record of anything, it is a wall.
 *
 * ---
 *
 * **The reminders are untouched, and that is the distinction that matters.**
 *
 * This is the *confirmation*: one event, one message. The reminder before each
 * class is a different thing, queued per booking at the member's own lead time,
 * and it stays per class because that is the whole point of it. Collapsing
 * those would mean telling somebody in September about a class in November.
 *
 * ---
 *
 * Takes the run rather than a booking id, because half of what the message has
 * to say — the count, the span, the weeks refused and why — is not written on
 * any one booking. The class and the member still come from the first booking,
 * which is the only place they are recorded.
 */
export async function notifyRepeatBooked(run: {
  firstBookingId: string | null;
  booked: number;
  alreadyHad: number;
  outcomes: { startsAt: string; ok: boolean }[];
  failed: { startsAt: string; code?: string; until?: string }[];
}) {
  if (!run.firstBookingId || run.booked < 1) return 0;

  const f = factsFor(run.firstBookingId);
  if (!f) return 0;

  /* An appointment is never repeatable — `repeatWeekly` refuses PERSONAL
     outright — so there is no branch here. If that ever changes, the studio
     also has to be told, and this should refuse rather than send the wrong
     message quietly. */
  if (f.classKind === "PERSONAL") return notifyBooked(run.firstBookingId);

  const taken = run.outcomes.filter((o) => o.ok).map((o) => o.startsAt).sort();
  /* `f.startsAt` is the first booking's own class, which is the same date as
     `taken[0]`. Read from the facts anyway: it is already a Date, and a run
     whose first booking somehow is not its earliest should still describe the
     class it names. */
  const last = new Date(taken[taken.length - 1] ?? f.startsAt);

  return deliverPersonal(
    f,
    repeatBookedWords({
      classEn: f.classEn,
      classEl: f.classEl,
      firstStartsAt: f.startsAt,
      lastStartsAt: last,
      booked: run.booked,
      alreadyHad: run.alreadyHad,
      failed: run.failed,
    }),
    SENDS.booked,
  );
}

/** Fired when a booking is cancelled, saying whether the session came back. */
export async function notifyCancelled(bookingId: string, refunded: boolean) {
  const f = factsFor(bookingId);
  if (!f) return 0;

  if (f.classKind === "PERSONAL") {
    /* The studio has to hear about this one as loudly as it heard about the
       booking. Somebody has been asked to come in at noon, and an appointment
       that quietly disappears from a screen nobody is watching is an instructor
       driving in for nothing. */
    void tellStudio(f, true);
    return deliverPersonal(
      f,
      personalCancelledWords({ startsAt: f.startsAt, refunded }),
      SENDS.appointment,
    );
  }

  return deliverPersonal(
    f,
    cancelledWords({ ...f, refunded }),
    SENDS.cancelled,
  );
}

/**
 * The studio's own copy of an appointment, emailed to the operations address.
 *
 * Never awaited by anything that books or cancels, and never allowed to throw
 * outward: a mail server being down must not turn a completed booking into an
 * error on somebody's screen. It is logged instead, because a failure here is
 * the one failure in this file that costs money — an hour nobody was told about.
 */
async function tellStudio(f: BookingFacts, cancelled: boolean) {
  const words = studioAppointmentWords({
    startsAt: f.startsAt,
    memberName: f.name,
    memberEmail: f.email,
    memberPhone: f.phone,
    guestName: f.guestName,
    cancelled,
  });
  /**
   * The desk, on their own screens as well as in the mailbox.
   *
   * The email alone was a single point of failure with a person at the end of
   * it: somebody has to notice it, and an appointment nobody notices is an hour
   * with no instructor booked for it. So every staff account also gets the
   * in-app copy — the number on their photograph when they next open the
   * console — and a notification on whatever devices they have allowed.
   *
   * Written to the accounts rather than to a studio-wide inbox because there is
   * no such thing: the console is signed into as a person, and a notice has to
   * belong to somebody to be readable at all.
   */
  const staff = db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .where(inArray(users.role, ["STAFF", "ADMIN"]))
    .all();

  for (const person of staff) {
    inbox(person.id, words);
    /* Each member of staff in their own language. The desk is two people and
       they do not necessarily read the same one. */
    void pushToUser(person.id, say(words, person.locale)).catch(() => {});
  }

  try {
    const res = await emailTransport().send(
      STUDIO_OPS_EMAIL,
      forEmail(words),
    );
    if (!res.ok) {
      console.error(
        `[appointment] could not tell the studio about ${f.startsAt.toISOString()}: ${res.error}`,
      );
    }
    return res.ok;
  } catch (err) {
    console.error("[appointment] could not tell the studio", err);
    return false;
  }
}

/**
 * The studio's own copy of a payment, emailed to the operations mailbox.
 *
 * Three tills feed this and until now two of them were silent. A card payment
 * on the website showed up in the Stripe dashboard and nowhere the studio
 * looks; cash at the counter showed up in the drawer and nowhere at all. So the
 * owner could not answer "what came in today, and from whom" without opening
 * two systems and asking whoever was on shift.
 *
 * Deliberately email only, and deliberately not a notification. Every sale
 * buzzing every staff phone would be noise within a week, and noise is how a
 * channel stops being read — which matters, because the same phones carry the
 * appointment alerts that somebody has to act on within the hour. A mailbox is
 * the right shape for a record you scan later.
 *
 * Never throws outward and never awaited. The money is in the till whatever the
 * mail server does, and the member's own confirmation is the one that must not
 * be held up.
 */
async function tellStudioPaid(a: {
  memberName: string;
  memberEmail: string;
  memberPhone: string | null;
  credits: number;
  amountCents: number;
  currency: string;
  provider: string;
  providerRef: string | null;
  invoiceNo: string | null;
  userId: string;
  staffName: string | null;
  /** The invoice PDF, so the studio's copy carries the receipt too. */
  attachments?: Attachment[];
}) {
  try {
    const till = tillWords(a.provider);
    const words = studioPaidWords({
      memberName: a.memberName,
      memberEmail: a.memberEmail,
      memberPhone: a.memberPhone,
      methodEn: till.en,
      methodEl: till.el,
      credits: a.credits,
      amountCents: a.amountCents,
      currency: a.currency,
      /* Read after the sessions were granted, so it is the number the member is
         now looking at — which is the one they will quote if they think
         something has gone wrong. */
      balance: await getAvailableCredits(a.userId),
      staffName: a.staffName,
      invoiceNo: a.invoiceNo,
      /* A desk reference is `desk:` and a fragment of a staff id, which tells
         the reader nothing they cannot already see in "served by". */
      reference: a.provider === "stripe" ? a.providerRef : null,
    });

    const out = forEmail(words);
    const res = await emailTransport().send(
      STUDIO_OPS_EMAIL,
      a.attachments?.length ? { ...out, attachments: a.attachments } : out,
    );
    if (!res.ok) {
      console.error(
        `[pay] could not tell the studio about ${a.amountCents} from ${a.memberEmail}: ${res.error}`,
      );
    }
    return res.ok;
  } catch (err) {
    console.error("[pay] could not tell the studio about a payment", err);
    return false;
  }
}

/** Which till took the money, in words rather than a provider slug. */
function tillWords(provider: string) {
  switch (provider) {
    case "stripe":
      return { en: "Card online", el: "Κάρτα online" };
    case "cash":
      return { en: "Cash at the studio", el: "Μετρητά στο στούντιο" };
    case "card_at_desk":
      return { en: "Card at the studio", el: "Κάρτα στο στούντιο" };
    case "test":
      return { en: "Test payment", el: "Δοκιμαστική πληρωμή" };
    default:
      return { en: provider, el: provider };
  }
}

/**
 * Fired once a payment has actually become sessions.
 *
 * Called from the single place that grants them, and only by the caller that
 * won the race to grant — a card payment gets reported by the webhook, the
 * browser coming back, and sometimes a later check, so anything hooked less
 * carefully than this would tell the member three times that they had paid.
 *
 * The expiry is read from the batch that was just written rather than
 * recalculated, so the message cannot promise a date the balance disagrees with.
 */
export async function notifyPurchased(
  purchaseId: string,
  /**
   * Who was serving, when a person was.
   *
   * Only the desk knows this — an online payment has no one behind it — and it
   * is not on the purchase row, which records `desk:` and eight characters of a
   * staff id. Passed in rather than looked up so the studio's copy can say
   * "served by Elena" instead of a fragment of a UUID, which is the difference
   * between a record somebody can act on and one they have to decode.
   */
  opts?: { staffName?: string | null },
) {
  const row = db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
      locale: users.locale,
      credits: purchases.credits,
      amountCents: purchases.amountCents,
      currency: purchases.currency,
      receiptUrl: purchases.receiptUrl,
      provider: purchases.provider,
      providerRef: purchases.providerRef,
      invoiceNo: purchases.invoiceNo,
      expiresAt: creditBatches.expiresAt,
    })
    .from(purchases)
    .innerJoin(users, eq(purchases.userId, users.id))
    .leftJoin(creditBatches, eq(creditBatches.purchaseId, purchases.id))
    .where(eq(purchases.id, purchaseId))
    .get();
  if (!row) return 0;

  /**
   * The invoice, drawn now and attached to the email.
   *
   * The one automatic message that carries a file, because it is the one a
   * member may have to give to somebody else — an employer, an insurer, an
   * accountant. A link would have been less work and worse: it is one more
   * thing to click, and a document that lives only behind a login is a document
   * somebody cannot forward.
   *
   * Failure is not allowed to matter. The sessions are already in the balance
   * by the time this runs, and an email that arrives without its attachment is
   * a smaller problem than no email at all — the member can still download it
   * from their account, and the desk can still produce it. So a PDF that will
   * not draw is logged and the message goes anyway.
   */
  let attachments: Attachment[] | undefined;
  try {
    const invoice = await invoiceForPurchase(purchaseId);
    /**
     * A specimen is never emailed to a member.
     *
     * This was wrong when it was first written: it attached whatever
     * `invoiceForPurchase` produced, which while the VAT details are still
     * placeholder is a page stamped SPECIMEN and saying, at the bottom, that it
     * is not a valid invoice and must not be given to a client. Mailing that to
     * somebody who has just paid is worse than sending nothing — it is a
     * document telling them their own paperwork is void.
     *
     * A specimen exists for the studio to look at, and there are two proper
     * places to do that: `npm run invoice:preview`, and the download link on
     * the member's own payments list. Not an inbox.
     *
     * So the test is the invoice *number*, not the PDF. A number is only ever
     * issued once the configuration is real — see assignInvoiceNumber — which
     * makes "has a number" and "is a document worth sending" the same
     * question, answered in one place.
     */
    if (invoice && !isSpecimen(invoice.invoiceNo)) {
      attachments = [
        {
          filename: invoice.filename,
          content: invoice.pdf,
          contentType: "application/pdf",
        },
      ];
    }
  } catch (err) {
    console.error(`[pay] no invoice attached to ${purchaseId}`, err);
  }

  /* The studio's own copy, to the operations mailbox. Fired and not awaited:
     the member's confirmation is what matters to the person standing at the
     counter, and a slow mail server must not hold up their receipt. */
  void tellStudioPaid({
    memberName: row.name,
    memberEmail: row.email,
    memberPhone: row.phone,
    credits: row.credits,
    amountCents: row.amountCents,
    currency: row.currency,
    provider: row.provider,
    providerRef: row.providerRef,
    invoiceNo: row.invoiceNo,
    userId: row.userId,
    staffName: opts?.staffName ?? null,
    /* The same PDF that goes to the member, so the studio keeps its own copy of
       every receipt in one mailbox. Undefined for a specimen — the studio does
       not want an unnumbered draft any more than the member does. */
    attachments,
  }).catch(() => {});

  const words = purchasedWords({
    credits: row.credits,
    amountCents: row.amountCents,
    currency: row.currency,
    expiresAt: row.expiresAt ?? null,
    /* Written onto the purchase by fulfilPurchase a moment before this runs,
       which is the only reason it is here to read. */
    receiptUrl: row.receiptUrl,
    hasInvoice: Boolean(attachments),
  });

  /**
   * Put on a copy of the wording rather than on the wording itself.
   *
   * `deliverPersonal` hands the same object to three places. The account copy
   * and the phone notification both read only the subject and the body and
   * ignore this field, exactly as email ignores `url` — but building a separate
   * object makes that harmless rather than merely true today, and keeps the
   * plain wording usable by the test suite without a Buffer in it.
   */
  const withFile: Bilingual = attachments
    ? {
        en: { ...words.en, attachments },
        el: { ...words.el, attachments },
      }
    : words;

  return deliverPersonal(
    {
      userId: row.userId,
      name: row.name,
      email: row.email,
      phone: row.phone,
      notifyEmail: row.notifyEmail,
      notifySms: row.notifySms,
      locale: row.locale,
      /* Not a class, so these are unused by the wording below. */
      startsAt: new Date(),
      classEn: "",
      classEl: "",
      classKind: "GROUP",
      guestName: null,
    },
    withFile,
    SENDS.purchased,
  );
}

/**
 * The opening-week gift, announced.
 *
 * Emailed as well as put in the account, which is the exception to the table
 * above and a deliberate one: this message is the only place the member is told
 * which week the session is for, and they are being told it during the thirty
 * seconds of signing up, when nobody reads anything. It needs to survive in
 * their inbox.
 */
/**
 * Tell the studio a new member has joined.
 *
 * Emailed to the operations mailbox the moment an address is proved — the same
 * shape as tellStudioPaid: a record the owner scans, not a notification on every
 * staff phone, because a sign-up is not something anybody has to act on within
 * the hour.
 *
 * Fired on verification and not on registration, so an address nobody proved
 * never reaches the mailbox: registration alone would email the studio about
 * every mistyped address and every account the housekeeping sweep deletes seven
 * days later for never confirming. Never awaited and never allowed to throw
 * outward — a member who typed the right code is verified whatever the mail
 * server does.
 */
export async function notifyNewMember(userId: string) {
  try {
    const row = db
      .select({ name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!row) return false;

    const words = studioNewMemberWords({
      memberName: row.name,
      memberEmail: row.email,
      memberPhone: row.phone,
    });

    const res = await emailTransport().send(STUDIO_OPS_EMAIL, forEmail(words));
    if (!res.ok) {
      console.error(
        `[member] could not tell the studio about ${row.email}: ${res.error}`,
      );
    }
    return res.ok;
  } catch (err) {
    console.error("[member] could not tell the studio about a new account", err);
    return false;
  }
}

/**
 * A message from the public contact form: to the studio, and back to the sender.
 *
 * Two emails, neither of them to a member — the person filling in the form has
 * no account and no notification preferences, so this does not touch
 * deliverPersonal. The studio gets the enquiry in its mailbox so it can reply;
 * the sender gets an acknowledgement so the form does not feel like it vanished.
 *
 * Both sends are attempted whatever either does, and a failure is logged rather
 * than thrown: the enquiry is already saved as a row by the route that calls
 * this, so a mail server having a bad afternoon loses the courtesy copy, never
 * the message itself.
 */
export async function notifyContact(msg: {
  name: string;
  email: string;
  phone: string | null;
  message: string;
}) {
  const transport = emailTransport();
  const results = await Promise.allSettled([
    transport.send(STUDIO_OPS_EMAIL, forEmail(contactStudioWords(msg))),
    transport.send(msg.email, forEmail(contactAckWords({ name: msg.name }))),
  ]);
  const [studio, ack] = results;
  if (studio.status === "rejected") {
    console.error("[contact] could not deliver the enquiry to the studio:", studio.reason);
  } else if (!studio.value.ok) {
    console.error("[contact] could not deliver the enquiry to the studio:", studio.value.error);
  }
  if (ack.status === "rejected") {
    console.error(`[contact] could not send the acknowledgement to ${msg.email}:`, ack.reason);
  } else if (!ack.value.ok) {
    console.error(`[contact] could not send the acknowledgement to ${msg.email}:`, ack.value.error);
  }
}

/**
 * The desk gave a member sessions for free — tell the member and the studio.
 *
 * The counterpart to notifyPurchased for the till that takes no money. A comped
 * or corrected balance has no invoice, so nothing is attached and no price is
 * quoted; the member simply learns their balance went up, and the studio's own
 * mailbox gets the same record it gets for a sale.
 *
 * Never awaited and never allowed to throw outward: the sessions are already in
 * the member's balance by the time this runs, exactly like notifyPurchased.
 */
export async function notifyGranted(
  userId: string,
  opts: { credits: number; staffName?: string | null },
) {
  const row = db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row) return 0;

  /* The studio's own copy, to the operations mailbox. No invoice — a gift has
     none. Fired and not awaited, like the paid version. */
  void (async () => {
    try {
      const words = studioGrantedWords({
        memberName: row.name,
        memberEmail: row.email,
        memberPhone: row.phone,
        credits: opts.credits,
        staffName: opts.staffName ?? null,
      });
      const res = await emailTransport().send(STUDIO_OPS_EMAIL, forEmail(words));
      if (!res.ok) {
        console.error(
          `[grant] could not tell the studio about a free grant to ${row.email}: ${res.error}`,
        );
      }
    } catch (err) {
      console.error("[grant] could not tell the studio about a free grant", err);
    }
  })();

  /* The member's own confirmation: in-app, on their phone, and by email. No
     attachment, because there is no invoice for something that was not paid. */
  return deliverPersonal(
    {
      ...row,
      startsAt: new Date(),
      classEn: "",
      classEl: "",
      classKind: "GROUP",
      guestName: null,
    },
    grantedWords({ credits: opts.credits }),
    { email: true, push: true, sms: false },
  );
}

export async function notifyPromoGranted(
  userId: string,
  promo: { credits: number; spendFrom: Date; spendUntil: Date; expiresAt?: Date },
) {
  const row = db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row) return 0;

  return deliverPersonal(
    {
      ...row,
      startsAt: new Date(),
      classEn: "",
      classEl: "",
      classKind: "GROUP",
      guestName: null,
    },
    promoWords({
      credits: promo.credits,
      from: promo.spendFrom,
      to: promo.spendUntil,
      expires: promo.expiresAt,
    }),
    { email: true, push: false, sms: false },
  );
}

/**
 * Everybody booked into one class, told their instructor has changed.
 *
 * Returns how many members were written to, which the desk shows back so the
 * person who made the change knows it went somewhere. Cancelled bookings are
 * skipped: somebody who dropped the class has no interest in who is teaching it.
 *
 * Never throws outward. The change to the rota has already been saved by the
 * time this runs, and a push service being slow must not make a saved change
 * look like a failed one.
 */
export async function notifyInstructorChanged(
  sessionId: string,
  change: { from: string; to: string; by: string },
) {
  const rows = db
    .select({
      userId: users.id,
      locale: users.locale,
      startsAt: classSessions.startsAt,
      classEn: classTypes.nameEn,
      classEl: classTypes.nameEl,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.userId, users.id))
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .innerJoin(classTypes, eq(classSessions.classTypeId, classTypes.id))
    .where(and(eq(bookings.sessionId, sessionId), ne(bookings.status, "CANCELLED")))
    .all();

  let told = 0;
  for (const row of rows) {
    const words = instructorChangedWords({
      classEn: row.classEn,
      classEl: row.classEl || row.classEn,
      startsAt: row.startsAt,
      from: change.from,
      to: change.to,
    });
    inbox(row.userId, words);
    if (SENDS.instructor.push) {
      await pushToUser(row.userId, say(words, row.locale)).catch(() => 0);
    }
    told++;
  }

  if (told > 0) {
    console.log(
      `[rota] ${change.from} to ${change.to} on ${sessionId}, ${told} member(s) told by ${change.by}`,
    );
  }
  return told;
}

/**
 * The confirmation code, emailed and nothing else.
 *
 * Outside `deliverPersonal` on purpose, and it breaks two of its rules for good
 * reasons.
 *
 * It writes no copy into the member's account. Every other message here does,
 * because the account is where a member goes to check what they were told — but
 * a one-time code sitting in a list, readable by anybody already signed in to
 * that account, is a credential filed next to the door it opens. And the member
 * cannot reach that list anyway until the code has been typed.
 *
 * It ignores `notifyEmail`. That switch is consent to be *contacted*: reminders,
 * receipts, news. This is the address proving itself, asked for by the person
 * who typed it thirty seconds ago, and an account that cannot be confirmed
 * because its owner turned off emails is an account nobody can use.
 */
export async function sendVerificationCode(
  to: string,
  code: string,
  minutes: number,
  /**
   * The account, when there is one to write to.
   *
   * Optional so the resend route and anything else can keep calling this with
   * three arguments. Given it, the member also gets the in-app copy and the
   * phone notification the studio asked for — carrying the *fact* of the code
   * and not the code itself, for the reasons in `verifySentWords`.
   */
  userId?: string,
) {
  const res = await emailTransport().send(
    to,
    forEmail(verifyWords({ code, minutes })),
  );

  if (userId) {
    const heads_up = verifySentWords({ minutes });
    inbox(userId, heads_up);
    /* The one place the language has to be read rather than carried: this is
       called from the register route and the resend route, and neither of them
       has a user row in hand — only an address and an id. */
    const mine = db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    /* Almost always reaches nobody, and that is fine. A member registering has
       not been asked for notification permission yet, so there is no device to
       send to; this earns its keep on a resend, and on the second device of
       somebody who already allowed it. */
    void pushToUser(userId, say(heads_up, mine?.locale)).catch(() => {});
  }

  return res;
}

/**
 * One member, one message, whichever channels the table allows it.
 *
 * The member's own consent narrows that further and can never widen it: a
 * message the studio has not put email on stays off email even for somebody who
 * would happily receive it.
 */
async function deliverPersonal(
  f: BookingFacts,
  words: Bilingual,
  sends: { email: boolean; push: boolean; sms: boolean },
) {
  /* The account copy, always. Written first and outside any condition: it is
     the one the member can come back to, and it is what puts the number on
     their photograph. */
  inbox(f.userId, words);

  /* The phone and the text in the member's own language; the email carries
     both, so it is not asked. */
  const mine = say(words, f.locale);

  let reached = sends.push ? await pushToUser(f.userId, mine) : 0;

  if (sends.email && f.notifyEmail && f.email) {
    const res = await emailTransport().send(f.email, forEmail(words));
    if (res.ok) reached++;
  }
  if (sends.sms && f.notifySms) {
    const number = toE164(f.phone);
    if (number) {
      const res = await smsTransport().send(number, {
        subject: mine.subject,
        body: `RG Pilates Studio: ${mine.subject}. ${mine.body}`.slice(0, 300),
      });
      if (res.ok) reached++;
    }
  }
  return reached;
}

/**
 * The reminder sweep.
 *
 * Every row that has come due and has not been sent. The lead time on the row is
 * the one the member was promised when they booked, not whatever they have set
 * today — see reminders.ts. A row is marked sent whether or not a device was
 * reached, because the alternative is retrying forever at every member who has
 * never allowed notifications.
 */
export async function runDueReminders(now = new Date()) {
  const queue = dueReminders(now);
  if (queue.length === 0) {
    return { due: 0, pushed: 0, emailed: 0, texted: 0, stale: 0 };
  }

  /**
   * A reminder for a class that has already begun is not a reminder.
   *
   * This matters the first time a sweep runs after not running for a while:
   * without it, a server coming back up would tell somebody their Tuesday class
   * starts "now" on Thursday, for every class they had booked in between. The
   * rows are closed rather than left pending, because they will never become
   * sendable — every minute that passes makes them more wrong.
   *
   * A reminder that is merely *late* still goes: "starts in 5 minutes" when
   * thirty was intended is worth having, and better than silence.
   */
  const stale = queue.filter((r) => r.startsAt.getTime() <= now.getTime());
  const due = queue.filter((r) => r.startsAt.getTime() > now.getTime());

  if (stale.length > 0) {
    markSent(stale.map((r) => r.id), now);
  }

  if (due.length === 0) {
    return { due: 0, pushed: 0, emailed: 0, texted: 0, stale: stale.length };
  }

  let pushed = 0;
  let emailed = 0;
  let texted = 0;

  for (const r of due) {
    const minutes = Math.max(
      0,
      Math.round((r.startsAt.getTime() - now.getTime()) / 60_000),
    );
    const words = reminderWords({ minutes, startsAt: r.startsAt });

    /* The row remembers which channels the member had on when they booked. The
       table above can narrow that but never widen it. */
    const rowChannels = r.channels.split(",");
    const use = (c: Channel) =>
      SENDS.reminder[c as "email" | "sms"] && rowChannels.includes(c);

    const mine = say(words, r.userLocale);

    inbox(r.userId, words);
    if (SENDS.reminder.push) pushed += await pushToUser(r.userId, mine);

    if (use("email") && r.userEmail) {
      const res = await emailTransport().send(r.userEmail, forEmail(words));
      if (res.ok) emailed++;
    }
    if (use("sms")) {
      const number = toE164(r.userPhone);
      if (number) {
        const res = await smsTransport().send(number, {
          subject: mine.subject,
          body: `RG Pilates Studio: ${mine.body}`.slice(0, 300),
        });
        if (res.ok) texted++;
      }
    }
  }

  markSent(due.map((r) => r.id), now);
  return { due: due.length, pushed, emailed, texted, stale: stale.length };
}

/**
 * A throttled sweep, safe to call from any request.
 *
 * Reminders have to go out whether or not anybody is looking at the site, which
 * is what the cron route is for. This is the belt to that braces: an ordinary
 * page view nudges the queue along, at most once a minute, without ever making
 * the visitor wait for it.
 */
let lastSweep = 0;

/* ------------------------------------------------- tomorrow, at half eleven */

/**
 * Which studio day this process has already sent the nightly note for.
 *
 * The cheap latch. Module state, so a restart forgets it — which is why it is
 * not the only one: the durable check is a notice row per member, below. This
 * one exists so the sweep does not run the same query thirty times between
 * 23:30 and midnight, not to make the send correct.
 */
let lastNightly = "";

/** The hour and minute the studio asked for, in studio wall time. */
const NIGHTLY_HOUR = 23;
const NIGHTLY_MINUTE = 30;

/**
 * One message a member, at 23:30, naming what they have booked tomorrow.
 *
 * ---
 *
 * **Why it is not a reminder, and does not go through the reminder queue.**
 *
 * `bookingReminders` holds one row per booking and a unique index says so, and
 * that is right for what it does: a reminder belongs to a class and carries the
 * lead time the member was promised when they booked it. This belongs to a
 * *day* and to a member, and a member with two classes tomorrow gets one
 * message about both. Squeezing it into that table would have meant either
 * breaking the one-per-booking rule or sending two notes at 23:30.
 *
 * ---
 *
 * **Why it is safe to call every sixty seconds.**
 *
 * Because it is, and something does: `instrumentation.ts` knocks on the cron
 * route every minute, which is what makes this reliable rather than dependent
 * on somebody loading the site at half eleven at night. So it is written to be
 * idempotent rather than to be called carefully.
 *
 * Two guards, and the second is the one that matters. `lastNightly` stops the
 * repeated work inside one process. The notice row — segment `nightly:<day>` —
 * is the one that survives a deploy at 23:35, and it is checked per member, so
 * a restart half way through the batch resumes rather than starting again.
 *
 * **It does not catch up.** Miss the window entirely — the server was down from
 * 23:00 to 00:30 — and nobody is told, rather than being told at half past
 * midnight that they have a class "tomorrow" which is in fact today. The
 * per-class reminder still fires either way, so the failure costs a courtesy
 * and not a class.
 */
export async function runNightlyDigest(now = new Date()) {
  const parts = studioParts(now);
  const beforeTime =
    parts.hour < NIGHTLY_HOUR ||
    (parts.hour === NIGHTLY_HOUR && parts.minute < NIGHTLY_MINUTE);
  const today = studioDateKey(now);
  if (beforeTime || lastNightly === today) {
    return { ran: false as const, told: 0, pushed: 0 };
  }

  /* Tomorrow, in the studio's own day rather than in 24-hour steps: the day
     after a clock change is 23 or 25 hours long and both ends of it are still
     one studio day. */
  const from = studioAddDays(studioStartOfDay(now), 1);
  const to = studioAddDays(from, 1);
  const tomorrow = studioDateKey(from);

  const rows = db
    .select({
      userId: users.id,
      locale: users.locale,
      startsAt: classSessions.startsAt,
      classEn: classTypes.nameEn,
      classEl: classTypes.nameEl,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.userId, users.id))
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .innerJoin(classTypes, eq(classSessions.classTypeId, classTypes.id))
    .where(
      and(
        eq(bookings.status, "CONFIRMED"),
        gte(classSessions.startsAt, from),
        lt(classSessions.startsAt, to),
        ne(classSessions.status, "CANCELLED"),
      ),
    )
    .orderBy(classSessions.startsAt)
    .all();

  /* Marked done even when nobody has a class tomorrow: the answer is correct
     and repeating the query every minute until midnight would not change it. */
  lastNightly = today;
  if (rows.length === 0) return { ran: true as const, told: 0, pushed: 0 };

  const byMember = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byMember.get(r.userId);
    if (list) list.push(r);
    else byMember.set(r.userId, [r]);
  }

  /* The durable mark, and it is checked per member rather than once for the
     batch: a deploy part way through must not re-tell the members it had
     already reached, and must still reach the ones it had not. */
  const stamp = `nightly:${tomorrow}`;
  const already = new Set(
    db
      .select({ userId: notices.userId })
      .from(notices)
      .where(eq(notices.segment, stamp))
      .all()
      .map((n) => n.userId ?? ""),
  );

  let told = 0;
  let pushed = 0;
  for (const [userId, classes] of byMember) {
    if (already.has(userId)) continue;

    const words = tomorrowWords({
      classes: classes.map((c) => ({
        startsAt: c.startsAt,
        classEn: c.classEn,
        classEl: c.classEl || c.classEn,
      })),
    });

    /* The account copy first and unconditionally, and it doubles as the mark.
       Written before the push rather than after, so a push service that hangs
       cannot leave a member markable-but-unmarked and get a second note the
       next minute. */
    try {
      createNotice({
        titleEn: words.en.subject,
        bodyEn: words.en.body,
        titleEl: words.el.subject,
        bodyEl: words.el.body,
        channels: SENDS.nightly.push ? ["push"] : [],
        segment: stamp,
        userId,
        staffId: null,
      });
    } catch {
      /* Could not write the mark, so do not send: better a missed courtesy
         than one that repeats every minute for half an hour. */
      continue;
    }
    told++;

    if (SENDS.nightly.push) {
      pushed += await pushToUser(userId, say(words, classes[0]?.locale));
    }
  }

  return { ran: true as const, told, pushed };
}

export function nudgeReminders() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  void runDueReminders().catch(() => {
    /* A failed sweep is retried a minute later by the next visitor. */
  });
}

/* Re-exported so the wording stays testable from where it always was. */
export { whenWords, leadWords };

/* ------------------------------------------------------------- monthly plans */

async function memberFacts(userId: string) {
  const row = db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row) return null;
  return {
    ...row,
    startsAt: new Date(),
    classEn: "",
    classEl: "",
    classKind: "GROUP" as const,
    guestName: null,
  };
}

function planFacts(userId: string) {
  const v = currentSubscription(userId);
  if (!v) return null;
  return {
    months: v.months,
    perWeek: v.perWeek,
    monthlyPriceCents: v.monthlyPriceCents,
    paidThrough: v.paidThrough,
    dueBy: v.dueBy,
    monthsPaid: v.monthsPaid,
    creditsRemaining: v.creditsRemaining,
  };
}

/** A month of a plan has been paid (the first one starts the plan). */
export async function notifySubscriptionPaid(subscriptionId: string, purchaseId: string | null) {
  const sub = subscriptionById(subscriptionId);
  if (!sub) return 0;
  const f = await memberFacts(sub.userId);
  const p = planFacts(sub.userId);
  if (!f || !p) return 0;
  void purchaseId;
  return deliverPersonal(f, planPaidWords(p, sub.monthsPaid === 1), {
    email: true,
    push: true,
    sms: false,
  });
}

/**
 * The plan sweep: lapse the overdue, and remind the due. Rides the cron sweep
 * like everything else that has to happen whether or not anybody is looking.
 */
export async function runSubscriptionSweep(now = new Date()) {
  const lapsedBefore = db
    .select({ id: subscriptions.id, userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.status, "ACTIVE"))
    .all();

  const result = sweepSubscriptions(now);

  /* Whoever was active before and is lapsed now was lapsed by this sweep. */
  if (result.lapsed) {
    const nowLapsed = db
      .select({ id: subscriptions.id, userId: subscriptions.userId })
      .from(subscriptions)
      .where(eq(subscriptions.status, "LAPSED"))
      .all()
      .filter((s) => lapsedBefore.some((b) => b.id === s.id));
    for (const s of nowLapsed) {
      const f = await memberFacts(s.userId);
      const p = planFacts(s.userId);
      if (f && p) {
        await deliverPersonal(f, planLapsedWords(p, result.released), {
          email: true,
          push: true,
          sms: false,
        });
      }
    }
  }

  let reminded = 0;
  for (const r of result.remind) {
    const f = await memberFacts(r.subscription.userId);
    const p = planFacts(r.subscription.userId);
    if (!f || !p) continue;
    await deliverPersonal(f, planDueWords(p, r.kind), { email: true, push: true, sms: false });
    reminded++;
  }

  return { lapsed: result.lapsed, released: result.released, completed: result.completed, reminded };
}
