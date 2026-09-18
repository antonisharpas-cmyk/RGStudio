import { STUDIO } from "@/lib/studio";
import type { Outgoing } from "./types";

/**
 * The words, in both languages.
 *
 * Everything a member reads is written here rather than at the point it is sent,
 * for two reasons. The first is that the studio is in Larnaca: a member is as
 * likely to read Greek as English, and we do not ask them which, so an email
 * carries both. The second is that the same sentence goes to three different
 * places — the account, an inbox, a phone — and they must not be allowed to
 * drift apart into three slightly different accounts of the same fact.
 *
 * Where each language goes:
 *
 *   in the app   both are stored; the site shows whichever the member is
 *                reading it in, because it already knows that
 *   email        both, English above Greek, separated by a rule — we have no
 *                idea which they prefer and guessing wrong is worse than
 *                showing two
 *   push         one language, the member's own — see `say` below. A phone
 *                notification is one line and there is no room for two.
 *   sms          the same, and for the same reason, only harder: Greek costs
 *                three times the segments, so length is checked after the
 *                language is chosen and not before.
 */

export type Bilingual = { en: Outgoing; el: Outgoing };

/**
 * One of the two, for the channels that can only carry one.
 *
 * Push and SMS have room for a single language, and for a long time that
 * language was English for everybody. A member who had used the switch at the
 * top of every page to read the site in Greek got a Greek copy of a message in
 * their account and an English copy of the same message on their phone, which
 * is worse than either alone: it looks like the studio does not know which
 * language it speaks to them in.
 *
 * The argument takes the raw column rather than a `Locale`, so every caller can
 * pass `user.locale` straight from a query without a cast or a check. Anything
 * that is not exactly "el" means English, which covers null, an old row, and a
 * value somebody typed by hand — the safe direction, because English is the
 * language the studio itself is administered in. Members reading the site in
 * Russian ("ru") get the English wording of every notification and email until
 * a Russian version is written.
 */
export function say(m: Bilingual, locale?: string | null): Outgoing {
  return locale === "el" ? m.el : m.en;
}

/* ------------------------------------------------------------------ the dates */

/** "Saturday 29 August at 18:00" / "Σάββατο 29 Αυγούστου στις 18:00". */
export function whenWords(d: Date, lang: "en" | "el" = "en") {
  const locale = lang === "el" ? "el-GR" : "en-GB";
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: STUDIO.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: STUDIO.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return lang === "el" ? `${day} στις ${time}` : `${day} at ${time}`;
}

/** "25 November 2026" / "25 Νοεμβρίου 2026". */
export function dateWords(d: Date, lang: "en" | "el" = "en") {
  return new Intl.DateTimeFormat(lang === "el" ? "el-GR" : "en-GB", {
    timeZone: STUDIO.timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * The slot rather than the date: "every Monday at 16:00".
 *
 * What a member books when they book a term. Twelve dates is a list; one
 * weekday and one hour is the thing they actually chose, and it is what they
 * will recognise on a lock screen.
 *
 * "every {weekday}" in both languages rather than a plural weekday, because
 * Greek inflects the noun and "Δευτέρες" is not a word anybody writes. "κάθε
 * Δευτέρα" is, and it is what the day itself is called, so nothing has to be
 * pluralised.
 */
export function slotWords(d: Date, lang: "en" | "el" = "en") {
  const locale = lang === "el" ? "el-GR" : "en-GB";
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: STUDIO.timezone,
    weekday: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: STUDIO.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return lang === "el"
    ? `κάθε ${day} στις ${time}`
    : `every ${day} at ${time}`;
}

/**
 * Two dates as a span: "8 September to 24 November 2026".
 *
 * The year is said once, at the end, where it belongs. `dateWords` twice would
 * give "8 September 2026 to 24 November 2026", and a member reading a phone
 * notification does not need telling twice which year it is.
 *
 * Across a new year it says both, because then it genuinely matters: a
 * twelve-month run starting in December ends in the year after, and "8 December
 * to 2 March" hides the one fact that makes the span surprising.
 */
export function rangeWords(from: Date, to: Date, lang: "en" | "el" = "en") {
  const locale = lang === "el" ? "el-GR" : "en-GB";
  const year = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: STUDIO.timezone,
      year: "numeric",
    }).format(d);
  const short = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: STUDIO.timezone,
      day: "numeric",
      month: "long",
    }).format(d);

  const sameYear = year(from) === year(to);
  const left = sameYear ? short(from) : dateWords(from, lang);
  const right = dateWords(to, lang);
  return lang === "el" ? `${left} έως ${right}` : `${left} to ${right}`;
}

/** "1 class" / "12 classes", and the Greek, which inflects the noun. */
export function classWords(n: number, lang: "en" | "el" = "en") {
  if (lang === "el") return n === 1 ? "1 μάθημα" : `${n} μαθήματα`;
  return n === 1 ? "1 class" : `${n} classes`;
}

/** "1 week" / "4 weeks", same reason. */
export function weekWords(n: number, lang: "en" | "el" = "en") {
  if (lang === "el") return n === 1 ? "1 εβδομάδα" : `${n} εβδομάδες`;
  return n === 1 ? "1 week" : `${n} weeks`;
}

/** Minutes, said the way a person would say them. */
export function leadWords(minutes: number, lang: "en" | "el" = "en") {
  const el = lang === "el";
  if (minutes <= 0) return el ? "τώρα" : "now";
  if (minutes < 60) return el ? `${minutes} λεπτά` : `${minutes} minutes`;
  const h = minutes / 60;
  if (Number.isInteger(h)) {
    if (el) return h === 1 ? "1 ώρα" : `${h} ώρες`;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const whole = Math.floor(h);
  const rest = minutes % 60;
  return el ? `${whole}ω ${rest}λ` : `${whole}h ${rest}m`;
}

/** "1 session" / "10 sessions", and the Greek, which inflects the noun. */
export function sessionWords(n: number, lang: "en" | "el" = "en") {
  if (lang === "el") return n === 1 ? "1 συνεδρία" : `${n} συνεδρίες`;
  return n === 1 ? "1 session" : `${n} sessions`;
}

/** Money, with the decimals dropped when there are none to show. */
export function moneyWords(cents: number, currency: string, lang: "en" | "el" = "en") {
  return new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/* --------------------------------------------------------------- the messages */

export function bookedWords(a: {
  classEn: string;
  classEl: string;
  startsAt: Date;
}): Bilingual {
  return {
    en: {
      subject: "Booking confirmed",
      body: `${a.classEn}, ${whenWords(a.startsAt)}. See you at the studio.`,
      url: "/account?tab=notifications",
    },
    el: {
      subject: "Η κράτηση επιβεβαιώθηκε",
      body: `${a.classEl}, ${whenWords(a.startsAt, "el")}. Σας περιμένουμε στο στούντιο.`,
      url: "/account?tab=notifications",
    },
  };
}

/**
 * A whole run of weeks, in one message.
 *
 * ---
 *
 * **What this replaced, and why it was worse than it looked.**
 *
 * Booking a term already sent exactly one notification, which was the right
 * instinct: fifty-two phone buzzes for one press is how a member learns to
 * turn notifications off, and there is no coming back from that — the studio
 * loses the channel it uses to say a class is cancelled.
 *
 * But the one message it sent was `bookedWords` for the *first* class of the
 * run. So a member who booked their Monday for a year was told "Reformer Flow,
 * Monday 8 September at 16:00. See you at the studio." — a true sentence about
 * one class, and a misleading account of what just happened to their balance.
 * Fifty-one classes and fifty-two sessions went unmentioned.
 *
 * Quiet and wrong is not better than loud. This says the whole thing once.
 *
 * ---
 *
 * **What goes in it.**
 *
 * The slot, because that is what they chose. The count and the span, because
 * that is what it cost and how far it reaches. And the weeks that could not be
 * taken *with the reason*, because that is the only part they can act on.
 *
 * The reason is not decoration. The screen already learned this lesson: a
 * member with a 30-day pack asking for eight weeks was once told "booked 4 of
 * 8" while looking at eight unspent sessions, which reads as a fault in the
 * website. The true answer is that the pack runs out on the 3rd of October, and
 * it is both the explanation and the thing to do about it. The person who most
 * needs that sentence is the one who booked over the telephone and is not
 * looking at any screen at all.
 *
 * Where the failures disagree about why, it names the dates instead, up to
 * three of them. It deliberately does not say "open your account to see which"
 * — a refused week is not written down anywhere, so that would be sending
 * somebody to look at a list that does not exist. Past three, the count is the
 * honest answer.
 */
export function repeatBookedWords(a: {
  classEn: string;
  classEl: string;
  /** The first class actually booked. Its weekday and hour are the slot. */
  firstStartsAt: Date;
  /** The last one, so the message can say how far the run reaches. */
  lastStartsAt: Date;
  booked: number;
  /** Weeks that were already theirs. Not a failure and not a new booking. */
  alreadyHad: number;
  /** Every week that could not be taken, with its date and its reason. */
  failed: { startsAt: string; code?: string; until?: string }[];
}): Bilingual {
  const asked = a.booked + a.alreadyHad + a.failed.length;

  /* One reason, or none. `code` is the BookingResultCode the booking rules
     returned; it is typed loosely here so this module stays independent of
     them, and an unrecognised one falls through to the generic sentence rather
     than to an empty string. */
  const codes = [...new Set(a.failed.map((f) => f.code ?? "OTHER"))];
  const only = codes.length === 1 ? codes[0] : null;
  const until = a.failed.find((f) => f.until)?.until;

  /**
   * The refused dates, as a list a person would read: "6 and 13 October", or
   * "6 October, 13 October and 20 October". Only ever up to three, because
   * four is a paragraph and twenty is a wall.
   */
  function dateList(lang: "en" | "el") {
    const locale = lang === "el" ? "el-GR" : "en-GB";
    const parts = a.failed.slice(0, 3).map((f) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: STUDIO.timezone,
        day: "numeric",
        month: "long",
      }).format(new Date(f.startsAt)),
    );
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    const rest = parts.slice(0, -1).join(", ");
    return lang === "el" ? `${rest} και ${last}` : `${rest} and ${last}`;
  }

  function why(lang: "en" | "el") {
    const k = a.failed.length;
    if (!k) return "";
    const weeks = weekWords(k, lang);
    const el = lang === "el";

    /* An expiry names the date the pack reaches. Without it the member is told
       their sessions are no good and left to work out which date would have
       worked. */
    if (only === "SESSIONS_EXPIRE_FIRST" && until) {
      const d = dateWords(new Date(until), lang);
      return el
        ? ` ${weeks} δεν κρατήθηκαν: οι συνεδρίες σας λήγουν στις ${d}. Ανανεώστε και οι εβδομάδες αυτές είναι ανοιχτές.`
        : ` ${weeks} could not be booked: your sessions expire on ${d}. Top up and those weeks are open.`;
    }
    if (only === "CLASS_FULL") {
      return el
        ? ` ${weeks} δεν κρατήθηκαν, γιατί τα μαθήματα είναι ήδη πλήρη.`
        : ` ${weeks} could not be booked, because those classes are already full.`;
    }
    if (only === "NO_CREDITS" || only === "CREDITS_NOT_VALID_HERE") {
      return el
        ? ` ${weeks} δεν κρατήθηκαν, γιατί δεν έχετε συνεδρίες που να τις καλύπτουν. Ανανεώστε και κρατήστε τις.`
        : ` ${weeks} could not be booked, because you have no sessions that can pay for them. Top up and book those weeks.`;
    }
    if (only === "TOO_LATE" || only === "SESSION_CANCELLED") {
      return el
        ? ` ${weeks} δεν κρατήθηκαν, γιατί οι κρατήσεις είχαν κλείσει.`
        : ` ${weeks} could not be booked, because booking had closed for them.`;
    }
    if (only === "ONE_PER_DAY") {
      return el
        ? ` ${weeks} δεν κρατήθηκαν: το πρόγραμμά σας επιτρέπει ένα μάθημα την ημέρα.`
        : ` ${weeks} could not be booked: your plan allows one class a day.`;
    }
    /* Mixed reasons, or one we have no sentence for. The dates are the useful
       part when there are few enough to say. */
    if (k <= 3) {
      return el
        ? ` ${weeks} δεν κρατήθηκαν: ${dateList("el")}.`
        : ` ${weeks} could not be booked: ${dateList("en")}.`;
    }
    return el
      ? ` ${weeks} δεν κρατήθηκαν. Δείτε το πρόγραμμα για τις ημερομηνίες αυτές.`
      : ` ${weeks} could not be booked. The timetable shows what is open on those dates.`;
  }

  function had(lang: "en" | "el") {
    if (!a.alreadyHad) return "";
    return lang === "el"
      ? ` ${weekWords(a.alreadyHad, "el")} τις είχατε ήδη.`
      : ` ${weekWords(a.alreadyHad)} you already had.`;
  }

  /* A run that landed a single week is described as the one class it is. "1
     classes, 8 September to 8 September" is what the general form would say,
     and it happens whenever eleven of twelve weeks are full. */
  function when(lang: "en" | "el") {
    const cls = lang === "el" ? a.classEl : a.classEn;
    if (a.booked === 1) return `${cls}, ${whenWords(a.firstStartsAt, lang)}.`;
    return `${cls}, ${slotWords(a.firstStartsAt, lang)}. ${classWords(
      a.booked,
      lang,
    )}, ${rangeWords(a.firstStartsAt, a.lastStartsAt, lang)}.`;
  }

  const short = a.failed.length > 0;

  return {
    en: {
      subject: short
        ? `${a.booked} of ${asked} classes booked`
        : `${classWords(a.booked)} booked`,
      body: `${when("en")}${why("en")}${had("en")}`,
      url: "/account?tab=classes",
    },
    el: {
      subject: short
        ? `Κρατήθηκαν ${a.booked} από ${asked} μαθήματα`
        : `Κρατήθηκαν ${classWords(a.booked, "el")}`,
      body: `${when("el")}${why("el")}${had("el")}`,
      url: "/account?tab=classes",
    },
  };
}

/**
 * The last thing a member hears at night: what they have booked tomorrow.
 *
 * ---
 *
 * **Why this is not the same as a reminder.**
 *
 * The reminder before each class answers "it starts soon" and is timed to the
 * member's own lead — thirty minutes, two hours, whatever they chose. This
 * answers a different question, asked at a different moment: what have I got on
 * tomorrow, asked while somebody is deciding what time to set an alarm for.
 *
 * Which is why it is one message about a day rather than one per class. A
 * member with a 09:00 and an 18:00 gets a single line naming both, and still
 * gets each class's own reminder on the day.
 *
 * ---
 *
 * The times are the content, so they lead. The class name is the same phrase
 * on every line for a studio that teaches one kind of class, so it is said once
 * and not repeated per time.
 */
export function tomorrowWords(a: {
  /** Every class they have booked tomorrow, earliest first. */
  classes: { startsAt: Date; classEn: string; classEl: string }[];
}): Bilingual {
  const times = (lang: "en" | "el") =>
    a.classes.map((c) =>
      new Intl.DateTimeFormat(lang === "el" ? "el-GR" : "en-GB", {
        timeZone: STUDIO.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(c.startsAt),
    );

  /* "09:00 and 18:00", joined the way the reader's own language joins a list.
     Falls back to commas where Intl.ListFormat is missing, which is only very
     old runtimes but is one line to survive. */
  const joined = (lang: "en" | "el") => {
    const parts = times(lang);
    if (parts.length === 1) return parts[0];
    try {
      return new Intl.ListFormat(lang === "el" ? "el" : "en-GB", {
        style: "long",
        type: "conjunction",
      }).format(parts);
    } catch {
      return parts.join(", ");
    }
  };

  /* One class type in the studio today, so the name is said once. If the
     studio ever teaches two on one day this still reads correctly: the name of
     the first, and the times of all of them. */
  const nameEn = a.classes[0]?.classEn ?? "";
  const nameEl = a.classes[0]?.classEl ?? nameEn;
  const many = a.classes.length > 1;

  return {
    en: {
      subject: many ? "Your classes tomorrow" : "Your class tomorrow",
      body: `${nameEn}, tomorrow at ${joined("en")}. See you at the studio.`,
      url: "/account?tab=classes",
    },
    el: {
      subject: many ? "Τα μαθήματά σου αύριο" : "Το μάθημά σου αύριο",
      body: `${nameEl}, αύριο στις ${joined("el")}. Σας περιμένουμε στο στούντιο.`,
      url: "/account?tab=classes",
    },
  };
}

export function cancelledWords(a: {
  classEn: string;
  classEl: string;
  startsAt: Date;
  refunded: boolean;
}): Bilingual {
  return {
    en: {
      subject: "Booking cancelled",
      body:
        `${a.classEn}, ${whenWords(a.startsAt)}, is cancelled. ` +
        (a.refunded
          ? "The session is back in your balance."
          : "This was inside the 12-hour window, so the session was used."),
      url: "/account?tab=notifications",
    },
    el: {
      subject: "Η κράτηση ακυρώθηκε",
      body:
        `${a.classEl}, ${whenWords(a.startsAt, "el")}, ακυρώθηκε. ` +
        (a.refunded
          ? "Η συνεδρία επέστρεψε στο υπόλοιπό σας."
          : "Η ακύρωση έγινε εντός 12 ωρών, γι' αυτό η συνεδρία χρησιμοποιήθηκε."),
      url: "/account?tab=notifications",
    },
  };
}

export function purchasedWords(a: {
  credits: number;
  amountCents: number;
  currency: string;
  expiresAt: Date | null;
  /**
   * The provider's hosted receipt, when there is one. Kept, and deliberately
   * *not* put in this email.
   *
   * It was in here for a while, as a line saying "Your receipt: https://…".
   * Two things are wrong with that. A raw payment-processor URL in the studio's
   * own confirmation is the shape of a phishing email, and it is the one line a
   * cautious member would be right not to click. And Stripe's receipt links
   * expire after thirty days — the receipt does not, but the link does — so an
   * email kept for the accountant in March holds a dead link by April.
   *
   * Stripe sends its own receipt instead, to the same address, from its own
   * domain, with the studio's name and logo on it. Switched on in the Stripe
   * dashboard under Customer emails, and it needs nothing from this file.
   *
   * The value still reaches the member's account page, where a link that can be
   * re-issued makes sense: they are signed in, looking at their own payment
   * history, and an expired link there asks them for their address and mails a
   * fresh one. Kept on the argument here so nobody wonders where it went.
   */
  receiptUrl?: string | null;
  /**
   * Whether an invoice PDF is riding along with this email.
   *
   * Passed in rather than assumed, because the attachment can fail — and an
   * email that says "your invoice is attached" with nothing attached is worse
   * than one that says nothing. The sentence only appears when the file
   * actually did.
   */
  hasInvoice?: boolean;
}): Bilingual {
  const expiryEn = a.expiresAt
    ? ` They expire on ${dateWords(a.expiresAt)}.`
    : "";
  const expiryEl = a.expiresAt
    ? ` Λήγουν στις ${dateWords(a.expiresAt, "el")}.`
    : "";

  /* Where the receipt line used to be. See the note on `receiptUrl` above:
     Stripe mails the receipt itself, and a processor URL in the studio's own
     email reads like a phishing attempt and dies after thirty days.

     What is here instead is the studio's own invoice, as a file. A sentence
     rather than nothing, because an attachment somebody is not expecting is an
     attachment somebody does not open. */
  const invoiceEn = a.hasInvoice
    ? " Your VAT invoice is attached."
    : "";
  const invoiceEl = a.hasInvoice
    ? " Το τιμολόγιό σας είναι συνημμένο."
    : "";

  return {
    en: {
      subject: "Payment received",
      body:
        `${sessionWords(a.credits)} added to your balance for ` +
        `${moneyWords(a.amountCents, a.currency)}.${expiryEn}${invoiceEn}`,
      url: "/account?tab=payments",
    },
    el: {
      subject: "Η πληρωμή ελήφθη",
      body:
        `${sessionWords(a.credits, "el")} προστέθηκαν στο υπόλοιπό σας για ` +
        `${moneyWords(a.amountCents, a.currency, "el")}.${expiryEl}${invoiceEl}`,
      url: "/account?tab=payments",
    },
  };
}

export function reminderWords(a: {
  minutes: number;
  startsAt: Date;
}): Bilingual {
  return {
    en: {
      subject: "Your class is coming up",
      body: `Your class starts in ${leadWords(a.minutes)}, at ${whenWords(a.startsAt)}.`,
      url: "/account",
    },
    el: {
      subject: "Το μάθημά σας πλησιάζει",
      body: `Το μάθημά σας ξεκινά σε ${leadWords(a.minutes, "el")}, ${whenWords(a.startsAt, "el")}.`,
      url: "/account",
    },
  };
}

/**
 * "Here is a free session, and here are the dates you can use it."
 *
 * The window is the whole message. A free session a member cannot work out how
 * to spend is worse than no free session, because they try, fail, and conclude
 * the site is broken. So the dates come first and the expiry date comes second,
 * and there is nothing after it: a welcome message that carries on into seat
 * counts and opening hours stops being read before it gets to the part that
 * matters.
 *
 * `expires` defaults to `to` because they are the same day in this campaign, but
 * they answer different questions (the last class it books, versus the last
 * moment it can be spent) and a future offer may separate them.
 *
 * The dates are interpolated and the campaign is never named in words. It said
 * "our opening week" until the offer became a month, at which point the message
 * was describing a week and quoting a month at the member in the same sentence.
 * A campaign whose length is written into the prose is a campaign that has to be
 * translated again every time the studio moves a date.
 */
export function promoWords(a: {
  credits: number;
  from: Date;
  to: Date;
  expires?: Date;
}): Bilingual {
  const dayEn = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: STUDIO.timezone,
      day: "numeric",
      month: "long",
    }).format(d);
  const dayEl = (d: Date) =>
    new Intl.DateTimeFormat("el-GR", {
      timeZone: STUDIO.timezone,
      day: "numeric",
      month: "long",
    }).format(d);

  const expires = a.expires ?? a.to;
  const one = a.credits === 1;

  return {
    en: {
      subject:
        one ? "A free session, on us" : `${a.credits} free sessions, on us`,
      body:
        `Welcome to RG Pilates Studio. ${sessionWords(a.credits)} ` +
        `${one ? "is" : "are"} already in your balance, on the studio.\n\n` +
        `You can use ${one ? "it" : "them"} for any class from ${dayEn(a.from)} to ` +
        `${dayEn(a.to)}. ${one ? "The session expires" : "The sessions expire"} on ` +
        `${dayEn(expires)}, so please book before then.`,
      url: "/timetable",
    },
    el: {
      subject: one ? "Μια συνεδρία δώρο" : `${a.credits} συνεδρίες δώρο`,
      body:
        `Καλώς ήρθατε στο RG Pilates Studio. ${sessionWords(a.credits, "el")} ` +
        `βρίσκ${one ? "εται" : "ονται"} ήδη στο υπόλοιπό σας, με την ευγενική ` +
        `προσφορά του στούντιο.\n\n` +
        `Μπορείτε να ${one ? "τη" : "τις"} χρησιμοποιήσετε σε οποιοδήποτε μάθημα ` +
        `από τις ${dayEl(a.from)} έως τις ${dayEl(a.to)}. ` +
        `${one ? "Η συνεδρία λήγει" : "Οι συνεδρίες λήγουν"} στις ` +
        `${dayEl(expires)}, γι' αυτό κλείστε θέση πριν από τότε.`,
      url: "/timetable",
    },
  };
}

/**
 * Sessions the desk added for free, told to the member.
 *
 * No price and no invoice, because nothing was paid: a comped or corrected
 * balance is not a sale. Deliberately plainer than the opening-week gift, which
 * is a welcome; this is a quieter "the studio has topped you up".
 */
export function grantedWords(a: { credits: number }): Bilingual {
  const one = a.credits === 1;
  return {
    en: {
      subject: one
        ? "A session added to your account"
        : `${a.credits} sessions added to your account`,
      body:
        `The studio has added ${sessionWords(a.credits)} to your account. ` +
        `${one ? "It is" : "They are"} ready to use, so book any class from your timetable.`,
      url: "/timetable",
    },
    el: {
      subject: one
        ? "Μια συνεδρία προστέθηκε στον λογαριασμό σου"
        : `${a.credits} συνεδρίες προστέθηκαν στον λογαριασμό σου`,
      body:
        `Το στούντιο πρόσθεσε ${sessionWords(a.credits, "el")} στον λογαριασμό σου. ` +
        `${one ? "Είναι έτοιμη" : "Είναι έτοιμες"} για χρήση, οπότε κλείσε όποιο μάθημα θέλεις από το πρόγραμμά σου.`,
      url: "/timetable",
    },
  };
}

/**
 * The studio's own copy of a free grant, for the operations mailbox.
 *
 * The counterpart to studioPaidWords for the till that takes no money: the desk
 * gave sessions away, and the owner should see it in the same place they see
 * every sale. A record to scan, so it is a line and a contact, not prose. No
 * invoice, because a gift has none.
 */
export function studioGrantedWords(a: {
  memberName: string;
  memberEmail: string;
  memberPhone: string | null;
  credits: number;
  staffName?: string | null;
}): Bilingual {
  const contact = [a.memberEmail, a.memberPhone].filter(Boolean).join(", ");
  return {
    en: {
      subject: `Free sessions given: ${a.memberName}`,
      body: [
        `${a.memberName} — ${contact}`,
        `${sessionWords(a.credits)} added free${a.staffName ? `, by ${a.staffName}` : ""}`,
      ].join("\n"),
    },
    el: {
      subject: `Δωρεάν συνεδρίες: ${a.memberName}`,
      body: [
        `${a.memberName} — ${contact}`,
        `${sessionWords(a.credits, "el")} δωρεάν${a.staffName ? `, από ${a.staffName}` : ""}`,
      ].join("\n"),
    },
  };
}

/**
 * The confirmation code, on its way to a mailbox.
 *
 * The code is in the subject line as well as the body, deliberately. It is the
 * one email in this system whose whole job is to be read off a lock screen
 * without opening anything: the member is sitting in front of the site with the
 * box waiting, and making them open a mail app, find the message and scroll is
 * three steps of friction on the last screen of signing up. Every large service
 * puts it in the subject for exactly this reason, and what it guards here is an
 * email address rather than money.
 *
 * The last paragraph matters as much as the code. Somebody may receive this
 * because a stranger mistyped an address, and they are owed a sentence telling
 * them that ignoring it is enough — an account nobody confirms is an account
 * nobody can use.
 */
/**
 * The same event, said without the code in it.
 *
 * For the in-app copy and the phone notification. The studio asked for the
 * registration message on every channel, and it is on every channel — but the
 * six digits stay in the email alone, deliberately.
 *
 * Two reasons. A notification sits on a lock screen and an in-app notice sits
 * in a list that anybody already holding the unlocked phone can read, so
 * putting the code in either files a credential next to the door it opens. And
 * the whole point of the code is to prove that the person controls that
 * mailbox: sending it anywhere else undoes the check it exists to perform.
 *
 * So the member gets told, on the channels they asked for, that a code is on
 * its way and where to look. The code itself arrives in the one place that
 * proves something.
 */
export function verifySentWords(a: { minutes: number }): Bilingual {
  return {
    en: {
      subject: "Confirm your email address",
      body:
        `Your confirmation code is on its way by email. Type it into the site ` +
        `to finish signing up.\n\nThe code expires in ${a.minutes} minutes, and ` +
        `you can ask for a new one at any time.`,
      url: "/verify",
    },
    el: {
      subject: "Επιβεβαίωσε το email σου",
      body:
        `Ο κωδικός επιβεβαίωσης είναι στον δρόμο του με email. ` +
        `Πληκτρολόγησέ τον στην ιστοσελίδα για να ολοκληρώσεις την εγγραφή.` +
        `\n\nΟ κωδικός λήγει σε ${a.minutes} λεπτά και μπορείς να ζητήσεις νέο ` +
        `όποτε θέλεις.`,
      url: "/verify",
    },
  };
}

export function verifyWords(a: { code: string; minutes: number }): Bilingual {
  return {
    en: {
      subject: `${a.code} is your RG Pilates Studio code`,
      body:
        `Somebody has just created an RG Pilates Studio account with this email ` +
        `address. We hope it was you.\n\n` +
        `Your confirmation code is ${a.code}\n\n` +
        `Type it into the site to finish signing up. The code expires in ` +
        `${a.minutes} minutes, and you can ask for a new one at any time.\n\n` +
        `If this was not you, ignore this email. The account cannot be used ` +
        `until the code is typed, so nothing else will happen.`,
      url: "/verify",
    },
    el: {
      subject: `${a.code} είναι ο κωδικός σας για το RG Pilates Studio`,
      body:
        `Κάποιος μόλις δημιούργησε λογαριασμό στο RG Pilates Studio με αυτή τη ` +
        `διεύθυνση email. Ελπίζουμε να είστε εσείς.\n\n` +
        `Ο κωδικός επιβεβαίωσης είναι ${a.code}\n\n` +
        `Πληκτρολογήστε τον στην ιστοσελίδα για να ολοκληρώσετε την εγγραφή. ` +
        `Ο κωδικός λήγει σε ${a.minutes} λεπτά και μπορείτε να ζητήσετε νέο ` +
        `όποτε θέλετε.\n\n` +
        `Αν δεν ήσασταν εσείς, αγνοήστε αυτό το email. Ο λογαριασμός δεν ` +
        `μπορεί να χρησιμοποιηθεί χωρίς τον κωδικό, οπότε δεν θα συμβεί τίποτε ` +
        `άλλο.`,
      url: "/verify",
    },
  };
}

/* ------------------------------------------- personal and duet appointments */

/**
 * The member's own confirmation for a midday appointment.
 *
 * Deliberately not the class confirmation with a different noun in it. Three
 * things are true here that are not true of a group class, and a member who has
 * just paid €30 or €45 should be told all three without having to go and look
 * them up:
 *
 *   who is coming        one person, or two, and the second person by name, so
 *                        a typo is caught now rather than at the door
 *   who is teaching      nobody yet. The studio rings round after this lands,
 *                        and promising a name we have not asked for would be a
 *                        promise the site is not in a position to make
 *   when it locks        end of the day before, which is the same line as
 *                        booking and is worth saying once plainly, because it
 *                        is stricter than the twelve hours they are used to
 *
 * Written to be read by somebody standing up. Short lines, no headings, and the
 * one sentence that could cost them money is the last one, where it is read.
 */
export function personalBookedWords(a: {
  startsAt: Date;
  guestName: string | null;
}): Bilingual {
  const two = Boolean(a.guestName);

  return {
    en: {
      subject: two ? "Your Duet is booked" : "Your session is booked",
      body:
        (two
          ? `You and ${a.guestName} have the studio on ${whenWords(a.startsAt)}.`
          : `The studio is yours on ${whenWords(a.startsAt)}.`) +
        `\n\nAn instructor will be there for the hour.\n\n` +
        `If something changes you can cancel free until the end of the day ` +
        `before. After that an instructor has already been put on the rota for ` +
        `you, so the session counts as used.`,
      url: "/account",
    },
    el: {
      subject: two ? "Η συνεδρία Δυάδας σας κλείστηκε" : "Η συνεδρία σας κλείστηκε",
      body:
        (two
          ? `Εσείς και ${a.guestName} έχετε το στούντιο ${whenWords(a.startsAt, "el")}.`
          : `Το στούντιο είναι δικό σας ${whenWords(a.startsAt, "el")}.`) +
        `\n\nΘα υπάρχει εκπαιδευτής εκεί για όλη την ώρα.\n\n` +
        `Αν κάτι αλλάξει, μπορείτε να ακυρώσετε χωρίς χρέωση μέχρι το τέλος ` +
        `της προηγούμενης μέρας. Μετά από αυτό ο εκπαιδευτής έχει ήδη μπει στο ` +
        `πρόγραμμα για εσάς, οπότε η συνεδρία μετράει ως χρησιμοποιημένη.`,
      url: "/account",
    },
  };
}

/**
 * The message that actually gets somebody to work: the studio's own copy.
 *
 * This one is not a courtesy. An appointment is an hour nobody was rostered for,
 * and between the booking landing and the member arriving somebody has to read
 * this and ring an instructor. So it is written as a note to a colleague rather
 * than as a notification: the hour first, the names and the number next, and one
 * line saying what needs doing.
 *
 * The member's phone number is in it on purpose. The person calling round the
 * instructors is often the same person who then has to call the member back
 * about the time, and making them open the admin panel to find a number they
 * were just emailed about is the kind of small friction that ends with the call
 * not being made.
 */
/**
 * The studio's own copy of a payment, to the operations mailbox.
 *
 * The member already gets told; this is for the other side of the counter. The
 * owner asked for it in plain terms: they want to know money has arrived, from
 * whom, and through which till — because those three facts are what reconciling
 * a day's takings needs, and until now two of the three tills were silent.
 * A card payment on the website appeared nowhere except the Stripe dashboard,
 * and cash at the desk appeared nowhere except the drawer.
 *
 * Everything a person would want in order to act on it, and nothing they would
 * have to look up: who paid, how to reach them, what they bought, what it cost,
 * which till took it, who was serving, and what the member's balance is now.
 * The last one matters more than it looks — it is the number the member will
 * quote back if they think something has gone wrong.
 *
 * Bilingual like the rest of the studio's mail. This lands in a shared mailbox
 * read by more than one person and nobody was asked which language they prefer.
 */
export function studioPaidWords(a: {
  memberName: string;
  memberEmail: string;
  memberPhone: string | null;
  /** "Cash", "Card at the desk", "Card online" — the till, in words. */
  methodEn: string;
  methodEl: string;
  credits: number;
  amountCents: number;
  currency: string;
  /** The member's balance after this sale. */
  balance: number;
  /** Who was serving, for a sale taken at the desk. */
  staffName?: string | null;
  /** The studio's invoice number, when one was issued. */
  invoiceNo?: string | null;
  /** The provider's reference, for tracing one payment to one charge. */
  reference?: string | null;
}): Bilingual {
  const contact = [a.memberEmail, a.memberPhone].filter(Boolean).join(", ");
  const paid = moneyWords(a.amountCents, a.currency);
  const paidEl = moneyWords(a.amountCents, a.currency, "el");

  /* Built as lines rather than a paragraph. This is a record somebody scans for
     one figure, not prose they read. */
  const linesEn = [
    `${a.memberName} — ${contact}`,
    `${sessionWords(a.credits)} for ${paid}`,
    `Taken by: ${a.methodEn}${a.staffName ? `, served by ${a.staffName}` : ""}`,
    `Balance now: ${sessionWords(a.balance)}`,
    a.invoiceNo ? `Invoice: ${a.invoiceNo}` : "",
    a.reference ? `Reference: ${a.reference}` : "",
  ].filter(Boolean);

  const linesEl = [
    `${a.memberName} — ${contact}`,
    `${sessionWords(a.credits, "el")} για ${paidEl}`,
    `Τρόπος: ${a.methodEl}${a.staffName ? `, από ${a.staffName}` : ""}`,
    `Υπόλοιπο τώρα: ${sessionWords(a.balance, "el")}`,
    a.invoiceNo ? `Τιμολόγιο: ${a.invoiceNo}` : "",
    a.reference ? `Αναφορά: ${a.reference}` : "",
  ].filter(Boolean);

  return {
    en: {
      /* The amount and the name in the subject, so the mailbox is readable
         without opening anything — which is how somebody checks a day's
         takings from a phone. */
      subject: `Payment received: ${paid} from ${a.memberName}`,
      body: linesEn.join("\n"),
    },
    el: {
      subject: `Πληρωμή: ${paidEl} από ${a.memberName}`,
      body: linesEl.join("\n"),
    },
  };
}

export function studioAppointmentWords(a: {
  startsAt: Date;
  memberName: string;
  memberEmail: string;
  memberPhone: string | null;
  guestName: string | null;
  /** True when the booking has just been cancelled rather than made. */
  cancelled?: boolean;
}): Bilingual {
  const two = Boolean(a.guestName);
  const who = two ? `${a.memberName} and ${a.guestName}` : a.memberName;
  const whoEl = two ? `${a.memberName} και ${a.guestName}` : a.memberName;
  const kindEn = two ? "Duet, two people" : "Personal, one person";
  const kindEl = two ? "Δυάδα, δύο άτομα" : "Ατομική, ένα άτομο";
  const contact = [a.memberEmail, a.memberPhone].filter(Boolean).join(", ");

  if (a.cancelled) {
    return {
      en: {
        subject: `Cancelled: ${whenWords(a.startsAt)}`,
        body:
          `${who} has cancelled the ${whenWords(a.startsAt)} session.\n\n` +
          `${kindEn}. ${contact}\n\n` +
          `The hour is free again. If an instructor was already asked to come ` +
          `in for it, they need to be told.`,
      },
      el: {
        subject: `Ακύρωση: ${whenWords(a.startsAt, "el")}`,
        body:
          `${whoEl} ακύρωσε τη συνεδρία ${whenWords(a.startsAt, "el")}.\n\n` +
          `${kindEl}. ${contact}\n\n` +
          `Η ώρα είναι ξανά ελεύθερη. Αν έχει ήδη ζητηθεί από εκπαιδευτή να ` +
          `έρθει, πρέπει να ενημερωθεί.`,
      },
    };
  }

  return {
    en: {
      subject: `New session: ${whenWords(a.startsAt)}`,
      body:
        `${who} has booked the studio for ${whenWords(a.startsAt)}.\n\n` +
        `${kindEn}. ${contact}\n\n` +
        `An instructor needs to be there for that hour. It falls in the midday ` +
        `gap, so nobody is on the rota for it yet.`,
    },
    el: {
      subject: `Νέα συνεδρία: ${whenWords(a.startsAt, "el")}`,
      body:
        `${whoEl} έκλεισε το στούντιο για ${whenWords(a.startsAt, "el")}.\n\n` +
        `${kindEl}. ${contact}\n\n` +
        `Χρειάζεται εκπαιδευτής για αυτή την ώρα. Πέφτει στο μεσημεριανό κενό, ` +
        `οπότε δεν είναι ακόμη κανείς στο πρόγραμμα.`,
    },
  };
}

/**
 * The studio's own note that somebody has just joined.
 *
 * Emailed to the operations mailbox the moment a member proves their email, so
 * the desk sees new sign-ups as they happen rather than only when the person
 * first turns up for a class. A record to scan, so it is a line and a contact,
 * not a paragraph.
 */
export function studioNewMemberWords(a: {
  memberName: string;
  memberEmail: string;
  memberPhone: string | null;
}): Bilingual {
  const contact = [a.memberEmail, a.memberPhone].filter(Boolean).join(", ");
  return {
    en: {
      subject: `New member: ${a.memberName}`,
      body:
        `${a.memberName} has just created an account and confirmed their email.\n` +
        `${contact}`,
    },
    el: {
      subject: `Νέο μέλος: ${a.memberName}`,
      body:
        `${a.memberName} μόλις δημιούργησε λογαριασμό και επιβεβαίωσε το email του.\n` +
        `${contact}`,
    },
  };
}

/**
 * An enquiry from the public contact form, handed to the studio's mailbox.
 *
 * Everything the desk needs to answer it is in the body, the sender's own
 * address foremost, so a reply is a reply-to on the mail client with nothing to
 * look up. Bilingual like the rest of the studio's own copies, because the two
 * people who read this inbox do not necessarily read the same language.
 */
export function contactStudioWords(a: {
  name: string;
  email: string;
  phone: string | null;
  message: string;
}): Bilingual {
  const reach = [a.email, a.phone].filter(Boolean).join(" · ");
  return {
    en: {
      subject: `New enquiry from ${a.name}`,
      body:
        `${a.name} sent a message through the website.\n` +
        `${reach}\n\n` +
        `${a.message}`,
    },
    el: {
      subject: `Νέο μήνυμα από ${a.name}`,
      body:
        `${a.name} έστειλε μήνυμα μέσα από την ιστοσελίδα.\n` +
        `${reach}\n\n` +
        `${a.message}`,
    },
  };
}

/**
 * The visitor's own copy: yes, it arrived, and here is when to expect an answer.
 *
 * Sent to whoever filled the form in, whether or not they are a member, so it
 * cannot lean on anything an account would carry. Bilingual, because the form
 * does not ask which language they read and a Cyprus studio should answer in
 * both. The 24 to 48 hours is the studio's own promise, said plainly so nobody
 * is left wondering whether the form worked at all.
 */
export function contactAckWords(a: { name: string }): Bilingual {
  return {
    en: {
      subject: "We have your message",
      body:
        `Thank you for reaching out to RG Pilates Studio, ${a.name}.\n\n` +
        `We have received your message. The studio will review it and reply ` +
        `as soon as possible, usually within 24 to 48 hours.`,
    },
    el: {
      subject: "Λάβαμε το μήνυμά σας",
      body:
        `Ευχαριστούμε που επικοινωνήσατε με το RG Pilates Studio, ${a.name}.\n\n` +
        `Λάβαμε το μήνυμά σας. Το στούντιο θα το εξετάσει και θα σας απαντήσει ` +
        `το συντομότερο δυνατό, συνήθως εντός 24 έως 48 ωρών.`,
    },
  };
}

/**
 * The member's confirmation that a cancelled appointment is cancelled.
 *
 * Says whether the session came back, like the class version, and nothing else.
 * Somebody cancelling is not in the mood to read about how the hour is built.
 */
export function personalCancelledWords(a: {
  startsAt: Date;
  refunded: boolean;
}): Bilingual {
  return {
    en: {
      subject: "Session cancelled",
      body:
        `Your session on ${whenWords(a.startsAt)} is cancelled. ` +
        (a.refunded
          ? "The session is back in your balance."
          : "This was past the end of the day before, so the session was used."),
      url: "/account?tab=notifications",
    },
    el: {
      subject: "Η συνεδρία ακυρώθηκε",
      body:
        `Η συνεδρία σας ${whenWords(a.startsAt, "el")} ακυρώθηκε. ` +
        (a.refunded
          ? "Η συνεδρία επέστρεψε στο υπόλοιπό σας."
          : "Η ακύρωση έγινε μετά το τέλος της προηγούμενης μέρας, γι' αυτό η συνεδρία χρησιμοποιήθηκε."),
      url: "/account?tab=notifications",
    },
  };
}

/**
 * "Somebody else is taking your class."
 *
 * Short, and it does not apologise. An instructor changing is ordinary: people
 * are ill, people swap shifts, and a studio that treats it as an incident
 * teaches its members to treat it as one too. What the member needs is the fact
 * and the reassurance that nothing else has moved, which is the second sentence.
 *
 * The outgoing name is included as well as the incoming one, because that is the
 * whole content of the message: a member who booked with Elena specifically is
 * the only person this notice is really for, and telling them "your instructor is
 * Andreas" without saying who it was leaves them to work out whether anything
 * changed at all.
 */
export function instructorChangedWords(a: {
  classEn: string;
  classEl: string;
  startsAt: Date;
  from: string;
  to: string;
}): Bilingual {
  return {
    en: {
      subject: "A change of instructor",
      body:
        `${a.to} is taking your ${a.classEn} on ${whenWords(a.startsAt)}, ` +
        `instead of ${a.from}.\n\n` +
        `Nothing else has changed. Same time, same room, and your booking is ` +
        `exactly as it was.`,
      url: "/account",
    },
    el: {
      subject: "Αλλαγή εκπαιδευτή",
      body:
        `Το μάθημά σας ${a.classEl} ${whenWords(a.startsAt, "el")} θα το κάνει ` +
        `${a.to} αντί για ${a.from}.\n\n` +
        `Δεν αλλάζει κάτι άλλο. Ίδια ώρα, ίδια αίθουσα, και η κράτησή σας ` +
        `μένει όπως ήταν.`,
      url: "/account",
    },
  };
}

/* ------------------------------------------------------------- for the inbox */

/**
 * The sign-off, which belongs to email and to nothing else.
 *
 * A push notification is one line on a lock screen and "Best regards" in it
 * would be absurd; the in-app copy is a card in a list the member is already
 * looking at, with the studio's name above it. Only a letter needs signing.
 */
export const SIGN_OFF = {
  en: "Best regards,\nRG Pilates Studio Team",
  el: "Με εκτίμηση,\nΗ ομάδα του RG Pilates Studio",
};

/** The rule between the two languages. Rendered as a line, not as characters. */
export const LANGUAGE_RULE = "———";

/**
 * Does this text already end with somebody's sign-off?
 *
 * Because the desk types one. A notice written by hand quite reasonably finishes
 * "Best regards, RG Pilates Studio Team", and adding ours underneath produced an
 * email signed twice by almost the same name — which reads like a mail merge
 * went wrong. Checked against the last few lines only, so a message that merely
 * mentions the phrase in passing still gets signed.
 */
function alreadySigned(body: string) {
  /* The last few lines that have anything on them. A sign-off is at the end by
     definition, so the middle of a message is none of our business. */
  const lines = body
    .trimEnd()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3);

  const OPENERS = [
    "best regards",
    "kind regards",
    "warm regards",
    "regards",
    "sincerely",
    "thank you",
    "thanks",
    "με εκτίμηση",
    "φιλικά",
    "ευχαριστούμε",
  ];

  return lines.some((line) => {
    const lower = line.toLowerCase();
    /* It has to *begin* a line, and the line has to be short. That second
       condition is the one that matters: "Best regards are what we send in
       every email we write" begins with the phrase and is plainly a sentence,
       not a signature. A real sign-off is two or three words and a comma. */
    return (
      line.length <= 40 && OPENERS.some((phrase) => lower.startsWith(phrase))
    );
  });
}

function sign(body: string, off: string) {
  return alreadySigned(body) ? body : `${body}\n\n${off}`;
}

/**
 * One email carrying both languages.
 *
 * English first because the interface defaults to it, then a rule, then the
 * Greek. Each half is signed — unless the writer signed it themselves.
 *
 * The **subject stays in one language**, deliberately. Joining both with a
 * separator was the first attempt and it was wrong: an inbox shows perhaps fifty
 * characters of a subject line, so "Hello Testing - Important · Γεια σας Τεστ -
 * SHMANTIKO" is a line of noise in the list and a mess in the notification on a
 * phone. A subject's job is to be recognised at a glance, and two languages
 * competing for the same forty characters means neither is. Both languages are
 * in the body, where there is room for them.
 */
export function forEmail(m: Bilingual | Outgoing, el?: Outgoing): Outgoing {
  const en = "en" in m && "el" in m ? (m as Bilingual).en : (m as Outgoing);
  const greek = "en" in m && "el" in m ? (m as Bilingual).el : el;

  if (!greek || (greek.subject === en.subject && greek.body === en.body)) {
    return { ...en, body: sign(en.body, SIGN_OFF.en) };
  }

  return {
    subject: en.subject,
    body: [
      sign(en.body, SIGN_OFF.en),
      LANGUAGE_RULE,
      sign(greek.body, SIGN_OFF.el),
    ].join("\n\n"),
    url: en.url,
    /**
     * Carried through, and it was not at first.
     *
     * This function builds a *new* message out of two, and the first version
     * listed the fields it wanted — which silently dropped the invoice PDF that
     * `notifyPurchased` had just spent a database read and a render producing.
     * Nothing failed: the email arrived, said "your VAT invoice is attached",
     * and had nothing attached to it. The single-language branch above spreads
     * `en` and so never had the bug, which is exactly why it went unnoticed in
     * the one place it mattered.
     */
    attachments: en.attachments,
  };
}

/* -------------------------------------------------------------- monthly plans */

function euros(cents: number) {
  return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

type PlanFacts = {
  months: number;
  perWeek: number;
  monthlyPriceCents: number;
  paidThrough: Date | null;
  dueBy: Date | null;
  monthsPaid: number;
  creditsRemaining: number;
};

function planName(p: PlanFacts, lang: "en" | "el") {
  return lang === "el"
    ? `${p.months} μήνες, ${p.perWeek} ${p.perWeek === 1 ? "φορά" : "φορές"} την εβδομάδα`
    : `${p.months} months, ${p.perWeek} ${p.perWeek === 1 ? "class" : "classes"} a week`;
}

/** A month of the plan has been paid, from whichever till. */
export function planPaidWords(p: PlanFacts, first: boolean): Bilingual {
  const next = p.paidThrough ? dateWords(p.paidThrough) : "";
  const nextEl = p.paidThrough ? dateWords(p.paidThrough, "el") : "";
  return {
    en: {
      subject: first ? "Your monthly plan has started" : "Thank you, this month is paid",
      body: first
        ? `Your plan (${planName(p, "en")}) is active and all ${p.creditsRemaining} sessions are on your account. Book your regular hours for the whole term from the timetable. The next month of ${euros(p.monthlyPriceCents)} is due on ${next}.`
        : `Month ${p.monthsPaid} of ${p.months} on your plan (${planName(p, "en")}) is paid. Your sessions are open to book. The next month is due on ${next}.`,
      url: "/account",
    },
    el: {
      subject: first ? "Το μηνιαίο πλάνο σου ξεκίνησε" : "Ευχαριστούμε, ο μήνας εξοφλήθηκε",
      body: first
        ? `Το πλάνο σου (${planName(p, "el")}) είναι ενεργό και όλες οι ${p.creditsRemaining} συνεδρίες είναι στον λογαριασμό σου. Κλείσε τις σταθερές ώρες σου για όλη την περίοδο από το πρόγραμμα. Ο επόμενος μήνας, ${euros(p.monthlyPriceCents)}, πληρώνεται έως ${nextEl}.`
        : `Ο μήνας ${p.monthsPaid} από ${p.months} του πλάνου σου (${planName(p, "el")}) εξοφλήθηκε. Οι συνεδρίες σου είναι ανοιχτές για κράτηση. Ο επόμενος μήνας πληρώνεται έως ${nextEl}.`,
      url: "/account",
    },
  };
}

/** Three days before a month falls due, and again on the day. */
export function planDueWords(p: PlanFacts, kind: "SOON" | "DUE"): Bilingual {
  const due = p.paidThrough ? dateWords(p.paidThrough) : "";
  const dueEl = p.paidThrough ? dateWords(p.paidThrough, "el") : "";
  const by = p.dueBy ? dateWords(p.dueBy) : "";
  const byEl = p.dueBy ? dateWords(p.dueBy, "el") : "";
  const price = euros(p.monthlyPriceCents);
  return {
    en: {
      subject:
        kind === "SOON"
          ? `Your next plan payment is due on ${due}`
          : `Your plan payment of ${price} is due today`,
      body:
        `${kind === "SOON" ? `The next month of your plan (${planName(p, "en")}) falls due on ${due}.` : `Month ${p.monthsPaid + 1} of your plan (${planName(p, "en")}) is due today.`} ` +
        `Pay ${price} online from your account, or at the studio, by ${by}. After that your upcoming bookings are released and your sessions pause until the month is paid.`,
      url: "/account",
    },
    el: {
      subject:
        kind === "SOON"
          ? `Η επόμενη πληρωμή του πλάνου σου είναι στις ${dueEl}`
          : `Η πληρωμή ${price} του πλάνου σου είναι σήμερα`,
      body:
        `${kind === "SOON" ? `Ο επόμενος μήνας του πλάνου σου (${planName(p, "el")}) πληρώνεται στις ${dueEl}.` : `Ο μήνας ${p.monthsPaid + 1} του πλάνου σου (${planName(p, "el")}) πληρώνεται σήμερα.`} ` +
        `Πλήρωσε ${price} online από τον λογαριασμό σου ή στο στούντιο έως ${byEl}. Μετά, οι επερχόμενες κρατήσεις σου απελευθερώνονται και οι συνεδρίες σου παγώνουν μέχρι να εξοφληθεί ο μήνας.`,
      url: "/account",
    },
  };
}

/** The grace period passed: the plan is paused. */
export function planLapsedWords(p: PlanFacts, released: number): Bilingual {
  const price = euros(p.monthlyPriceCents);
  return {
    en: {
      subject: "Your plan is paused until this month is paid",
      body:
        `The month of ${price} on your plan (${planName(p, "en")}) was not paid in time, so your ${p.creditsRemaining} remaining sessions are paused` +
        (released ? ` and ${released} upcoming ${released === 1 ? "booking has" : "bookings have"} been released.` : ".") +
        ` Pay the month online from your account or at the studio and everything opens again at once.`,
      url: "/account",
    },
    el: {
      subject: "Το πλάνο σου είναι σε παύση μέχρι να εξοφληθεί ο μήνας",
      body:
        `Ο μήνας ${price} του πλάνου σου (${planName(p, "el")}) δεν πληρώθηκε εγκαίρως, οπότε οι ${p.creditsRemaining} συνεδρίες που απομένουν είναι σε παύση` +
        (released ? ` και ${released} ${released === 1 ? "επερχόμενη κράτηση απελευθερώθηκε" : "επερχόμενες κρατήσεις απελευθερώθηκαν"}.` : ".") +
        ` Πλήρωσε τον μήνα online από τον λογαριασμό σου ή στο στούντιο και όλα ανοίγουν ξανά αμέσως.`,
      url: "/account",
    },
  };
}
