/**
 * Draw a sample invoice, so the layout and the VAT arithmetic can be looked at
 * without taking a payment.
 *
 *   npm run invoice:preview            a SPECIMEN, using whatever .env holds
 *   npm run invoice:preview -- real    pretends the configuration is complete
 *
 * Writes docs/invoice-sample.pdf. It exists because the only other way to check
 * an invoice is to buy something, and the studio should be able to read its own
 * paperwork before a member ever sees it.
 */
import { writeFileSync } from "node:fs";

async function main() {
  const asReal = process.argv[2] === "real";

  if (asReal) {
    /* Set only inside this process, for this preview. Never written anywhere.
       The legal identifiers are invented on purpose — an invoice carrying a
       made-up VAT number cannot be mistaken for a real one if it leaks out of
       a screenshot — while the contact address is the studio's own, because
       the point of the preview is to see the layout with something of the
       right shape in every field. */
    process.env.INVOICE_LEGAL_NAME = "RG Wellness Ltd";
    process.env.INVOICE_ADDRESS =
      "Patron 30, Larnaca 6051, Cyprus";
    process.env.INVOICE_VAT_NUMBER = "CY10456789J";
    process.env.INVOICE_REG_NUMBER = "HE 456789";
    process.env.INVOICE_VAT_RATE = "19";
    process.env.INVOICE_EMAIL = "info@rgpilatesstudio.com";
    process.env.INVOICE_PHONE = "+357 24 000000";
  }

  /* Imported after the environment is set, because the issuer is read at call
     time from process.env and a top-level import would be fine either way —
     but this makes the order explicit rather than incidental. */
  const { invoicePdf } = await import("../src/lib/invoice-pdf");
  const { invoiceIssuer, vatSplit } = await import("../src/lib/invoice");

  const issuer = invoiceIssuer();
  const split = vatSplit(18000, issuer.vatRatePercent);

  const pdf = await invoicePdf({
    invoiceNo: asReal ? "2026-0042" : null,
    issuedAt: new Date(),
    description: "10-class pack - Reformer Pilates",
    credits: 10,
    grossCents: 18000,
    currency: "eur",
    customer: { name: "Maria Georgiou", email: "maria@example.com" },
    paidWith: "Card",
    reference: "pi_3QxSampleReference",
  });

  const out = "docs/invoice-sample.pdf";
  writeFileSync(out, pdf);

  console.log(`\n  ${out}  ${(pdf.length / 1024).toFixed(1)} kB`);
  console.log(
    `  ${issuer.real ? "configured" : `SPECIMEN — ${issuer.why}`}`,
  );
  console.log(
    `  gross ${split.grossCents / 100}  net ${split.netCents / 100}  vat ${
      split.vatCents / 100
    }  at ${split.ratePercent}%`,
  );
  console.log(
    `  net + vat = ${(split.netCents + split.vatCents) / 100} (must equal gross)\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
