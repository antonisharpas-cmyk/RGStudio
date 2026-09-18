/**
 * The studio's own invoice: who is issuing it, at what rate, and numbered how.
 *
 * A Stripe receipt is not a VAT invoice. It shows what was charged and to which
 * card, and says nothing about tax — no VAT number, no net-and-VAT breakdown,
 * nothing an accountant can put through a set of books. Stripe *can* issue real
 * invoices, but only through its own hosted Checkout flow, which would mean
 * sending members to a page at stripe.com and giving up the card fields in our
 * own page. So the studio issues its own, which has the side benefit of being
 * ours: bilingual if it needs to be, in the studio's own words, and available
 * for a cash sale that Stripe never sees.
 *
 * ---
 *
 * **Everything identifying the business is configuration, not code.**
 *
 * The legal name, the address, the VAT number and the rate are read from the
 * environment. They are facts about a company, they were not known when this
 * was written, and they will change — a rate rises, a company re-registers, an
 * address moves. Putting them in a file would mean a deploy to correct a
 * typo on a legal document.
 *
 * ---
 *
 * **The specimen guard, which is the important part of this file.**
 *
 * Until the real details arrive, the values here are placeholders. A document
 * carrying a made-up VAT number, sent to a real member who forwards it to a
 * real accountant, is not a rough draft — it is a false tax document with the
 * studio's name on it. So anything that is not demonstrably a real
 * configuration produces a SPECIMEN: stamped as one, numbered as one, and never
 * drawn from the real invoice sequence.
 *
 * That is also why a specimen is not simply refused. The studio needs to look
 * at the layout, the wording and the arithmetic today, with the numbers it will
 * have next week — it just must not be able to hand one to a client by
 * accident.
 */

/** How the price list is quoted. The studio's prices include VAT. */
export const PRICES_INCLUDE_VAT = true;

export type InvoiceIssuer = {
  /** The company, as registered. Not the trading name. */
  legalName: string;
  /** One line, as it should print. */
  address: string;
  /** Cyprus VAT registration, e.g. CY10123456X. Empty when not registered. */
  vatNumber: string;
  /** Company registration number, when there is one. */
  regNumber: string;
  /**
   * The rate as a percentage, so 19 means 19%.
   *
   * Zero is a real and meaningful answer: a business that is not VAT
   * registered, or a service that is exempt, charges none and must not print a
   * VAT line pretending otherwise.
   */
  vatRatePercent: number;
  /** Where a member should write about an invoice. */
  email: string;
  phone: string;
  /**
   * False when the configuration above is placeholder or incomplete, in which
   * case every document produced is stamped SPECIMEN and none of them consume
   * an invoice number. See the note at the top of this file.
   */
  real: boolean;
  /** Why it is not real, for the desk to read. Empty when it is. */
  why: string;
};

/**
 * Values that are obviously not a real VAT registration.
 *
 * Deliberately generous. The cost of treating a real number as fake is a
 * document stamped SPECIMEN and somebody asking why; the cost of treating a
 * fake number as real is a false tax document in a client's inbox. Those are
 * not comparable, so this errs heavily towards SPECIMEN.
 */
const PLACEHOLDER = /test|example|sample|specimen|placeholder|xxx|123456789|000000|changeme|todo/i;

/**
 * A Cyprus VAT number: eight digits and a checksum letter, with the CY country
 * prefix optional.
 *
 * The studio quotes it on its domestic invoice without the prefix (e.g. 12345678X),
 * which is ordinary Cyprus practice; the CY prefix is the intra-EU / VIES form
 * (e.g. CY12345678X) a client would want for a cross-border reclaim. Either is
 * accepted here, and whichever is configured in INVOICE_VAT_NUMBER is exactly
 * what prints on the document — see invoice-pdf.ts. Only the shape is checked,
 * not the checksum, because the specimen guard's job is to catch a placeholder,
 * not to be a validator.
 */
const CY_VAT = /^(CY)?\d{8}[A-Z]$/i;

export function invoiceIssuer(): InvoiceIssuer {
  const env = (k: string) => (process.env[k] ?? "").trim();

  const legalName = env("INVOICE_LEGAL_NAME");
  const address = env("INVOICE_ADDRESS");
  const vatNumber = env("INVOICE_VAT_NUMBER").toUpperCase();
  const regNumber = env("INVOICE_REG_NUMBER");
  const rateRaw = env("INVOICE_VAT_RATE");
  const email = env("INVOICE_EMAIL") || env("STUDIO_OPS_EMAIL");
  const phone = env("INVOICE_PHONE");

  const rate = Number(rateRaw);
  const vatRatePercent =
    Number.isFinite(rate) && rate >= 0 && rate <= 30 ? rate : 0;

  /* Every reason in order of how likely it is to be the one, so the desk sees
     the first thing to fix rather than a list. */
  let why = "";
  if (!legalName) why = "INVOICE_LEGAL_NAME is not set";
  else if (!address) why = "INVOICE_ADDRESS is not set";
  else if (!vatNumber) why = "INVOICE_VAT_NUMBER is not set";
  else if (PLACEHOLDER.test(vatNumber) || PLACEHOLDER.test(legalName)) {
    why = "the legal name or VAT number is still a placeholder";
  } else if (!CY_VAT.test(vatNumber)) {
    why = `${vatNumber} is not the shape of a Cyprus VAT number (8 digits and a letter, optionally CY-prefixed)`;
  } else if (!rateRaw) why = "INVOICE_VAT_RATE is not set";

  return {
    legalName,
    address,
    vatNumber,
    regNumber,
    vatRatePercent,
    email,
    phone,
    real: why === "",
    why,
  };
}

/* ------------------------------------------------------------------ the maths */

export type VatSplit = {
  /** What the member actually paid. */
  grossCents: number;
  /** The part that is the studio's income. */
  netCents: number;
  /** The part that belongs to the tax office. */
  vatCents: number;
  ratePercent: number;
};

/**
 * Split an inclusive price into net and VAT.
 *
 * The studio quotes VAT-inclusive prices — €20 is €20 at the counter, not €20
 * plus tax — so the arithmetic runs backwards from the total. The net is
 * rounded to the cent and the VAT is then whatever is left over, rather than
 * both being rounded independently: rounding twice is how an invoice ends up
 * with a net and a VAT that do not add up to the total somebody paid, which is
 * the one error on a tax document nobody will accept.
 *
 * A rate of zero gives the whole amount as net and no VAT line, which is the
 * correct document for a business that is not registered or a service that is
 * exempt.
 */
export function vatSplit(grossCents: number, ratePercent: number): VatSplit {
  if (!ratePercent || ratePercent <= 0) {
    return { grossCents, netCents: grossCents, vatCents: 0, ratePercent: 0 };
  }
  const netCents = Math.round(grossCents / (1 + ratePercent / 100));
  return {
    grossCents,
    netCents,
    vatCents: grossCents - netCents,
    ratePercent,
  };
}

/* --------------------------------------------------------------- the numbering */

/**
 * How an invoice number is written: the year, then a run of digits.
 *
 * A tax authority wants a sequence with no gaps in it, which is a constraint on
 * *when* a number is handed out rather than on how it looks — see
 * `assignInvoiceNumber`. Restarting each January is the ordinary convention and
 * keeps the numbers short enough to read aloud over the phone.
 */
export function formatInvoiceNo(year: number, seq: number, prefix = "") {
  const p = (prefix || (process.env.INVOICE_PREFIX ?? "")).trim();
  return `${p}${year}-${String(seq).padStart(4, "0")}`;
}

/** What a document is called when it is not a real invoice. */
export const SPECIMEN_NO = "SPECIMEN";

export function isSpecimen(invoiceNo: string | null | undefined) {
  return !invoiceNo || invoiceNo === SPECIMEN_NO;
}
