import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  PaymentProvider,
  PaymentRequest,
  PurchaseLike,
  Settlement,
  StartedPayment,
} from "./types";

/**
 * A bank gateway of the "merchant id, endpoint and a signed digest" family —
 * JCC, Viva's hosted page, Trust Payments, most Cypriot and Greek acquirers.
 *
 * They all work the same way and differ only in vocabulary. The member is sent
 * to the gateway's own page with a handful of parameters and a signature over
 * some of them; the gateway takes the card and 3-D Secure; it sends the member
 * back to us with a result and its own signature, which we check before we
 * believe a word of it.
 *
 * Because the vocabulary differs, this adapter is *described* in .env rather
 * than hard-coded. When the studio's provider hands over its integration
 * sheet, filling in the field names and the digest recipe is configuration, not
 * a rewrite. docs/payments.md lists exactly what to ask them for.
 *
 * Nothing here guesses. If the configuration is incomplete the provider
 * reports itself as not configured and the app falls back rather than sending a
 * half-formed request to somebody's bank.
 */

type Algo =
  | "hmac-sha256-hex"
  | "hmac-sha256-base64"
  | "hmac-sha1-hex"
  | "sha256-hex"
  | "sha1-hex"
  | "md5-hex";

const ALGOS: Algo[] = [
  "hmac-sha256-hex",
  "hmac-sha256-base64",
  "hmac-sha1-hex",
  "sha256-hex",
  "sha1-hex",
  "md5-hex",
];

/** The five things we always need to send, whatever the provider calls them. */
type FieldMap = {
  merchant?: string;
  order?: string;
  amount?: string;
  currency?: string;
  return?: string;
  cancel?: string;
  description?: string;
  email?: string;
};

export type HostedConfig = {
  label: string;
  endpoint: string;
  method: "GET" | "POST";
  merchantId: string;
  secret: string;
  fields: FieldMap;
  /** Most bank gateways want "12.34"; some want minor units. */
  amountFormat: "decimal" | "cents";
  /** "EUR" or the ISO number "978" — the sheet will say which. */
  currencyCode: string;
  signature: {
    field: string;
    /** Which values go into the digest, in the provider's stated order. */
    order: (keyof FieldMap)[];
    algo: Algo;
    /** Some gateways join with a separator or wrap in the secret. */
    separator: string;
  } | null;
  /** Optional server-to-server status check, which is always preferable. */
  verify: {
    url: string;
    method: "GET" | "POST";
    orderField: string;
    statusField: string;
    paidValues: string[];
  } | null;
  /** Field names on the way back. */
  callback: {
    orderField: string;
    statusField: string;
    paidValues: string[];
    refField: string | null;
    signatureField: string | null;
  };
};

function env(name: string) {
  const v = process.env[name]?.trim();
  return v && v.length && !/^x{3,}$/i.test(v) ? v : null;
}

/** `merchant:MerchantID,order:Order,amount:Amount` -> { merchant: "MerchantID", … } */
function parseMap(raw: string | null): FieldMap {
  const out: FieldMap = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const [ours, theirs] = pair.split(":").map((s) => s.trim());
    if (ours && theirs && ours in EMPTY_MAP) {
      out[ours as keyof FieldMap] = theirs;
    }
  }
  return out;
}

const EMPTY_MAP: Record<keyof FieldMap, true> = {
  merchant: true,
  order: true,
  amount: true,
  currency: true,
  return: true,
  cancel: true,
  description: true,
  email: true,
};

export function hostedConfig(): HostedConfig | null {
  const endpoint = env("HOSTED_PAY_ENDPOINT");
  const merchantId = env("HOSTED_PAY_MERCHANT_ID");
  const secret = env("HOSTED_PAY_SECRET");
  const fields = parseMap(env("HOSTED_PAY_FIELDS"));

  /* The minimum that makes a redirect meaningful. Without these there is
     nothing to send and nothing to check, so the provider stays switched off
     rather than half-working. */
  if (!endpoint || !merchantId || !fields.order || !fields.amount) return null;

  const algo = (env("HOSTED_PAY_SIGNATURE_ALGO") ?? "hmac-sha256-hex") as Algo;
  const sigField = env("HOSTED_PAY_SIGNATURE_FIELD");
  const sigOrder = (env("HOSTED_PAY_SIGNATURE_ORDER") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is keyof FieldMap => s in EMPTY_MAP);

  return {
    label: env("HOSTED_PAY_LABEL") ?? "our payment provider",
    endpoint,
    method: (env("HOSTED_PAY_METHOD") ?? "GET") === "POST" ? "POST" : "GET",
    merchantId,
    secret: secret ?? "",
    fields,
    amountFormat: env("HOSTED_PAY_AMOUNT_FORMAT") === "cents" ? "cents" : "decimal",
    currencyCode: env("HOSTED_PAY_CURRENCY_CODE") ?? "EUR",
    signature:
      sigField && secret && sigOrder.length && ALGOS.includes(algo)
        ? {
            field: sigField,
            order: sigOrder,
            algo,
            separator: process.env.HOSTED_PAY_SIGNATURE_SEPARATOR ?? "",
          }
        : null,
    verify:
      env("HOSTED_PAY_VERIFY_URL") && env("HOSTED_PAY_VERIFY_ORDER_FIELD")
        ? {
            url: env("HOSTED_PAY_VERIFY_URL")!,
            method:
              (env("HOSTED_PAY_VERIFY_METHOD") ?? "GET") === "POST" ? "POST" : "GET",
            orderField: env("HOSTED_PAY_VERIFY_ORDER_FIELD")!,
            statusField: env("HOSTED_PAY_VERIFY_STATUS_FIELD") ?? "status",
            paidValues: (env("HOSTED_PAY_VERIFY_PAID_VALUES") ?? "PAID,APPROVED,00,0")
              .split(",")
              .map((s) => s.trim().toUpperCase()),
          }
        : null,
    callback: {
      orderField: env("HOSTED_PAY_CALLBACK_ORDER_FIELD") ?? fields.order,
      statusField: env("HOSTED_PAY_CALLBACK_STATUS_FIELD") ?? "status",
      paidValues: (env("HOSTED_PAY_CALLBACK_PAID_VALUES") ?? "PAID,APPROVED,00,0")
        .split(",")
        .map((s) => s.trim().toUpperCase()),
      refField: env("HOSTED_PAY_CALLBACK_REF_FIELD"),
      signatureField: env("HOSTED_PAY_CALLBACK_SIGNATURE_FIELD") ?? sigField,
    },
  };
}

function digest(algo: Algo, secret: string, payload: string) {
  switch (algo) {
    case "hmac-sha256-hex":
      return createHmac("sha256", secret).update(payload).digest("hex");
    case "hmac-sha256-base64":
      return createHmac("sha256", secret).update(payload).digest("base64");
    case "hmac-sha1-hex":
      return createHmac("sha1", secret).update(payload).digest("hex");
    case "sha256-hex":
      return createHash("sha256").update(payload + secret).digest("hex");
    case "sha1-hex":
      return createHash("sha1").update(payload + secret).digest("hex");
    case "md5-hex":
      return createHash("md5").update(payload + secret).digest("hex");
  }
}

function amountFor(cfg: HostedConfig, cents: number) {
  return cfg.amountFormat === "cents" ? String(cents) : (cents / 100).toFixed(2);
}

export const hostedProvider: PaymentProvider = {
  id: "hosted",
  get label() {
    return hostedConfig()?.label ?? "our payment provider";
  },

  configured: () => hostedConfig() !== null,

  async start(req: PaymentRequest): Promise<StartedPayment> {
    const cfg = hostedConfig();
    if (!cfg) throw new Error("HOSTED_PAY_NOT_CONFIGURED");

    /* Our own order reference is the purchase id. It is what comes back, and
       it is what fulfilment is keyed on, so the two can never drift. */
    const values: Partial<Record<keyof FieldMap, string>> = {
      merchant: cfg.merchantId,
      order: req.purchaseId,
      amount: amountFor(cfg, req.amountCents),
      currency: cfg.currencyCode,
      return: req.returnUrl,
      cancel: req.cancelUrl,
      description: `RG Pilates Studio ${req.packName}`,
      email: req.email,
    };

    const params = new URLSearchParams();
    for (const [ours, theirs] of Object.entries(cfg.fields)) {
      const v = values[ours as keyof FieldMap];
      if (theirs && v !== undefined) params.set(theirs, v);
    }

    if (cfg.signature) {
      const payload = cfg.signature.order
        .map((k) => values[k] ?? "")
        .join(cfg.signature.separator);
      params.set(
        cfg.signature.field,
        digest(cfg.signature.algo, cfg.secret, payload),
      );
    }

    /* GET is a plain redirect. A POST gateway is handed to the browser as a
       hidden self-submitting form, so its parameters stay out of the address
       bar and out of the referrer header. */
    if (cfg.method === "POST") {
      return {
        mode: "redirect",
        provider: "hosted",
        url: cfg.endpoint,
        ref: null,
        post: { action: cfg.endpoint, fields: Object.fromEntries(params) },
      };
    }

    return {
      mode: "redirect",
      provider: "hosted",
      url: `${cfg.endpoint}${cfg.endpoint.includes("?") ? "&" : "?"}${params}`,
      ref: null,
    };
  },

  async settle(purchase: PurchaseLike): Promise<Settlement> {
    const cfg = hostedConfig();
    if (!cfg) return { status: "PENDING", ref: null };

    /* No status endpoint on the sheet: the signed return is all we have, and
       that is handled where it arrives. Reporting PENDING here is honest —
       this function must never claim a payment it has not seen. */
    if (!cfg.verify) return { status: "PENDING", ref: purchase.providerRef };

    const body = new URLSearchParams({ [cfg.verify.orderField]: purchase.id });
    if (cfg.fields.merchant) body.set(cfg.fields.merchant, cfg.merchantId);

    try {
      const res =
        cfg.verify.method === "GET"
          ? await fetch(`${cfg.verify.url}?${body}`, { cache: "no-store" })
          : await fetch(cfg.verify.url, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body,
              cache: "no-store",
            });

      if (!res.ok) return { status: "PENDING", ref: purchase.providerRef };

      const text = await res.text();
      const data = safeJson(text) ?? formToObject(text);
      const status = String(data[cfg.verify.statusField] ?? "").toUpperCase();

      if (cfg.verify.paidValues.includes(status)) {
        return {
          status: "PAID",
          ref: String(data[cfg.callback.refField ?? ""] ?? purchase.id),
          amountCents: null,
        };
      }
      return { status: "PENDING", ref: purchase.providerRef };
    } catch (err) {
      console.error("[pay] hosted status check failed", err);
      return { status: "PENDING", ref: purchase.providerRef };
    }
  },
};

/**
 * Checks the gateway's signature on the way back.
 *
 * A return URL is just a URL: anyone can type it with `status=PAID` in it. This
 * is the difference between a payment page and a way to give yourself free
 * classes, so an unsigned or wrongly signed return is refused outright.
 */
export function verifyHostedReturn(params: Record<string, string>): {
  ok: boolean;
  purchaseId: string | null;
  paid: boolean;
  ref: string | null;
  reason?: string;
} {
  const cfg = hostedConfig();
  if (!cfg) return { ok: false, purchaseId: null, paid: false, ref: null, reason: "NOT_CONFIGURED" };

  const purchaseId = params[cfg.callback.orderField] ?? null;
  const status = String(params[cfg.callback.statusField] ?? "").toUpperCase();
  const ref = cfg.callback.refField ? (params[cfg.callback.refField] ?? null) : null;

  if (!purchaseId) {
    return { ok: false, purchaseId: null, paid: false, ref, reason: "NO_ORDER" };
  }

  if (cfg.signature && cfg.callback.signatureField) {
    const given = params[cfg.callback.signatureField] ?? "";
    const payload = cfg.signature.order
      .map((k) => {
        const theirs = cfg.fields[k];
        return theirs ? (params[theirs] ?? "") : "";
      })
      .join(cfg.signature.separator);
    const expected = digest(cfg.signature.algo, cfg.secret, payload);
    if (!equal(given, expected)) {
      return { ok: false, purchaseId, paid: false, ref, reason: "BAD_SIGNATURE" };
    }
  } else {
    /* Loud, because it is the one thing that must not be left unfinished. */
    console.error(
      "[pay] hosted return accepted without a signature check — set HOSTED_PAY_SIGNATURE_* before going live",
    );
    return { ok: false, purchaseId, paid: false, ref, reason: "NO_SIGNATURE_CONFIG" };
  }

  return {
    ok: true,
    purchaseId,
    paid: cfg.callback.paidValues.includes(status),
    ref,
  };
}

function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function formToObject(text: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(text));
}
