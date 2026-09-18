import { NextResponse } from "next/server";
import { owner } from "@/lib/api-guard";
import {
  logisticsRows,
  type LogisticsMethod,
  type LogisticsRow,
} from "@/lib/admin";
import { studioParts } from "@/lib/time";

/**
 * The period's sales, as a spreadsheet the accountant can open.
 *
 * Owner only, and for the same reason the takings screen is: this is money the
 * studio took, name by name. A GET rather than a POST because a browser can only
 * be made to save a file by navigating to a URL, and a navigation is a GET — the
 * panel points `window.location` here and the `Content-Disposition: attachment`
 * turns the response into a download rather than a page.
 *
 * No Stripe fee column: the fee lives only in Stripe and only on the online
 * rows. The studio pulls that from the Stripe dashboard and sets it against the
 * online total here. This file is the book of record for what was sold; Stripe's
 * report is the record of what it cost to bank the card share of it.
 */
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | null) => (v && DAY.test(v) ? v : null);
const METHODS: readonly string[] = ["all", "online", "cash", "card_at_desk"];

export async function GET(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const q = new URL(req.url).searchParams;
  let from = clean(q.get("from"));
  let to = clean(q.get("to"));
  /* A backwards range is a slip, not a request for nothing: read it the way it
     was meant rather than handing back an empty file. */
  if (from && to && from > to) [from, to] = [to, from];
  const m = q.get("method");
  const method: LogisticsMethod = METHODS.includes(m ?? "")
    ? (m as LogisticsMethod)
    : "all";

  const rows = logisticsRows({ from, to, method });

  const stamp = `${from ?? "all"}_to_${to ?? "all"}`;
  /* A UTF-8 BOM so Excel opens Greek member names as Greek rather than mojibake.
     Nothing else reads the file, and everything that does understands a BOM. */
  return new NextResponse("﻿" + buildCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rg-sales-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/* ------------------------------------------------------------------ the sheet */

const HEADER = [
  "Date",
  "Member",
  "Email",
  "Pack",
  "Method",
  "Gross",
  "Net",
  "VAT",
  "VAT %",
  "Currency",
  "Invoice",
  "Sessions",
];

function buildCsv(rows: LogisticsRow[]): string {
  const lines = [HEADER.map(cell).join(",")];

  for (const r of rows) {
    lines.push(
      [
        fmtDate(r.paidAt),
        r.memberName,
        r.memberEmail,
        r.pack,
        methodLabel(r.method),
        money(r.grossCents),
        money(r.netCents),
        money(r.vatCents),
        String(r.vatRatePercent),
        (r.currency || "eur").toUpperCase(),
        r.invoiceNo ?? "",
        String(r.credits),
      ]
        .map(cell)
        .join(","),
    );
  }

  /* A totals line, because the first thing anybody does with a sales export is
     add the money column, and a total that is computed here cannot disagree with
     the rows above it. */
  const tot = (pick: (r: LogisticsRow) => number) =>
    rows.reduce((s, r) => s + pick(r), 0);
  lines.push(
    [
      "",
      "",
      "",
      "",
      "TOTAL",
      money(tot((r) => r.grossCents)),
      money(tot((r) => r.netCents)),
      money(tot((r) => r.vatCents)),
      "",
      "",
      "",
      String(rows.length),
    ]
      .map(cell)
      .join(","),
  );

  return lines.join("\r\n");
}

/** A cell, quoted only when it has to be — and never a formula. */
function cell(v: string): string {
  /* Neutralise spreadsheet formula injection. A cell that begins with =, +, -,
     @ (or a tab / carriage return) is run as a formula by Excel and LibreOffice,
     so a member who named themselves "=HYPERLINK(...)" would have it execute in
     the accountant's spreadsheet when they open the export. A leading apostrophe
     forces the whole cell to be read as text. */
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** Cents to a plain decimal, no currency symbol — the Currency column says it. */
function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function methodLabel(m: string): string {
  return m === "cash"
    ? "Cash"
    : m === "card_at_desk"
      ? "Card at desk"
      : "Online";
}

/** DD/MM/YYYY in the studio's timezone, the form written on everything in Cyprus. */
function fmtDate(d: Date | null): string {
  if (!d) return "";
  const p = studioParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}
