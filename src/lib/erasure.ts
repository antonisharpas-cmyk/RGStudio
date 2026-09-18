import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  classSessions,
  contactMessages,
  emailVerifications,
  purchases,
  pushSubscriptions,
  userAvatars,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";

/**
 * The right to be forgotten, done without forgetting the accounts.
 *
 * A member can require the studio to erase their personal data, and in the EU
 * that is not a favour — it is Article 17, and the studio has a month to do it.
 * The obvious implementation is `delete from users where id = ?`, and it is
 * wrong twice over.
 *
 * It is wrong legally. Every payment that member ever made is an accounting
 * record, and the studio keeps those for seven years and then archives them for
 * a further seven, fourteen in all; the obligation to keep them is itself a
 * lawful basis that survives the erasure request. Deleting the person is
 * required, deleting the invoice is not permitted.
 *
 * And it is wrong practically. Nine tables cascade off `users` — bookings,
 * purchases, credit batches, the credit ledger, reminders, notice reads, push
 * subscriptions, the avatar. A delete takes all of it, and because the owner's
 * revenue figures are a `sum(purchases.amount_cents)`, one erasure would quietly
 * rewrite last March's takings. A studio cannot have a button that changes its
 * own history.
 *
 * So the row stays and the person leaves it. Name, email, phone, date of birth,
 * height, weight and the instructor's notes are overwritten; the photograph and
 * every registered device are deleted; the password is replaced with something
 * nobody holds. What remains is an account with no human attached to it, still
 * carrying its payments and its attendance — which is exactly the shape the law
 * asks for.
 *
 * ---
 *
 * **What this deliberately does not do.**
 *
 * It does not cancel their upcoming classes. Somebody may want their data gone
 * and their Thursday class kept, and guessing wrong in either direction is worse
 * than telling the desk how many bookings are standing and letting a person
 * decide. The count comes back in the result for exactly that reason.
 *
 * It does not touch `serviceOptInAt`. That column is the record that consent was
 * given, on a date — evidence the studio may need precisely *because* somebody
 * is now disputing their relationship with it. A date on an anonymous row
 * identifies nobody.
 *
 * It does not run for reception, and it does not run for the studio's own
 * accounts. See the two refusals below.
 */

export type ErasureRefusal =
  | "NOT_FOUND"
  /** Erasing a colleague's account would break the console it belongs to. */
  | "DESK_ACCOUNT"
  /** Already done. Idempotent by refusal rather than by silently repeating. */
  | "ALREADY_ERASED"
  /** The typed email did not match the member's. */
  | "CONFIRM_MISMATCH";

export type ErasureResult =
  | {
      ok: true;
      /** The placeholder address the row now carries, for the desk's record. */
      handle: string;
      /** Payments left untouched — the reason this is not a delete. */
      paymentsKept: number;
      /** Classes still on the books, which nobody has cancelled. */
      upcomingBookings: number;
      /** Devices unregistered and photographs removed. */
      devicesRemoved: number;
      /** Contact-form messages deleted, matched on the old address. */
      messagesRemoved: number;
    }
  | { ok: false; code: ErasureRefusal };

/** A per-erasure address that can never receive mail. `.invalid` is reserved. */
function freshHandle() {
  for (let i = 0; i < 10; i++) {
    const handle = `erased-${randomUUID().slice(0, 8)}@rg.invalid`;
    const clash = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, handle))
      .get();
    if (!clash) return handle;
  }
  return `erased-${randomUUID()}@rg.invalid`;
}

function upcomingCount(userId: string) {
  return db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(classSessions, eq(bookings.sessionId, classSessions.id))
    .where(
      and(
        eq(bookings.userId, userId),
        eq(bookings.status, "CONFIRMED"),
        gt(classSessions.startsAt, new Date()),
      ),
    )
    .all().length;
}

/**
 * Erase the person, keep the account.
 *
 * `confirmEmail` is the safety catch, and it is a typed one rather than a
 * dialog. This is the only irreversible action in the console — there is no undo
 * and no backup of a name that has been overwritten — and "are you sure?" is a
 * button people press without reading. Typing the member's own address means
 * looking at which member is selected.
 */
export async function erasePersonalData(
  userId: string,
  confirmEmail: string,
  by: { id: string; name: string },
): Promise<ErasureResult> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false, code: "NOT_FOUND" };

  /* A colleague's account is not a member's. Beyond the obvious — nobody should
     be able to erase the owner out of the console — three tables record who
     created a closure, a notice and a pricing rule, and those references point
     at staff. */
  if (user.role === "STAFF" || user.role === "ADMIN") {
    return { ok: false, code: "DESK_ACCOUNT" };
  }
  if (user.erasedAt) return { ok: false, code: "ALREADY_ERASED" };

  if (
    confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()
  ) {
    return { ok: false, code: "CONFIRM_MISMATCH" };
  }

  const paymentsKept = db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.userId, userId))
    .all().length;
  const upcomingBookings = upcomingCount(userId);

  const devices = db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .run().changes;
  db.delete(userAvatars).where(eq(userAvatars.userId, userId)).run();
  /* Any half-finished verification goes with them: it is a live credential for
     an address that is no longer on the account. */
  db.delete(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .run();

  /**
   * And anything they wrote through the contact form.
   *
   * This was missed, and it was missed for a structural reason: the contact
   * form takes messages from people who have no account, so `contact_messages`
   * has no `user_id` to cascade from. Nine tables hang off `users` and this one
   * does not, so a function written by following the foreign keys walked
   * straight past it.
   *
   * What it left behind was the worst possible residue. A member who asked to
   * be forgotten had their name, email, telephone number and whatever they had
   * typed still sitting in a table with no expiry and nothing to clean it up —
   * while every screen said the erasure had completed. Matched on the address
   * because that is the only thing the two records share, and against the
   * address as it was *before* it is overwritten, which is why this runs here
   * and not after the update below.
   *
   * Messages from people who never registered are untouched. Those are not this
   * function's business, and they are covered by the studio's own retention
   * instead.
   */
  const messagesRemoved = db
    .delete(contactMessages)
    .where(sql`lower(${contactMessages.email}) = ${user.email.toLowerCase()}`)
    .run().changes;

  const handle = freshHandle();

  db.update(users)
    .set({
      /* Not "Anonymous": the desk reads this in a list of members and on a class
         roster, and it needs to say what happened rather than look like somebody
         who forgot to type their name. */
      name: "Erased member",
      email: handle,
      phone: null,
      birthDate: null,
      heightCm: null,
      weightGrams: null,
      notes: null,
      /**
       * The three answers from the welcome step, and the condition above all.
       *
       * "Six weeks post-partum" or "recovering from a disc injury" is health
       * data about a named person, and it is the single most sensitive thing
       * this database holds. An erasure that left it behind would be the one
       * field that mattered. The level and the experience go with it: on their
       * own they are harmless, and attached to a row that is being erased they
       * are still somebody's information.
       */
      healthCondition: null,
      pilatesLevel: null,
      pilatesSince: null,
      /* A password nobody has, rather than an empty string that some future
         comparison might treat as a match. Hashed properly so every code path
         that reads this column keeps reading the same shape of value. */
      passwordHash: await hashPassword(randomUUID()),
      marketingOptIn: false,
      notifyEmail: false,
      notifySms: false,
      /* notifyPush is left alone on purpose. It is no longer a preference — the
         schema repair in db/migrate.ts forces every row back to 1 on boot — so
         setting it here would be undone within a restart and would read as a bug
         to whoever found it. The devices are deleted above, which is what
         actually stops a push. */
      reminderMinutes: null,
      erasedAt: new Date(),
      erasedBy: by.name,
    })
    .where(eq(users.id, userId))
    .run();

  return {
    ok: true,
    handle,
    paymentsKept,
    upcomingBookings,
    devicesRemoved: devices,
    /* Reported, because it is the one part of an erasure that touches something
       the member may not remember writing. */
    messagesRemoved,
  };
}
