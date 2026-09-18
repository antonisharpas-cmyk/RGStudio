import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { formatInvoiceNo, invoiceIssuer } from "./invoice";
import { studioParts } from "./time";

/**
 * Handing out the next invoice number, gaplessly.
 *
 * A tax authority's requirement is not that numbers are unique — that is easy —
 * but that the sequence has **no gaps**. That rules out the two obvious
 * implementations. A random id is not a sequence. A counter incremented when a
 * checkout page opens leaves a hole every time somebody changes their mind,
 * and a studio cannot explain to an auditor why invoice 0043 does not exist.
 *
 * So a number is handed out at exactly one moment: when a payment has actually
 * succeeded and the sessions have been granted. Nothing earlier can consume
 * one, which means nothing that fails can waste one.
 *
 * ---
 *
 * **Why reading the maximum is safe here.**
 *
 * `select max(seq) + 1` is the classic race: two callers read the same maximum
 * and both write it. Three things prevent that being a problem.
 *
 * The read and the write happen inside one transaction, and better-sqlite3 is
 * synchronous with a single writer — a second caller cannot interleave.
 * The unique index on `invoice_no` refuses a duplicate outright even if the
 * database were swapped for one with real concurrency. And a purchase that
 * already has a number is handed back the one it has rather than a new one, so
 * the whole function is safe to call twice for the same payment, which matters
 * because a Stripe webhook and a returning browser both report the same
 * payment.
 */
export type AssignedInvoice =
  | { ok: true; invoiceNo: string; year: number; seq: number }
  /** The configuration is still placeholder, so nothing was consumed. */
  | { ok: false; reason: string };

export function assignInvoiceNumber(purchaseId: string): AssignedInvoice {
  const issuer = invoiceIssuer();

  const row = db
    .select({
      id: purchases.id,
      status: purchases.status,
      provider: purchases.provider,
      invoiceNo: purchases.invoiceNo,
      invoiceYear: purchases.invoiceYear,
      invoiceSeq: purchases.invoiceSeq,
      paidAt: purchases.paidAt,
    })
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();

  if (!row) return { ok: false, reason: "no such purchase" };
  if (row.status !== "PAID") return { ok: false, reason: "not paid" };

  /* Already numbered. Handed back rather than re-issued, which is what makes
     this safe for the webhook and the browser to both call. */
  if (row.invoiceNo && row.invoiceYear && row.invoiceSeq) {
    return {
      ok: true,
      invoiceNo: row.invoiceNo,
      year: row.invoiceYear,
      seq: row.invoiceSeq,
    };
  }

  /**
   * A specimen consumes nothing.
   *
   * The studio can look at a specimen invoice all it likes; what it must not do
   * is burn number 0001 on one, because the real sequence has to start at the
   * first real sale. So while the configuration is placeholder, no number is
   * assigned and the document says SPECIMEN where the number would be.
   */
  if (!issuer.real) return { ok: false, reason: issuer.why };

  /**
   * The studio's own year, not the server's.
   *
   * A payment taken at half past midnight on the first of January in Larnaca is
   * still the previous year in UTC, and an invoice dated in one year carrying a
   * number from another is the sort of thing that takes an afternoon to explain.
   */
  const year = studioParts(row.paidAt ?? new Date()).year;

  let assigned: AssignedInvoice = { ok: false, reason: "not assigned" };

  db.transaction(() => {
    const highest = db
      .select({ n: sql<number>`coalesce(max(${purchases.invoiceSeq}), 0)` })
      .from(purchases)
      .where(
        and(eq(purchases.invoiceYear, year), isNotNull(purchases.invoiceNo)),
      )
      .get();

    const seq = Number(highest?.n ?? 0) + 1;
    const invoiceNo = formatInvoiceNo(year, seq);

    const claimed = db
      .update(purchases)
      .set({ invoiceNo, invoiceYear: year, invoiceSeq: seq })
      .where(and(eq(purchases.id, row.id), sql`${purchases.invoiceNo} is null`))
      .returning({ id: purchases.id })
      .all();

    if (claimed.length) {
      assigned = { ok: true, invoiceNo, year, seq };
    } else {
      /* Somebody else numbered it between the read above and here. Read theirs
         rather than inventing a second number for one payment. */
      const mine = db
        .select({
          invoiceNo: purchases.invoiceNo,
          invoiceYear: purchases.invoiceYear,
          invoiceSeq: purchases.invoiceSeq,
        })
        .from(purchases)
        .where(eq(purchases.id, row.id))
        .get();
      assigned =
        mine?.invoiceNo && mine.invoiceYear && mine.invoiceSeq
          ? {
              ok: true,
              invoiceNo: mine.invoiceNo,
              year: mine.invoiceYear,
              seq: mine.invoiceSeq,
            }
          : { ok: false, reason: "could not claim a number" };
    }
  });

  return assigned;
}

/**
 * Every gap in the sequence, for the studio to see before an auditor does.
 *
 * Exists because "no gaps" is a promise this code makes and a promise nobody
 * can verify by reading it. If a number is ever missing — a row deleted, a
 * migration gone wrong, a bug in the function above — the studio should hear it
 * from its own admin screen rather than from the tax office.
 */
export function invoiceGaps(year: number) {
  const rows = db
    .select({ seq: purchases.invoiceSeq })
    .from(purchases)
    .where(and(eq(purchases.invoiceYear, year), isNotNull(purchases.invoiceNo)))
    .all()
    .map((r) => Number(r.seq))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let want = 1; want <= (rows.at(-1) ?? 0); want++) {
    if (!rows.includes(want)) gaps.push(want);
  }
  return { year, issued: rows.length, highest: rows.at(-1) ?? 0, gaps };
}
