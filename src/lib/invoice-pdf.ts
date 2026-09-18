import PDFDocument from "pdfkit";
import { STUDIO } from "./studio";
import {
  invoiceIssuer,
  isSpecimen,
  PRICES_INCLUDE_VAT,
  SPECIMEN_NO,
  vatSplit,
  type InvoiceIssuer,
} from "./invoice";
import { studioParts } from "./time";

/**
 * The invoice, as a PDF, drawn rather than printed from a web page.
 *
 * The obvious way to make a PDF is to render HTML and print it with a headless
 * browser, and this repository already does that for the desk manual. It is the
 * wrong tool here: that runs as a script on somebody's laptop with a whole
 * Chromium to itself, while this runs inside a web request on a 512MB instance
 * that is also serving the timetable. A browser per invoice is how a small
 * server starts refusing page loads at the exact moment somebody is paying.
 *
 * So the document is drawn with pdfkit — no browser, a few megabytes of memory,
 * and about as long to produce as a database query.
 *
 * ---
 *
 * **Why the document is in English.**
 *
 * Not an oversight. pdfkit's built-in fonts are WinAnsi-encoded and have no
 * Greek glyphs at all, so Greek text would come out as blanks or worse — and
 * fixing that means shipping a Greek-capable TTF in the repository and
 * embedding it in every file. An invoice in English is normal and accepted in
 * Cyprus, and getting one that is *correct* out today is worth more than a
 * bilingual one later. The line items name the pack in English, which is also
 * what the studio's own bookkeeping calls it.
 *
 * If the studio does want Greek, it is one font file and a `doc.font()` call,
 * and this comment is the note explaining why nobody did it yet.
 */

export type InvoiceData = {
  /** The studio's own number, or null for a document that has none. */
  invoiceNo: string | null;
  /** When the payment was taken. Dated in the studio's timezone. */
  issuedAt: Date;
  /** What was bought, in words a person recognises. */
  description: string;
  /** How many sessions. Printed as the quantity. */
  credits: number;
  /** What was actually paid, VAT included. */
  grossCents: number;
  currency: string;
  customer: {
    name: string;
    email: string;
    /** A member's own VAT number, if they ever gave one. Usually absent. */
    vatNumber?: string | null;
  };
  /** "Card", "Cash", and so on — what the studio was paid with. */
  paidWith: string;
  /** The provider's own reference, for tracing one payment to one charge. */
  reference?: string | null;
};

const MOCHA = "#2C2826";
const CLAY = "#8F857D";
const RULE = "#DFD8D3";

export function invoicePdf(data: InvoiceData): Promise<Buffer> {
  const issuer = invoiceIssuer();
  const specimen = isSpecimen(data.invoiceNo) || !issuer.real;
  const split = vatSplit(data.grossCents, issuer.vatRatePercent);

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Invoice ${data.invoiceNo ?? SPECIMEN_NO} — ${issuer.legalName || STUDIO.name}`,
      Author: issuer.legalName || STUDIO.name,
      Subject: "Invoice",
    },
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    draw(doc, { data, issuer, split, specimen });
    doc.end();
  });
}

function draw(
  doc: PDFKit.PDFDocument,
  ctx: {
    data: InvoiceData;
    issuer: InvoiceIssuer;
    split: ReturnType<typeof vatSplit>;
    specimen: boolean;
  },
) {
  const { data, issuer, split, specimen } = ctx;
  const left = 50;
  const right = 545;
  const money = (cents: number) => eur(cents, data.currency);

  /**
   * The specimen stamp, drawn first so everything else sits on top of it.
   *
   * Diagonal, pale, and across the whole page: this document must be
   * unmistakable at a glance and impossible to crop out of a screenshot. The
   * cost of somebody mistaking a specimen for a real invoice is a false tax
   * document with the studio's name on it, so subtlety would be the wrong
   * instinct here.
   */
  if (specimen) {
    doc.save();
    doc.rotate(-38, { origin: [300, 420] });
    doc
      .font("Helvetica-Bold")
      .fontSize(74)
      .fillColor("#DFD8D2")
      .text("SPECIMEN", 40, 380, { width: 560, align: "center" });
    doc.restore();
  }

  /* ------------------------------------------------------------------ heading */
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(CLAY)
    .text("RG PILATES STUDIO", left, 52, { characterSpacing: 2.4 });

  doc
    .font("Helvetica")
    .fontSize(24)
    .fillColor(MOCHA)
    .text(specimen ? "Specimen invoice" : "Invoice", left, 70);

  /* The issuer, right-aligned against the title. */
  const issuerLines = [
    issuer.legalName || "[INVOICE_LEGAL_NAME not set]",
    issuer.address || "[INVOICE_ADDRESS not set]",
    issuer.vatNumber ? `VAT no. ${issuer.vatNumber}` : "[not VAT registered]",
    issuer.regNumber ? `Reg. no. ${issuer.regNumber}` : "",
    issuer.email,
    issuer.phone,
  ].filter(Boolean);

  doc.font("Helvetica").fontSize(9).fillColor(CLAY);
  let y = 56;
  for (const line of issuerLines) {
    doc.text(line, right - 220, y, { width: 220, align: "right" });
    y += 12;
  }

  /* ------------------------------------------------------- number and dates */
  const at = studioParts(data.issuedAt);
  const dated = `${String(at.day).padStart(2, "0")}/${String(at.month).padStart(2, "0")}/${at.year}`;

  doc.moveTo(left, 152).lineTo(right, 152).strokeColor(RULE).lineWidth(1).stroke();

  field(doc, left, 166, "Invoice number", data.invoiceNo ?? SPECIMEN_NO);
  field(doc, left + 170, 166, "Date of issue", dated);
  field(doc, left + 340, 166, "Paid Upon Issuance With", data.paidWith);

  /* ------------------------------------------------------------- the customer */
  field(doc, left, 218, "Billed to", data.customer.name);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MOCHA)
    .text(data.customer.email, left, 248);
  if (data.customer.vatNumber) {
    doc.text(`VAT no. ${data.customer.vatNumber}`, left, 262);
  }

  /* ------------------------------------------------------------- the line item */
  const tableTop = 300;
  doc.moveTo(left, tableTop).lineTo(right, tableTop).strokeColor(RULE).stroke();

  doc.font("Helvetica-Bold").fontSize(8).fillColor(CLAY);
  doc.text("DESCRIPTION", left, tableTop + 10, { characterSpacing: 1.4 });
  doc.text("QTY", left + 300, tableTop + 10, { width: 40, align: "right", characterSpacing: 1.4 });
  doc.text("NET", left + 350, tableTop + 10, { width: 70, align: "right", characterSpacing: 1.4 });
  doc.text("TOTAL", left + 430, tableTop + 10, { width: 65, align: "right", characterSpacing: 1.4 });

  doc.moveTo(left, tableTop + 26).lineTo(right, tableTop + 26).strokeColor(RULE).stroke();

  doc.font("Helvetica").fontSize(10).fillColor(MOCHA);
  doc.text(data.description, left, tableTop + 38, { width: 290 });
  doc.text(String(data.credits), left + 300, tableTop + 38, { width: 40, align: "right" });
  doc.text(money(split.netCents), left + 350, tableTop + 38, { width: 70, align: "right" });
  doc.text(money(split.grossCents), left + 430, tableTop + 38, { width: 65, align: "right" });

  /* --------------------------------------------------------------- the totals */
  let ty = tableTop + 80;
  doc.moveTo(left + 300, ty).lineTo(right, ty).strokeColor(RULE).stroke();
  ty += 12;

  total(doc, ty, "Subtotal excluding VAT", money(split.netCents));
  ty += 18;

  /**
   * The VAT line, or an honest statement that there is none.
   *
   * A zero rate is not "VAT at 0%" — it means the studio is not charging VAT,
   * and printing a 0% line invites the reader to assume a zero-rated supply,
   * which is a different thing in tax law. So the document says which it is.
   */
  if (split.ratePercent > 0) {
    total(doc, ty, `VAT at ${trimRate(split.ratePercent)}%`, money(split.vatCents));
    ty += 18;
  } else {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(CLAY)
      .text("No VAT charged on this supply.", left + 300, ty, {
        width: 195,
        align: "right",
      });
    ty += 18;
  }

  doc.moveTo(left + 300, ty + 2).lineTo(right, ty + 2).strokeColor(RULE).stroke();
  ty += 14;

  doc.font("Helvetica-Bold").fontSize(12).fillColor(MOCHA);
  doc.text("Total paid", left + 300, ty, { width: 110, align: "left" });
  doc.text(money(split.grossCents), left + 410, ty, { width: 85, align: "right" });

  /* ----------------------------------------------------------------- the foot */
  const footY = 640;
  doc.moveTo(left, footY).lineTo(right, footY).strokeColor(RULE).stroke();

  const notes: string[] = [];
  if (PRICES_INCLUDE_VAT && split.ratePercent > 0) {
    notes.push("All prices include VAT. This document is your VAT invoice.");
  }
  notes.push(
    "Sessions are valid until the expiry date shown in your account and are not refundable.",
  );
  if (data.reference) notes.push(`Payment reference: ${data.reference}`);
  if (specimen) {
    notes.push(
      issuer.real
        ? "SPECIMEN: this payment has no invoice number, so this is not a valid invoice."
        : `SPECIMEN: ${issuer.why}. This is not a valid invoice and must not be given to a client.`,
    );
  }

  doc.font("Helvetica").fontSize(8.5).fillColor(CLAY);
  doc.text(notes.join("\n"), left, footY + 12, { width: right - left, lineGap: 3 });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(CLAY)
    .text(
      STUDIO.addressLines.join(", "),
      left,
      780,
      { width: right - left, align: "center" },
    );
}

function field(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  label: string,
  value: string,
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(CLAY)
    .text(label.toUpperCase(), x, y, { characterSpacing: 1.4 });
  doc.font("Helvetica").fontSize(11).fillColor(MOCHA).text(value, x, y + 13);
}

function total(doc: PDFKit.PDFDocument, y: number, label: string, value: string) {
  doc.font("Helvetica").fontSize(9.5).fillColor(CLAY);
  doc.text(label, 350, y, { width: 110, align: "left" });
  doc.font("Helvetica").fontSize(9.5).fillColor(MOCHA);
  doc.text(value, 460, y, { width: 85, align: "right" });
}

/** "19" not "19.00", but "8.5" survives. */
function trimRate(n: number) {
  return String(Number(n.toFixed(2)));
}

/**
 * Money, written out rather than formatted by Intl.
 *
 * `Intl.NumberFormat` with `style: "currency"` produces "€20.00" using U+20AC,
 * which the built-in PDF fonts do carry — but it also inserts non-breaking and
 * narrow no-break spaces depending on locale and ICU version, and those are not
 * in WinAnsi. One of them lands in the file as a black box on a tax document.
 * Three digits and a symbol are not worth that risk.
 */
function eur(cents: number, currency: string) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  const symbol = (currency || "eur").toLowerCase() === "eur" ? "EUR " : `${currency.toUpperCase()} `;
  return `${sign}${symbol}${whole}.${rest}`;
}
