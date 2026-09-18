import type { SendResult, Transport } from "./types";

/**
 * SMS, through whichever company the studio signs up with.
 *
 *   SMS_PROVIDER=log        nothing leaves the building (the default)
 *   SMS_PROVIDER=smsto      SMSTO_API_KEY, SMS_SENDER      ← the studio's choice
 *   SMS_PROVIDER=twilio     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *   SMS_PROVIDER=brevo      BREVO_API_KEY, SMS_SENDER
 *
 * Unlike email and push, every one of these costs money per message — a few
 * cents each in Cyprus, so a notice to four hundred members is a real invoice.
 * That is the reason SMS is off by default for members and unticked by default
 * at the desk: it should be a deliberate choice for the messages that warrant
 * it, not the channel everything goes out on.
 *
 * Four providers rather than one because the studio's account is the studio's
 * business, and the day it moves — a price rise, a bad route, an invoice nobody
 * can explain — should be an afternoon's work and one line of configuration, not
 * a rewrite. `log` is the default on purpose: the whole system runs, is testable
 * and costs nothing until somebody deliberately turns it on.
 *
 * Numbers are normalised to E.164 with Cyprus as the assumed country, because
 * that is how members type their number and no gateway accepts "99 123 456".
 */

/**
 * The country code to assume, as **dialling digits** and not as a country.
 *
 * ---
 *
 * **Why this reads the setting instead of trusting it.**
 *
 * `render.yaml` shipped `SMS_DEFAULT_COUNTRY: CY`, which is the obvious thing to
 * write and is not what this is. The value is pasted straight in front of the
 * number, so `CY` turned a member who typed `99649052` into `+CY99649052` —
 * handed to the gateway, refused, and the only evidence anywhere was a failed
 * send in the notices panel. Numbers already stored with a literal `+` were
 * unaffected, so it broke *some* members and not others, which is the hardest
 * version of this bug to notice.
 *
 * `357`, `+357`, `00357` and `CY` are all the answer somebody means, so all four
 * are understood. Anything else is refused rather than concatenated: falling
 * back to Cyprus and saying so in the log is the least wrong thing to do for a
 * studio in Larnaca, and `npm run doctor` reports the bad value so it gets
 * corrected instead of living on.
 */
const CC_BY_ISO: Record<string, string> = {
  CY: "357",
  GR: "30",
  GB: "44",
  UK: "44",
};

export function dialCode(raw = process.env.SMS_DEFAULT_COUNTRY) {
  const given = (raw ?? "").trim();
  if (!given) return { cc: "357", given, ok: true };

  /* Digits, however they were written: 357, +357, 00357. */
  const digits = given.replace(/^\+/, "").replace(/^00/, "");
  if (/^\d{1,4}$/.test(digits)) return { cc: digits, given, ok: true };

  /* A country rather than a code. Understood, because it is what a person
     reasonably writes when the variable is named SMS_DEFAULT_COUNTRY. */
  const iso = CC_BY_ISO[given.toUpperCase()];
  if (iso) return { cc: iso, given, ok: true };

  return { cc: "357", given, ok: false };
}

const resolved = dialCode();
if (!resolved.ok) {
  console.warn(
    `[sms] SMS_DEFAULT_COUNTRY="${resolved.given}" is not a dialling code. ` +
      `Using ${resolved.cc} (Cyprus). Set it to the digits, e.g. 357.`,
  );
}
const DEFAULT_CC = resolved.cc;

/** "+35799123456", or null when it cannot be made into a real number. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits.length >= 8 ? digits : null;
  }
  const bare = digits.replace(/^0+/, "");
  if (bare.length < 6) return null;
  /* Already carries the country code. */
  if (bare.startsWith(DEFAULT_CC)) return `+${bare}`;
  return `+${DEFAULT_CC}${bare}`;
}

const logTransport: Transport = {
  name: "log (nothing is sent)",
  ready: true,
  async send(to, msg) {
    console.log(`[sms:log] → ${to} :: ${msg.body.slice(0, 60)}`);
    return { ok: true, id: "log" };
  },
};

function twilio(sid: string, token: string, from: string): Transport {
  return {
    name: "Twilio",
    ready: true,
    async send(to, msg) {
      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization:
                "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ To: to, From: from, Body: msg.body }),
          },
        );
        if (!res.ok) return { ok: false, error: `twilio ${res.status}: ${await res.text()}` };
        const data = (await res.json()) as { sid?: string };
        return { ok: true, id: data.sid };
      } catch (e) {
        return { ok: false, error: `twilio: ${(e as Error).message}` };
      }
    },
  };
}

function brevoSms(key: string, sender: string): Transport {
  return {
    name: "Brevo SMS",
    ready: true,
    async send(to, msg) {
      try {
        const res = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
          method: "POST",
          headers: { "api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            /* Brevo wants the recipient without the leading plus. */
            recipient: to.replace(/^\+/, ""),
            sender,
            content: msg.body,
            type: "transactional",
          }),
        });
        if (!res.ok) return { ok: false, error: `brevo-sms ${res.status}: ${await res.text()}` };
        const data = (await res.json()) as { messageId?: string | number };
        return { ok: true, id: String(data.messageId ?? "") };
      } catch (e) {
        return { ok: false, error: `brevo-sms: ${(e as Error).message}` };
      }
    },
  };
}

/** Overridable so a test can point it at a server it owns. */
const SMSTO_BASE = process.env.SMSTO_API_BASE ?? "https://api.sms.to";

/**
 * SMS.to — a Cyprus company, so a euro invoice and a Cyprus route.
 *
 * The sender is an alphanumeric ID (`RGPILATES`), not a rented number: it
 * costs nothing, and a name in the inbox beats an unrecognised +357 that reads
 * as spam. The trade is that it is strictly one-way — there is no number for a
 * member to reply to, so "reply STOP" cannot work and the opt-out has to be the
 * switch in their account.
 *
 * Note the sender ID needs whitelisting with SMS.to before the first send. Their
 * documentation says Cyprus requires it; other gateways say it does not. Either
 * way it is a support ticket, and it is better discovered in a quiet week than
 * on opening day — which is why `ready` here means "configured", and the doctor
 * script is what tells you whether it actually works.
 */
function smsTo(key: string, sender: string): Transport {
  return {
    name: "SMS.to",
    ready: true,
    async send(to, msg) {
      try {
        const res = await fetch(`${SMSTO_BASE}/sms/send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to,
            message: msg.body,
            sender_id: sender,
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          return { ok: false, error: `sms.to ${res.status}: ${text.slice(0, 200)}` };
        }
        /* The id field has been spelled a few different ways across their API
           versions, so take whichever is there rather than insisting. A send
           that worked must not be reported as a failure over a missing label. */
        let id: string | undefined;
        try {
          const data = JSON.parse(text) as {
            message_id?: string;
            id?: string;
            success?: boolean;
          };
          id = data.message_id ?? data.id;
        } catch {
          /* Not JSON. It returned 2xx, so it went. */
        }
        return { ok: true, id };
      } catch (e) {
        return { ok: false, error: `sms.to: ${(e as Error).message}` };
      }
    },
  };
}

/**
 * What is left in the account, when the provider will say.
 *
 * Worth having because the failure it prevents is a silent one: credit runs out,
 * every send fails, and nothing on the website looks any different. The endpoint
 * is unverified — it is documented loosely and we have no account yet — so this
 * is written to return `null` rather than to be believed. `npm run doctor`
 * reports what it gets and says plainly when it got nothing.
 */
export async function smsBalance(): Promise<
  { amount: number; currency: string } | null
> {
  const which = (process.env.SMS_PROVIDER ?? "log").toLowerCase();
  const key = process.env.SMSTO_API_KEY;
  if (which !== "smsto" || !key) return null;
  try {
    const res = await fetch(`${SMSTO_BASE}/balance`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      balance?: number | string;
      amount?: number | string;
      currency?: string;
    };
    const raw = data.balance ?? data.amount;
    const amount = typeof raw === "string" ? Number(raw) : raw;
    if (amount === undefined || !Number.isFinite(amount)) return null;
    return { amount, currency: data.currency ?? "EUR" };
  } catch {
    return null;
  }
}

export function smsTransport(): Transport {
  const which = (process.env.SMS_PROVIDER ?? "log").toLowerCase();

  if (which === "smsto") {
    const key = process.env.SMSTO_API_KEY;
    const sender = process.env.SMS_SENDER;
    return key && sender
      ? smsTo(key, sender)
      : { name: "SMS.to (credentials missing)", ready: false, send: notReady };
  }
  if (which === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    return sid && token && from
      ? twilio(sid, token, from)
      : { name: "Twilio (credentials missing)", ready: false, send: notReady };
  }
  if (which === "brevo") {
    const key = process.env.BREVO_API_KEY;
    const sender = process.env.SMS_SENDER;
    return key && sender
      ? brevoSms(key, sender)
      : { name: "Brevo SMS (credentials missing)", ready: false, send: notReady };
  }
  return logTransport;
}

async function notReady(): Promise<SendResult> {
  return { ok: false, error: "NOT_CONFIGURED" };
}
