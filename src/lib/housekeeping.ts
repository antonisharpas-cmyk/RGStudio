import { sqlite } from "@/db";

/**
 * Clearing out registrations that were never finished.
 *
 * An account whose address was never confirmed can do nothing at all: it cannot
 * book, cannot pay, cannot reach its own profile, and every page it asks for
 * sends it back to the code box. Left alone, those rows accumulate for ever, and
 * each one holds an email address and a phone number the studio has no
 * relationship with and no reason to keep. That is a small privacy debt that
 * grows on its own, and the tidiest answer is not to hold the data.
 *
 * So after a week they go. A week rather than a day because people do abandon a
 * signup, find the email on Thursday, and come back — and rather than a month
 * because by then the address is somebody who changed their mind, not somebody
 * mid-decision.
 *
 * ---
 *
 * **The row it will not touch, and why the check stays anyway.**
 *
 * An unconfirmed account cannot have payments or bookings. It cannot book, cannot
 * pay, and cannot be sold to at the desk either: `sellSessions` refuses to add
 * sessions to one, which is the studio's rule applied to the counter as well as
 * to the website.
 *
 * That was briefly not true. For one version the desk could take cash against an
 * account whose address was a typo, which left a paying customer the studio could
 * not send a receipt to and a row this sweep must never delete. The hole is
 * closed, so the check below should now find nothing.
 *
 * It stays regardless, and it is not paranoia: this function's whole job is
 * deleting rows, the thing it would delete by mistake is a record of money, and
 * six lines of arithmetic are a cheap standing guard against a future change that
 * reopens the door. Anything with a purchase, a session batch, a ledger line or a
 * booking is left exactly where it is and reported instead, and `npm run doctor`
 * names it as the anomaly it now is.
 */

/** How long a registration has to finish before it is cleared out. */
export const UNVERIFIED_LIFETIME_DAYS = 7;

export type Sweep = {
  /** Accounts removed. */
  deleted: number;
  /** Old and unverified, but holding history, so left alone and worth a look. */
  kept: string[];
};

/**
 * Run it. Safe to call as often as you like: it only ever acts on rows older
 * than the window, so a second call a minute later finds nothing.
 */
export function sweepUnverifiedAccounts(now = new Date()): Sweep {
  const cutoff = Math.floor(
    (now.getTime() - UNVERIFIED_LIFETIME_DAYS * 86_400_000) / 1000,
  );

  const candidates = sqlite
    .prepare(
      `select id, email,
              (select count(*) from purchases     p  where p.user_id  = u.id) as payments,
              (select count(*) from credit_batches b where b.user_id  = u.id) as batches,
              (select count(*) from credit_ledger  l where l.user_id  = u.id) as ledger,
              (select count(*) from bookings       k where k.user_id  = u.id) as bookings
         from users u
        where u.role = 'MEMBER'
          and u.email_verified_at is null
          and u.erased_at is null
          and u.created_at < ?`,
    )
    .all(cutoff) as {
    id: string;
    email: string;
    payments: number;
    batches: number;
    ledger: number;
    bookings: number;
  }[];

  const out: Sweep = { deleted: 0, kept: [] };
  const remove = sqlite.prepare("delete from users where id = ?");

  for (const row of candidates) {
    const hasHistory =
      row.payments > 0 || row.batches > 0 || row.ledger > 0 || row.bookings > 0;
    if (hasHistory) {
      out.kept.push(row.email);
      continue;
    }
    /* The cascades take the challenge row, the avatar, any devices and any
       per-member notices with it. Nothing here is referenced by anything the
       studio keeps — that is what the check above establishes. */
    out.deleted += remove.run(row.id).changes;
  }

  return out;
}

/**
 * Spent and abandoned confirmation codes.
 *
 * A code is deleted the moment it is typed correctly, so what collects here is
 * the other kind: challenges belonging to accounts that are still deciding, long
 * past their fifteen minutes. Harmless, and still worth clearing — an expired
 * credential kept indefinitely is a credential somebody could try.
 *
 * The account is left alone. Somebody who comes back a fortnight later presses
 * "send it again" and gets a fresh one; `resendCode` issues a new challenge when
 * it finds no row, precisely so this sweep cannot strand anybody.
 */
export function sweepDeadChallenges(now = new Date()): number {
  return sqlite
    .prepare("delete from email_verifications where expires_at < ?")
    .run(Math.floor((now.getTime() - 86_400_000) / 1000)).changes;
}
