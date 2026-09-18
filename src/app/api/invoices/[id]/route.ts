import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { invoiceForPurchase } from "@/lib/invoice-for";

/**
 * One member's invoice, as a PDF.
 *
 * It is emailed as an attachment when the payment goes through, which is where
 * most people will get it. This is for the other times: the email was deleted,
 * it went to spam, the accountant wants it in March, or somebody at the desk is
 * asked for a copy over the counter.
 *
 * ---
 *
 * **Who is allowed to see it.**
 *
 * The member it belongs to, and staff. Nobody else, and the check is on the
 * purchase's own owner rather than on anything in the URL — an invoice id is a
 * UUID and unguessable, but "unguessable" is not a permission model, and a
 * member forwarding a link to a friend should not hand over their own payment
 * history along with it.
 *
 * Staff are included deliberately: reception is asked for copies of receipts,
 * and the alternative is a member being told to go home and find an email.
 *
 * ---
 *
 * `Cache-Control: private, no-store`. This is somebody's financial record: it
 * must not sit in a shared cache, and the broad caching rule in next.config.ts
 * excludes `/api/` precisely so that a header like this one is not overwritten
 * by it — a lesson from the avatar route, which was made public by exactly that
 * mistake.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const invoice = await invoiceForPurchase(id);
  /* 404 rather than 400 for a purchase that is not paid: as far as anybody
     asking is concerned there is no such document yet. */
  if (!invoice) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const staff = user.role === "STAFF" || user.role === "ADMIN";
  if (invoice.userId !== user.id && !staff) {
    /* Deliberately 404 and not 403. A member probing other ids should not be
       able to learn which of them exist. */
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(invoice.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      /* `inline` so it opens in the browser's own viewer, which is what
         somebody clicking "Invoice" expects — they can still save it from
         there, and a forced download for a document you wanted to glance at is
         a small rudeness. */
      "Content-Disposition": `inline; filename="${invoice.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
