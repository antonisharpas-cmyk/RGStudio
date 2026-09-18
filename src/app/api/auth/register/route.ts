import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { sendVerificationCode } from "@/lib/messaging/events";
import { toE164 } from "@/lib/messaging/sms";
import { REMINDER_DEFAULT_MINUTES } from "@/lib/profile";
import { LOCALE_COOKIE, LOCALES } from "@/i18n/dictionaries";
import { registerSchema } from "@/lib/validation";
import { OTP_TTL_MINUTES, issueCode } from "@/lib/verify";
import { clientIp, hit, tooMany } from "@/lib/rate-limit";

export async function POST(req: Request) {
  /* One address may open a handful of accounts, not a hundred: registration
     writes a row and sends an email, so an unthrottled loop is both a spam
     vector and a bill. Twenty in an hour is far past any honest use. */
  const rl = hit("register", clientIp(req), 20, 60 * 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfter);
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid details" },
      { status: 400 },
    );
  }
  const { name, email, phone, password, marketingOptIn } = parsed.data;

  /**
   * Which language they filled this form in, taken from the cookie the switch
   * at the top of the page sets.
   *
   * Not asked as a question. Somebody who has read the whole sign-up form in
   * Greek has already answered it, and a fourth field on a form that is
   * deliberately short would be a worse way of finding out. Null when there is
   * no cookie, which is what an account that never touched the switch is.
   */
  const jar = await cookies();
  const chose = jar.get(LOCALE_COOKIE)?.value;
  const locale = chose && (LOCALES as readonly string[]).includes(chose) ? chose : null;

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
  }

  /**
   * And the phone, which matters as much as the email.
   *
   * A number is how the studio reaches somebody when a class moves, and two
   * accounts sharing one is two people the desk cannot tell apart on the phone —
   * plus, once SMS is connected, two texts to the same handset for two different
   * bookings.
   *
   * Compared in normalised form rather than as typed. "+357 99 123456",
   * "99123456" and "0035799123456" are one number, and a plain string
   * comparison would happily let all three through as three members.
   */
  const asked = toE164(phone);
  if (asked) {
    const clash = db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .all()
      .find((u) => toE164(u.phone) === asked);
    if (clash) {
      return NextResponse.json({ error: "PHONE_TAKEN" }, { status: 409 });
    }
  }

  /**
   * Both checks above read the table and then this writes to it, and in between
   * those two moments somebody else's registration can land. Rare, and the
   * database refuses it — see the unique indexes in db/schema.ts — but a refusal
   * that arrives as a thrown constraint error would reach the member as "500,
   * something went wrong" rather than "that email is already registered".
   *
   * So the throw is caught and turned back into the answer the checks above
   * would have given. The message names the column, which is the only thing we
   * need from it.
   */
  let user;
  try {
    user = db
      .insert(users)
      .values({
        name,
        email,
        phone,
        passwordHash: await hashPassword(password),
        /* Stamped with the moment it was given: a consent is a record, not a
           checkbox that can quietly flip. Required to register, so it is always
           set here. */
        serviceOptInAt: new Date(),
        /* Stamped in the same breath, because it was given in the same act. The
           schema has already refused anything but a literal true. */
        termsAcceptedAt: new Date(),
        marketingOptIn: Boolean(marketingOptIn),
        /* So the first thing they are sent — the code, and the promo email that
           follows it — is in the language they signed up in. */
        locale,
        /* Reachable on every channel from the start — email, SMS and push all
           on — because the studio would rather a new member hear about their
           booking and their class than miss it, and each channel is one press to
           turn off in the account. (SMS still only leaves the building once an
           SMS provider is configured and the message type opts into it; this is
           the stored preference, not a guarantee a text is sent.) */
        notifyEmail: true,
        notifySms: true,
        notifyPush: true,
        reminderMinutes: REMINDER_DEFAULT_MINUTES,
        /* Left null deliberately: the account exists and can do nothing until a
           code from that mailbox comes back. See lib/verify.ts. */
        emailVerifiedAt: null,
      })
      .returning()
      .get();
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/unique/i.test(msg)) {
      return NextResponse.json(
        { error: /phone/i.test(msg) ? "PHONE_TAKEN" : "EMAIL_TAKEN" },
        { status: 409 },
      );
    }
    throw e;
  }

  /**
   * The code, on its way.
   *
   * Awaited rather than fired and forgotten, because unlike a booking
   * confirmation this message *is* the next step: if it cannot be sent, the
   * member is looking at a box asking for something that will never arrive, and
   * they deserve to be told so on the spot rather than after two minutes of
   * waiting.
   *
   * A failure is still not a failed registration. The account is made, they are
   * signed in, and the verify screen has a "send it again" button — which is a
   * far better place to be than back at an empty form having lost everything
   * they typed.
   */
  const { code } = issueCode(user.id);
  let sent = true;
  try {
    /**
     * Capped, because the SMTP client allows twenty seconds *per reply* and a
     * conversation with a mail server is half a dozen replies. A sulking server
     * could hold this request open for a minute and a half, and the person on
     * the other end would have pressed the button three more times by then.
     *
     * Eight seconds is generous for a mail server that is working. When it is
     * exceeded the send is not cancelled — it may well arrive — the *waiting*
     * is, and the member goes to a screen with a "send it again" button on it.
     */
    const res = await Promise.race([
      sendVerificationCode(user.email, code, OTP_TTL_MINUTES, user.id),
      new Promise<{ ok: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: "TIMED_OUT" }), 8_000),
      ),
    ]);
    sent = res.ok;
    if (!res.ok) console.error("[verify] send failed for", user.email, res.error);
  } catch (e) {
    sent = false;
    console.error("[verify] send threw for", user.email, e);
  }

  /* Signed in, but not yet allowed to do anything: the session identifies them
     so the verify screen knows whose code to check. Every route that acts on a
     member's behalf checks the stamp, not the cookie. */
  await createSession(user);

  /**
   * The opening offer is deliberately NOT granted here.
   *
   * It used to be, on the argument that a promise made at registration should be
   * kept at registration. That argument was wrong, and in a way that is easy to
   * miss because nothing visibly breaks: this account has not proved it owns the
   * address yet. Anybody could type somebody else's email, or a made-up one, and
   * the studio would hand out a session and send a congratulatory message about
   * it. Unverified accounts are also deleted by the sweep after seven days, so
   * some of those sessions were granted to records that were about to be thrown
   * away, and every one of them sat in the studio's figures until it was.
   *
   * It moves to the verify route, which runs exactly once per account. Nothing
   * is lost by the wait: the offer is decided by `promoForJoin(user.createdAt)`,
   * so registering inside the window and confirming afterwards still qualifies.
   * See lib/promo.ts.
   */

  return NextResponse.json({
    ok: true,
    /* The form reads this and goes to /verify rather than to the timetable. */
    verify: true,
    sent,
    user: { id: user.id, name: user.name, email: user.email },
  });
}
