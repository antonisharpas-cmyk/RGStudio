import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { LOCALES } from "@/i18n/dictionaries";

/**
 * Remember which language a member reads the site in, on the account.
 *
 * The switch at the top of every page has always set a cookie, and for the
 * pages that was enough — the cookie is on every request, so every page renders
 * in the right language. What it could not do is tell the studio anything, and
 * the studio sends messages when nobody is looking at a page: a reminder two
 * hours before a class is composed by a cron sweep with no browser attached to
 * it, and a member's cookie is on their phone, not on the server.
 *
 * So the result of pressing the switch is now recorded twice: the cookie, which
 * makes the current page Greek, and this, which makes the next notification
 * Greek. Two writes for one press, because they answer two different questions
 * in two different places.
 *
 * 200 either way. A signed-out visitor pressing the switch is doing something
 * entirely reasonable and the cookie is the whole answer for them; a 401 in
 * their console would be this route complaining about a case it is designed to
 * have. `saved` says which happened, for the test suite's benefit.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const wanted = (body as { locale?: unknown } | null)?.locale;
  if (typeof wanted !== "string" || !(LOCALES as readonly string[]).includes(wanted)) {
    return NextResponse.json({ error: "BAD_LOCALE" }, { status: 400 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ saved: false, locale: wanted });

  /* Cheap enough to write every time, but the switch is pressed twice by
     somebody comparing the two languages and this is a disk write on a small
     instance, so an unchanged value is left alone. */
  if (user.locale !== wanted) {
    db.update(users)
      .set({ locale: wanted })
      .where(eq(users.id, user.id))
      .run();
  }

  return NextResponse.json({ saved: true, locale: wanted });
}
