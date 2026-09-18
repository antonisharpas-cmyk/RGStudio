import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { notVerified } from "@/lib/api-guard";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import {
  parseBirthDate,
  ageFromBirthDate,
  MAX_AGE_YEARS,
  MIN_AGE_YEARS,
} from "@/lib/profile";
import { rescheduleUpcoming } from "@/lib/reminders";
import { profileSchema } from "@/lib/validation";

/**
 * A member editing their own profile.
 *
 * Email and phone are not accepted here even if they are sent: they are the
 * studio's contact of record, and letting someone change the address a
 * password reset would go to is a different feature with different care around
 * it. Whatever arrives in those fields is ignored rather than rejected, so an
 * older client cannot fail confusingly.
 */
/**
 * Their own settings, read back.
 *
 * Exists so a client — and the test suite — can ask what a member's consents
 * actually are rather than inferring them from a rendered page. Only ever the
 * caller's own: there is no id parameter to get wrong.
 */
export async function GET() {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  return NextResponse.json({
    profile: {
      name: user.name,
      email: user.email,
      phone: user.phone,
      serviceOptIn: user.serviceOptInAt !== null,
      marketingOptIn: user.marketingOptIn,
      notifyEmail: user.notifyEmail,
      notifySms: user.notifySms,
      notifyPush: user.notifyPush,
      reminderMinutes: user.reminderMinutes,
    },
  });
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const stop = notVerified(user);
  if (stop) return stop;

  const parsed = profileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "INVALID" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  /* A date of birth has to be a real date, in the past, and old enough that
     the studio is not quietly taking bookings for a child. */
  let birthDate: string | null = null;
  if (d.birthDate) {
    const parsedDate = parseBirthDate(d.birthDate);
    if (!parsedDate || parsedDate.getTime() > Date.now()) {
      return NextResponse.json({ error: "BIRTHDATE_INVALID" }, { status: 400 });
    }
    const age = ageFromBirthDate(d.birthDate);
    if (age === null || age < MIN_AGE_YEARS || age > MAX_AGE_YEARS) {
      return NextResponse.json({ error: "BIRTHDATE_AGE" }, { status: 400 });
    }
    birthDate = d.birthDate;
  }

  const before = {
    marketingOptIn: user.marketingOptIn,
    reminderMinutes: user.reminderMinutes,
    notifyEmail: user.notifyEmail,
    notifySms: user.notifySms,
    notifyPush: user.notifyPush,
  };

  db.update(users)
    .set({
      name: d.name,
      /* Recorded once, the first time it is given. Never cleared here: an
         existing consent is a fact about the past. */
      serviceOptInAt:
        user.serviceOptInAt ?? (d.serviceOptIn ? new Date() : null),
      birthDate,
      /* Height and weight are no longer asked for: the studio decided they were
         not its business and never used them. The columns are left in place
         rather than dropped, so nobody's stored numbers are destroyed by a
         deploy, and erasure still clears them. Nothing writes them any more. */
      marketingOptIn: d.marketingOptIn,
      notifyEmail: d.notifyEmail,
      /* Accepting offers switches SMS on: it is the studio's most reliable way
         to reach somebody who has just said they want to hear from it. Only on
         the transition, so a member who accepts offers and then turns SMS off
         stays off — the choice is theirs once they have made it. */
      notifySms:
        d.marketingOptIn && !before.marketingOptIn ? true : d.notifySms,
      /* Push is not a preference any more: the studio keeps it on, and the only
         thing that silences it is the member's own browser or phone. Clamped
         here rather than trusted from the request, so an edited payload cannot
         switch it off behind the screen that no longer offers to. */
      notifyPush: true,
      reminderMinutes: d.reminderMinutes,
    })
    .where(eq(users.id, user.id))
    .run();

  /* Only touch the queue when the reminder actually changed, so saving a new
     weight does not quietly rewrite every reminder already promised. */
  const remindersChanged =
    before.reminderMinutes !== d.reminderMinutes ||
    before.notifyEmail !== d.notifyEmail ||
    before.notifySms !== d.notifySms;

  const rescheduled = remindersChanged ? rescheduleUpcoming(user.id) : 0;

  return NextResponse.json({ ok: true, remindersChanged, rescheduled });
}
