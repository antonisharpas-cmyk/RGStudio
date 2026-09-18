import { and, desc, eq, gt, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { creditPackages, purchases } from "@/db/schema";

/** A payment that has been sitting unfinished this long was abandoned. */
const ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000;
/** Below this, a pending payment is probably still happening right now. */
const IN_FLIGHT_MS = 30 * 60 * 1000;

/**
 * Closes off payments that were opened and never finished.
 *
 * Opening the checkout page writes a PENDING purchase, because the provider
 * needs a reference before it will take a card. Most of those are completed
 * within a minute; the rest are people who changed their mind, and leaving them
 * PENDING for ever would fill the member's payment history and the studio's
 * admin screen with rows that never meant anything.
 *
 * Runs on read, like the other repairs in this project, so it needs no cron and
 * no remembering. It only ever touches rows that are still PENDING, so a
 * payment that did land is never disturbed.
 */
function closeAbandoned() {
  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS);
  db.update(purchases)
    .set({ status: "FAILED" })
    .where(
      and(eq(purchases.status, "PENDING"), lt(purchases.createdAt, cutoff)),
    )
    .run();
}

export async function getMyPurchases(userId: string, limit = 20) {
  closeAbandoned();

  const rows = await db
    .select({ p: purchases, pkg: creditPackages })
    .from(purchases)
    .leftJoin(creditPackages, eq(purchases.packageId, creditPackages.id))
    .where(
      and(
        eq(purchases.userId, userId),
        /* Anything that reached a conclusion, plus a payment that is genuinely
           in flight right now. Not every page the member happened to open. */
        or(
          gt(purchases.createdAt, new Date(Date.now() - IN_FLIGHT_MS)),
          eq(purchases.status, "PAID"),
          eq(purchases.status, "REFUNDED"),
        ),
      ),
    )
    .orderBy(desc(purchases.createdAt))
    .limit(limit);

  return rows.map(({ p, pkg }) => ({
    id: p.id,
    credits: p.credits,
    amountCents: p.amountCents,
    status: p.status,
    provider: p.provider,
    createdAt: p.createdAt,
    paidAt: p.paidAt,
    /* So the member can find the receipt again without digging out the email
       it arrived in, which is where people actually look for it. */
    receiptUrl: p.receiptUrl,
    /* Non-null means there is an invoice PDF to download. The number itself is
       shown too: it is what an accountant asks for by name. */
    invoiceNo: p.invoiceNo,
    packageName: pkg ? { en: pkg.nameEn, el: pkg.nameEl } : null,
  }));
}
