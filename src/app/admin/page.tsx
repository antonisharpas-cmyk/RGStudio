import type { Metadata } from "next";
import { AdminBody } from "@/components/admin/AdminBody";
import { DeskLock } from "@/components/admin/DeskLock";
import { currentUser, deskUnlocked, isOwner, isStaff } from "@/lib/auth";
import { studioStats, upcomingClassCount } from "@/lib/admin";
import { getPackages } from "@/lib/catalogue";

export const metadata: Metadata = {
  title: "Reception",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * The desk console.
 *
 * /admin is a door of its own. Nobody is bounced to the member sign-in page and
 * back: whoever arrives is asked for a staff email and password right here, and
 * that one form both signs them in and unlocks the desk. Staff already signed
 * in whose 15-minute idle window has lapsed are asked for the password alone.
 *
 * Until the door is open this page loads *nothing* — no member list, no
 * takings, no phone numbers. That is the point: a locked console that has
 * already fetched the data it is protecting is not locked, it is decorated.
 * A visitor who is signed in as a member sees the same sign-in form as a
 * stranger, so the page never confirms who does or does not work here.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const user = await currentUser();
  const staff = user && isStaff(user);

  if (!staff) return <DeskLock />;
  if (!(await deskUnlocked(user.id))) return <DeskLock name={user.name} />;

  /* Reception's console never fetches the takings. The Analytics tab is not
     merely hidden from them — the query does not run, and /api/admin/stats
     refuses them — so there is nothing on the machine to find. */
  const owner = isOwner(user);
  const [stats, packs] = await Promise.all([
    owner ? studioStats() : Promise.resolve(null),
    getPackages(),
  ]);

  return (
    <AdminBody
      staffName={user.name}
      owner={owner}
      scheduled={upcomingClassCount()}
      /**
       * Which tab to open, decided here rather than in the browser.
       *
       * It used to be read from `window.location` inside a `useState`
       * initialiser, which cannot work: the server has no window, so it rendered
       * Bookings, the browser then read `?tab=members` and rendered Members, and
       * React reported the two as a hydration mismatch and threw the whole tree
       * away. Landing on /admin?tab=members is not an edge case either — it is
       * what saving a member does.
       *
       * The server knows the address. Passing it down means both renders agree.
       */
      initialTab={tab ?? null}
      stats={stats}
      /* Both names, because the desk reads in Greek too. Sending only the
         English one left every other word on the Pricing tab translated and
         the pack names in English — the one place the Greek console broke
         character. */
      packs={packs.map((p) => ({
        id: p.id,
        slug: p.slug,
        nameEn: p.nameEn,
        nameEl: p.nameEl,
        credits: p.credits,
        priceCents: p.priceCents,
        listPriceCents: p.listPriceCents,
        discountLabelEn: p.discountLabelEn,
        discountLabelEl: p.discountLabelEl,
        /* The list price itself, before any offer, and whether the desk set it. */
        basePriceCents: p.listPriceCents ?? p.priceCents,
        priceEdited: Boolean(p.priceEditedAt),
      }))}
    />
  );
}
