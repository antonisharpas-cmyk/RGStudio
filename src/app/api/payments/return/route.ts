import { NextResponse } from "next/server";
import { failPurchase, fulfilPurchase, verifyHostedReturn } from "@/lib/payments";
import { siteUrl } from "@/lib/stripe";

/**
 * Where a bank gateway sends the member, and often the browser it is driving,
 * after the card is done.
 *
 * Both GET and POST are accepted because gateways disagree about which they
 * use, and some send both (one to the browser, one server to server).
 *
 * Everything in the request is treated as a claim, not a fact. The signature is
 * checked against our shared secret first; an unsigned or badly signed return
 * grants nothing, whatever it says about itself. Without that check this route
 * would be a URL anyone could type to give themselves free classes.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return handle(Object.fromEntries(url.searchParams));
}

export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  let params: Record<string, string> = {};

  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    params = Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, String(v)]),
    );
  } else {
    const text = await req.text();
    params = Object.fromEntries(new URLSearchParams(text));
  }

  /* A gateway that posts to the return URL usually posts from its own servers,
     so there is no browser to redirect. Answer plainly and let the member's own
     page pick the result up from the database. */
  const result = await handle(params, { redirect: false });
  return result;
}

async function handle(
  params: Record<string, string>,
  opts: { redirect?: boolean } = {},
) {
  const redirect = opts.redirect !== false;
  const checked = verifyHostedReturn(params);

  if (!checked.ok) {
    console.error(`[pay] refused a gateway return: ${checked.reason}`);
    if (!redirect) {
      return NextResponse.json({ error: checked.reason }, { status: 400 });
    }
    return NextResponse.redirect(
      `${siteUrl()}/checkout/cancelled?reason=${checked.reason ?? "REFUSED"}`,
      { status: 303 },
    );
  }

  const purchaseId = checked.purchaseId!;

  if (checked.paid) {
    await fulfilPurchase({ purchaseId, ref: checked.ref });
  } else {
    failPurchase(purchaseId, "gateway reported the payment was not completed");
  }

  if (!redirect) return NextResponse.json({ received: true });

  return NextResponse.redirect(
    checked.paid
      ? `${siteUrl()}/checkout/success?p=${purchaseId}`
      : `${siteUrl()}/checkout/cancelled?p=${purchaseId}`,
    { status: 303 },
  );
}
