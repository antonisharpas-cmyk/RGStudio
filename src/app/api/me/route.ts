import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getAvailableCredits } from "@/lib/credits";
import { unreadCount } from "@/lib/notices";
import { LOCALE_COOKIE, LOCALES } from "@/i18n/dictionaries";

/**
 * The two numbers on the header, and nothing else.
 *
 * Exists so the header can keep itself honest without a page reload. Both of
 * those numbers are rendered on the server, which is right for the first paint
 * and wrong for the next twenty minutes: a member with the site open on their
 * phone had a stale badge until they reloaded, so a notice written while they
 * were looking at the timetable appeared to have not arrived at all. Sessions
 * sold at the desk had the same problem, and that one is worse — somebody pays
 * at the counter and their balance still says zero.
 *
 * Deliberately tiny. `/api/notices` would answer the same question, but it
 * carries every notice body and its paging with it, and this is polled: the
 * difference between two integers and a page of text matters when it is asked
 * for on a timer, on a phone, on a mobile connection.
 *
 * 200 with nulls rather than a 401 when nobody is signed in. The header polls
 * this and a signed-out browser asking a question it is allowed to ask should
 * not fill the console with authentication errors.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ signedIn: false, unread: null, credits: null });
  }

  /**
   * The one place a language already chosen gets written down.
   *
   * Members who were reading the site in Greek before the account learned to
   * remember that have the cookie and nothing on the row, so their next
   * notification would still be English — and they would have no reason to
   * press a switch that is already on the language they want. This copies the
   * cookie onto the account the first time the header asks after a page load,
   * which happens within seconds of signing in.
   *
   * Only ever fills a blank. A member who *has* chosen owns their choice, and a
   * stale cookie on a shared laptop must not be allowed to overwrite it — the
   * switch is the only thing that changes an answer, this is the only thing
   * that supplies a missing one.
   */
  if (!user.locale) {
    const chose = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (chose && (LOCALES as readonly string[]).includes(chose)) {
      db.update(users)
        .set({ locale: chose })
        .where(eq(users.id, user.id))
        .run();
    }
  }

  return NextResponse.json({
    signedIn: true,
    unread: unreadCount(user.id),
    credits: await getAvailableCredits(user.id),
  });
}
