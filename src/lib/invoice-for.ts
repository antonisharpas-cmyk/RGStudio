import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creditPackages, purchases, users } from "@/db/schema";
import { invoicePdf, type InvoiceData } from "./invoice-pdf";

/**
 * The invoice for one purchase, gathered from the database and drawn.
 *
 * One function, three callers: the confirmation email attaches what it returns,
 * the member downloads it from their account, and the desk downloads it from a
 * member's card. Having them share this rather than each assemble their own
 * `InvoiceData` is the difference between one invoice and three documents that
 * disagree about what somebody bought.
 *
 * Returns null when there is nothing to draw — no such purchase, or one that has
 * not been paid. Never throws for those: two of the three callers are showing
 * somebody a page, and a missing invoice is a 404, not a stack trace.
 */
export async function invoiceForPurchase(purchaseId: string) {
  const row = db
    .select({
      id: purchases.id,
      userId: purchases.userId,
      credits: purchases.credits,
      amountCents: purchases.amountCents,
      currency: purchases.currency,
      status: purchases.status,
      provider: purchases.provider,
      providerRef: purchases.providerRef,
      paidAt: purchases.paidAt,
      createdAt: purchases.createdAt,
      invoiceNo: purchases.invoiceNo,
      name: users.name,
      email: users.email,
      packEn: creditPackages.nameEn,
    })
    .from(purchases)
    .innerJoin(users, eq(purchases.userId, users.id))
    .leftJoin(creditPackages, eq(purchases.packageId, creditPackages.id))
    .where(eq(purchases.id, purchaseId))
    .get();

  if (!row) return null;
  /* An invoice exists for a sale that was made — which includes one later
     refunded. The invoice was issued and numbered when the money came in, and a
     member (or the studio) still needs to open that document afterwards; a
     refund is handled separately and does not un-issue the invoice. Only a
     purchase that never completed (PENDING, FAILED) has no invoice to draw. */
  if (row.status !== "PAID" && row.status !== "REFUNDED") return null;

  const data: InvoiceData = {
    invoiceNo: row.invoiceNo,
    /* The moment the money arrived, not the moment the checkout page opened.
       An invoice is dated by the payment. */
    issuedAt: row.paidAt ?? row.createdAt,
    /* The pack as it was called when it was sold. A pack renamed or withdrawn
       since must not change what an old invoice says was bought. */
    description: row.packEn
      ? `${row.packEn} - Reformer Pilates`
      : `${row.credits} Reformer Pilates sessions`,
    credits: row.credits,
    grossCents: row.amountCents,
    currency: row.currency,
    customer: { name: row.name, email: row.email },
    paidWith: paidWithWords(row.provider),
    /* No payment reference on the receipt. A Stripe charge id (pi_…) and a desk
       sale's `desk:` tag are both internal plumbing that reads as noise to the
       client, and the studio can trace a payment from the Stripe dashboard or
       the ledger without printing it on everyone's copy. The field stays on
       InvoiceData for whoever wants it internally; the invoice simply omits it. */
    reference: null,
  };

  return {
    userId: row.userId,
    invoiceNo: row.invoiceNo,
    filename: filenameFor(row.invoiceNo, row.id),
    pdf: await invoicePdf(data),
  };
}

/** What the studio was paid with, in words rather than a provider slug. */
function paidWithWords(provider: string) {
  switch (provider) {
    case "stripe":
      return "Card";
    case "cash":
      return "Cash";
    case "card_at_desk":
      return "Card at the studio";
    case "test":
      return "Test payment";
    default:
      return provider;
  }
}

/**
 * What the file is called when it lands in somebody's downloads.
 *
 * The invoice number, because that is the thing an accountant searches for. A
 * document with no number falls back to the purchase id, which is at least
 * unique — a folder of files all called `invoice.pdf` is its own small disaster.
 */
function filenameFor(invoiceNo: string | null, purchaseId: string) {
  const stem = invoiceNo ?? `specimen-${purchaseId.slice(0, 8)}`;
  return `RG-pilates-invoice-${stem}.pdf`;
}
