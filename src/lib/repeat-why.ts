/**
 * Turning a partial term booking into sentences somebody can act on.
 *
 * A run of eight weeks very often takes fewer than eight, and for perfectly good
 * reasons: the pack expires in week five, the room is full in week three, they
 * had already booked week two. The bookings that succeed are real and the ones
 * that do not are facts, so the only wrong answer is a vague one.
 *
 * ---
 *
 * **Why this exists as its own file.**
 *
 * The first version printed the dates and stopped there — "booked 4 of 8, could
 * not book 5, 12, 19 and 26 Oct" — and the gap showed up the moment somebody
 * tried the obvious thing. A member holding a thirty-day pack asks for eight
 * weeks, gets four, and reads that message while looking at eight unspent
 * sessions in their balance. There is no way to interpret that except as a fault
 * in the website. The reason *is* the message.
 *
 * Both screens need it — the member's own timetable and the desk, where
 * reception has to explain the refusal down a telephone — and the grouping is
 * fiddly enough that two copies would drift. The wording is passed in rather
 * than looked up here, because the two screens say it differently on purpose:
 * one says "your sessions", the other says "theirs", and the desk one ends with
 * what to offer next.
 */

/** One week that could not be taken, as the API reports it. */
export type RepeatFailure = {
  startsAt: string;
  code?: string;
  /** The last date their sessions reach. Only on an expiry refusal. */
  until?: string;
};

/**
 * The sentences, one per reason, in the order somebody should hear them.
 *
 * Grouped by reason rather than listed by date, because four dates with one
 * cause is one sentence and four sentences is a wall. Ordered with the two
 * reasons that have something to *do* about them first: a member who can fix
 * this by buying a pack should read that before they read that the room was
 * full.
 */
export type RepeatWhyWords = {
  /** Needs {dates} and {until}. */
  expire: string;
  /** Needs {dates}. */
  noCredits: string;
  full: string;
  closed: string;
  other: string;
};

type Bucket = keyof RepeatWhyWords;

/**
 * Which refusal belongs in which sentence.
 *
 * `CREDITS_NOT_VALID_HERE` sits with the balance problems rather than on its own:
 * it means the sessions they hold cannot pay for a class on that date — the
 * opening-week gift, valid only in its week — and "nothing in your balance can
 * pay for these dates" is true of that as much as of an empty balance. The two
 * refusals that cannot reach this function at all are the appointment ones, since
 * a run is group classes only.
 */
const BUCKETS: Record<string, Bucket> = {
  SESSIONS_EXPIRE_FIRST: "expire",
  NO_CREDITS: "noCredits",
  CREDITS_NOT_VALID_HERE: "noCredits",
  CLASS_FULL: "full",
  TOO_LATE: "closed",
  PERSONAL_TOO_LATE: "closed",
  SESSION_CANCELLED: "other",
};

/** The order the sentences come out in. Actionable first. */
const ORDER: Bucket[] = ["expire", "noCredits", "full", "closed", "other"];

export function repeatWhy(
  failed: RepeatFailure[],
  words: RepeatWhyWords,
  fmt: {
    /** One date, as the reader's locale writes it. */
    date: (d: Date) => string;
    /** "5, 12 and 19 Oct" — the locale's own way of joining a list. */
    list: (parts: string[]) => string;
  },
): string[] {
  if (failed.length === 0) return [];

  const groups = new Map<Bucket, RepeatFailure[]>();
  for (const f of failed) {
    const bucket = BUCKETS[f.code ?? ""] ?? "other";
    const list = groups.get(bucket);
    if (list) list.push(f);
    else groups.set(bucket, [f]);
  }

  const out: string[] = [];
  for (const bucket of ORDER) {
    const rows = groups.get(bucket);
    if (!rows || rows.length === 0) continue;

    const dates = fmt.list(rows.map((r) => fmt.date(new Date(r.startsAt))));
    let sentence = words[bucket].replace("{dates}", dates);

    if (bucket === "expire") {
      /**
       * The date the pack reaches, which is the actionable half of this one.
       *
       * Taken from the earliest week refused, because that is the boundary: the
       * sessions reach that far and no further. If the API somehow did not send
       * it, the sentence falls back to the vague version rather than printing
       * the word "undefined" at a member — a slightly worse message beats a
       * broken one.
       */
      const until = rows.find((r) => r.until)?.until;
      if (!until) {
        out.push(words.other.replace("{dates}", dates));
        continue;
      }
      sentence = sentence.replace("{until}", fmt.date(new Date(until)));
    }

    out.push(sentence);
  }

  return out;
}
