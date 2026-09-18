import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccountBody } from "@/components/account/AccountBody";
import { currentUser, isVerified } from "@/lib/auth";
import { listMyBookings } from "@/lib/booking";
import { getCreditSummary, getLedger } from "@/lib/credits";
import { currentSubscription } from "@/lib/subscriptions";
import { getMyPurchases } from "@/lib/purchases";
import { hasAvatar } from "@/lib/avatars";
import { noticesFor } from "@/lib/notices";
import { isPilatesExperience, isPilatesLevel } from "@/lib/intake";
import { pushPublicKey } from "@/lib/messaging/push";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/dictionaries";

export const metadata: Metadata = { title: "My account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");
  /* Nothing on this page is safe to show an account that has never proved its
     address — it is the balance, the payment history and the profile. */
  if (!isVerified(user)) redirect("/verify?next=/account");

  const [wallet, bookings, purchases, ledger] = await Promise.all([
    getCreditSummary(user.id),
    listMyBookings(user.id),
    getMyPurchases(user.id),
    getLedger(user.id, 25),
  ]);

  /* The language the member is reading the site in, from the same cookie the
     layout uses. Without this the first page of notices was always English —
     the Greek version was written, stored and then never asked for. */
  const jar = await cookies();
  const chosen = jar.get(LOCALE_COOKIE)?.value ?? "";
  const locale = (LOCALES as readonly string[]).includes(chosen)
    ? (chosen as Locale)
    : "en";

  /* The first page only. The list fetches the rest itself as the member pages
     through, so the initial HTML stays small however long they have been a
     member. */
  const firstPage = noticesFor(user.id, locale);
  const notices = {
    ...firstPage,
    rows: firstPage.rows.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
  };

  const taken = bookings.past.filter(
    (b) => b.status === "ATTENDED" || b.status === "CONFIRMED",
  ).length;

  return (
    <AccountBody
      user={{
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      }}
      wallet={{
        available: wallet.available,
        classCredits: wallet.classCredits,
        soloCredits: wallet.soloCredits,
        duetCredits: wallet.duetCredits,
        nextExpiry: wallet.nextExpiry?.toISOString() ?? null,
        nextExpiryCredits: wallet.nextExpiryCredits,
        batches: wallet.batches.map((b) => ({
          id: b.id,
          creditsRemaining: b.creditsRemaining,
          creditsTotal: b.creditsTotal,
          expiresAt: b.expiresAt?.toISOString() ?? null,
          source: b.source,
          usableFrom: b.usableFrom?.toISOString() ?? null,
          usableTo: b.usableTo?.toISOString() ?? null,
        })),
      }}
      notices={notices}
      pushPublicKey={pushPublicKey()}
      classesTaken={taken}
      plan={(() => {
        const p = currentSubscription(user.id);
        return p
          ? {
              id: p.id,
              months: p.months,
              perWeek: p.perWeek,
              monthlyPriceCents: p.monthlyPriceCents,
              status: p.status,
              paidThrough: p.paidThrough?.toISOString() ?? null,
              dueBy: p.dueBy?.toISOString() ?? null,
              monthsPaid: p.monthsPaid,
              owing: p.owing,
              frozen: p.frozen,
              creditsRemaining: p.creditsRemaining,
            }
          : null;
      })()}
      profile={{
        name: user.name,
        email: user.email,
        phone: user.phone,
        birthDate: user.birthDate,
        marketingOptIn: user.marketingOptIn,
        serviceOptIn: user.serviceOptInAt !== null,
        notifyEmail: user.notifyEmail,
        notifySms: user.notifySms,
        notifyPush: user.notifyPush,
        reminderMinutes: user.reminderMinutes,
        hasPhoto: await hasAvatar(user.id),
        /* Narrowed rather than cast: these are text columns, so a value written
           by an older build or by hand is possible and must read as "unset"
           instead of putting an unknown string into a group of buttons. */
        pilatesLevel: isPilatesLevel(user.pilatesLevel) ? user.pilatesLevel : null,
        pilatesSince: isPilatesExperience(user.pilatesSince)
          ? user.pilatesSince
          : null,
        healthCondition: user.healthCondition ?? null,
        intakeAnswered: user.intakeAt !== null,
      }}
      upcoming={bookings.upcoming.map(serialiseBooking)}
      past={bookings.past.slice(0, 20).map(serialiseBooking)}
      purchases={purchases.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
      }))}
      ledger={ledger.map((l) => ({
        id: l.id,
        delta: l.delta,
        reason: l.reason,
        note: l.note,
        createdAt: l.createdAt.toISOString(),
      }))}
    />
  );
}

function serialiseBooking(b: {
  id: string;
  status: string;
  creditRefunded: boolean;
  startsAt: Date;
  endsAt: Date;
  className: { en: string; el: string };
  instructor: string | null;
  freeCancellationUntil: Date;
  kind: string;
  guestName: string | null;
}) {
  return {
    id: b.id,
    status: b.status,
    creditRefunded: b.creditRefunded,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    className: b.className,
    instructor: b.instructor,
    freeCancellationUntil: b.freeCancellationUntil.toISOString(),
    kind: b.kind,
    guestName: b.guestName,
  };
}
