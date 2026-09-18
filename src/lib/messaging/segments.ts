/**
 * What a text message will actually cost, before it is sent.
 *
 * An SMS is not billed by the message, it is billed by the *segment*, and how
 * many segments a piece of text becomes depends on which characters are in it.
 * That sounds like trivia until you see the numbers:
 *
 *   160 characters   plain Latin text, one segment
 *    70 characters   the moment a single Greek letter appears
 *
 * There is no middle ground and no partial penalty. One "ά" in an otherwise
 * English message re-encodes the *whole* message, including the English half, and
 * the limit collapses by more than half. So a 140-character announcement is one
 * segment in English, three in Greek, and five if the desk sends both languages
 * in one message — the English half billed at Greek prices.
 *
 * Which is why this file exists rather than a `Math.ceil(text.length / 160)`
 * somewhere. The desk needs the real number in front of it while it is typing,
 * because that is the only moment anybody can do anything about it.
 *
 * Nothing here talks to a network or a database. It is arithmetic, so both the
 * browser and the server can use the same answer — and they must, or the price
 * shown at the desk is not the price on the invoice.
 */

/**
 * The GSM 03.38 basic alphabet: the characters that fit seven bits.
 *
 * Note what is and is not in here. A handful of Greek *capitals* are present
 * (Δ Φ Γ Λ Ω Π Ψ Σ Θ Ξ) because they share glyphs with symbols the standard
 * wanted anyway. Every Greek lowercase letter, every accent, and the rest of the
 * capitals are absent. Real Greek prose therefore always falls out of this set,
 * which is the whole reason Greek costs what it costs.
 */
const GSM7 = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);

/**
 * The extension table: still seven-bit, but each of these costs *two* slots.
 *
 * Worth knowing because the euro sign is in here. "€25" looks like three
 * characters and is billed as four.
 */
const GSM7_EXT = new Set("\f^{}\\[~]|€");

export type SmsEncoding = "gsm7" | "unicode";

/** Which alphabet this text forces. One character out of range decides it. */
export function smsEncoding(text: string): SmsEncoding {
  for (const ch of text) {
    if (!GSM7.has(ch) && !GSM7_EXT.has(ch)) return "unicode";
  }
  return "gsm7";
}

/** How many slots one character takes in the given encoding. */
function weigh(ch: string, encoding: SmsEncoding): number {
  if (encoding === "gsm7") return GSM7_EXT.has(ch) ? 2 : 1;
  /* UCS-2 counts 16-bit units, so anything outside the basic plane — an emoji,
     mostly — is two. Read by code point, not by `.length`, so a surrogate pair
     is weighed once as two rather than twice as one. */
  return (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
}

export type SmsCost = {
  encoding: SmsEncoding;
  /** Billable slots, which is not the same as the character count. */
  units: number;
  /** What the invoice will say. */
  segments: number;
  /** How many slots are left before it becomes one segment longer. */
  headroom: number;
  /**
   * How many characters over a single message this is — the number somebody
   * needs in order to fix it.
   *
   * "Two messages each" is a true statement that nobody can act on. "Drop 22
   * characters and it is one" is the same fact expressed as the edit it implies,
   * and it is the difference between a warning that gets read and one that gets
   * ignored. Zero when the text already fits in one.
   */
  overBy: number;
};

/**
 * The real cost of a piece of text.
 *
 * Packed greedily rather than divided, because a character may not straddle a
 * segment boundary — an escaped character and a surrogate pair both have to
 * travel whole. Dividing would occasionally under-count by one, which is the
 * kind of error nobody notices until the bill.
 */
export function smsCost(text: string): SmsCost {
  const encoding = smsEncoding(text);
  const single = encoding === "gsm7" ? 160 : 70;
  const multi = encoding === "gsm7" ? 153 : 67;

  let units = 0;
  for (const ch of text) units += weigh(ch, encoding);

  if (units === 0) {
    return { encoding, units: 0, segments: 0, headroom: single, overBy: 0 };
  }
  if (units <= single) {
    return { encoding, units, segments: 1, headroom: single - units, overBy: 0 };
  }

  /* Over one segment: every segment now carries the concatenation header, the
     first one included, so the whole message is re-packed at the smaller size. */
  let segments = 1;
  let room = multi;
  for (const ch of text) {
    const w = weigh(ch, encoding);
    if (w > room) {
      segments++;
      room = multi;
    }
    room -= w;
  }
  return { encoding, units, segments, headroom: room, overBy: units - single };
}

/**
 * A whole send, priced.
 *
 * `perMessage` is what the provider charges for one segment. Left undefined the
 * money is simply not guessed at — a wrong price on the screen is worse than no
 * price, because somebody will budget from it.
 */
export function smsSendCost(
  text: string,
  recipients: number,
  perMessage?: number,
) {
  const one = smsCost(text);
  const segments = one.segments * Math.max(0, recipients);
  return {
    ...one,
    recipients,
    /* Total billable segments — the number that appears on the invoice. */
    total: segments,
    money: perMessage === undefined ? null : segments * perMessage,
  };
}

/**
 * The words that go out by SMS, from the notice the desk wrote.
 *
 * `both` exists because the studio asked for it, not because it is a good idea:
 * one Greek letter re-encodes the English half too, so both-in-one is five
 * segments where English alone is one. The desk gets the choice and gets the
 * number next to it.
 */
export function smsBodyFor(
  lang: "en" | "el" | "both",
  en: { subject: string; body: string },
  el?: { subject: string; body: string },
  override?: { en?: string; el?: string },
): string {
  const fromNotice = (w: { subject: string; body: string } | undefined) => {
    if (!w) return "";
    const subject = w.subject.trim();
    const body = w.body.trim();
    /* Joined only when there is something on both sides. Naively interpolating
       gave `"."` for an empty notice, which the desk saw as a preview of a text
       message containing a full stop. */
    if (!subject) return body;
    if (!body) return subject;
    return `${subject}. ${body}`;
  };

  /**
   * A hand-written version wins outright — and it wins whether or not the notice
   * itself has that language.
   *
   * That second half is the whole point. The Greek branch used to be written as
   * `el ? one(el, override.el) : ""`, which made the override reachable only when
   * the notice already had a Greek half. So typing Greek straight into the box
   * did nothing at all: the preview quietly showed the English instead, and the
   * text that went out would have been English too. The override has to be
   * consulted first, because it is the more specific instruction.
   */
  const pick = (
    w: { subject: string; body: string } | undefined,
    text: string | undefined,
  ) => (text ?? "").trim() || fromNotice(w);

  const english = pick(en, override?.en);
  const greek = pick(el, override?.el);

  if (lang === "el") return greek || english;
  if (lang === "both") return greek ? `${english}\n\n${greek}` : english;
  return english;
}

/**
 * The ceiling, so nobody sends a twelve-segment text to four hundred people.
 *
 * Four is deliberately generous — enough for a real Greek sentence, not enough
 * for somebody pasting the whole notice in by accident. It is a guard against a
 * mistake, not a style rule, so it is configurable and the error says the number.
 */
export const MAX_SEGMENTS = Math.max(
  1,
  Number(process.env.SMS_MAX_SEGMENTS ?? 4) || 4,
);
