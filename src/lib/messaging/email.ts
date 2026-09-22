import { smtp, smtpConfigFromEnv } from "./smtp";
import { LANGUAGE_RULE } from "./wording";
import type { Outgoing, SendResult, Transport } from "./types";

/**
 * Email, by one of three routes.
 *
 *   EMAIL_PROVIDER=log       nothing leaves the building (the default)
 *   EMAIL_PROVIDER=smtp      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   EMAIL_PROVIDER=resend    RESEND_API_KEY
 *   EMAIL_PROVIDER=brevo     BREVO_API_KEY
 *   EMAIL_FROM="RG Pilates Studio <info@rgpilatesstudio.com>"
 *
 * The difference that matters is what each one asks of you before it will send.
 *
 * `smtp` signs in to a mailbox that already exists and sends as it. Nothing
 * about the domain changes, no DNS records are added, and it works in the ten
 * minutes it takes to create an app password. It is not a bulk sender — see
 * smtp.ts for the limits — so it suits confirmations well and a 400-member
 * announcement barely.
 *
 * `resend` and `brevo` are companies you sign up with, and each needs the
 * sending *domain* verified with DNS records first. That is more setup and the
 * better answer once the studio has its own domain: they are built to send
 * thousands, they report bounces, and they do not throttle. Brevo is here as
 * well as Resend because it also sends SMS, and one account for both is one less
 * thing for the studio to manage.
 *
 * With the domain unverified, mail either bounces or lands in spam, which is
 * worse than not sending it: the studio would believe forty people had been told
 * about a cancelled class. That is the trap `smtp` sidesteps — a mailbox's own
 * domain is already trusted to send its own mail.
 */

const FROM =
  process.env.EMAIL_FROM ?? "RG Pilates Studio <info@rgpilatesstudio.com>";

/** The plain-text body wrapped in something that does not look like a robot. */
function html(msg: Outgoing) {
  const paragraphs = msg.body
    .split(/\n{2,}/)
    .map((p) => {
      /* The marker between the English and the Greek. In plain text it has to
         be characters; here it can be an actual line, which is what it means. */
      if (p.trim() === LANGUAGE_RULE) {
        return '<hr style="border:none;border-top:1px solid #e7dcd3;margin:26px 0">';
      }
      /* A bare https address becomes a link, so the password reset email is
         one tap on a phone. Escaped first, so the address can carry nothing
         but itself. */
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a3a39">${escape(
        p,
      )
        .replace(
          /(https?:\/\/[^\s<]+)/g,
          '<a href="$1" style="color:#3b2d2c;text-decoration:underline">$1</a>',
        )
        .replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#FBF7F2;padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:18px;padding:36px 32px">
      <tr><td>
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#8f857d">RG Pilates Studio</p>
        <h1 style="margin:0 0 22px;font-size:22px;font-weight:400;color:#3b2d2c">${escape(msg.subject)}</h1>
        ${paragraphs}
        <p style="margin:28px 0 0;font-size:12px;color:#8f857d">
          Patron 30, Larnaca 6051, Cyprus
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const logTransport: Transport = {
  name: "log (nothing is sent)",
  ready: true,
  async send(to, msg) {
    /* Names the attachments as well as the subject. A test run that silently
       drops an invoice looks exactly like one that never made an invoice, and
       the whole point of this transport is that the pipeline can be read. */
    const files = (msg.attachments ?? [])
      .map((a) => `${a.filename} (${a.content.length}b)`)
      .join(", ");
    console.log(
      `[email:log] → ${to} :: ${msg.subject}${files ? ` + ${files}` : ""}`,
    );
    return { ok: true, id: "log" };
  },
};

function resend(key: string): Transport {
  return {
    name: "Resend",
    ready: true,
    async send(to, msg) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM,
            to: [to],
            subject: msg.subject,
            text: msg.body,
            html: html(msg),
            /* Resend takes base64 in `content`. Omitted entirely when there is
               nothing to send, rather than passed as an empty array, because an
               empty array is a thing some APIs object to. */
            ...(msg.attachments?.length
              ? {
                  attachments: msg.attachments.map((a) => ({
                    filename: a.filename,
                    content: a.content.toString("base64"),
                    content_type: a.contentType,
                  })),
                }
              : {}),
          }),
        });
        if (!res.ok) return { ok: false, error: `resend ${res.status}: ${await res.text()}` };
        const data = (await res.json()) as { id?: string };
        return { ok: true, id: data.id };
      } catch (e) {
        return { ok: false, error: `resend: ${(e as Error).message}` };
      }
    },
  };
}

function brevo(key: string): Transport {
  /* Brevo wants the sender split into name and address. */
  const m = /^\s*(.*?)\s*<(.+)>\s*$/.exec(FROM);
  const sender = m ? { name: m[1], email: m[2] } : { email: FROM };

  return {
    name: "Brevo",
    ready: true,
    async send(to, msg) {
      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender,
            to: [{ email: to }],
            subject: msg.subject,
            textContent: msg.body,
            htmlContent: html(msg),
            /* Brevo calls the field `attachment`, singular, and wants `name`
               where Resend wants `filename`. One of the small ways these APIs
               differ, and the reason this adapter exists at all. */
            ...(msg.attachments?.length
              ? {
                  attachment: msg.attachments.map((a) => ({
                    name: a.filename,
                    content: a.content.toString("base64"),
                  })),
                }
              : {}),
          }),
        });
        if (!res.ok) return { ok: false, error: `brevo ${res.status}: ${await res.text()}` };
        const data = (await res.json()) as { messageId?: string };
        return { ok: true, id: data.messageId };
      } catch (e) {
        return { ok: false, error: `brevo: ${(e as Error).message}` };
      }
    },
  };
}

export function emailTransport(): Transport {
  const which = (process.env.EMAIL_PROVIDER ?? "log").toLowerCase();

  if (which === "smtp") {
    const cfg = smtpConfigFromEnv();
    return cfg
      ? smtp(cfg, FROM, html)
      : {
          name: "SMTP (missing SMTP_HOST, SMTP_USER or SMTP_PASS)",
          ready: false,
          send: notReady,
        };
  }
  if (which === "resend") {
    const key = process.env.RESEND_API_KEY;
    return key
      ? resend(key)
      : { name: "Resend (no RESEND_API_KEY)", ready: false, send: notReady };
  }
  if (which === "brevo") {
    const key = process.env.BREVO_API_KEY;
    return key
      ? brevo(key)
      : { name: "Brevo (no BREVO_API_KEY)", ready: false, send: notReady };
  }
  return logTransport;
}

async function notReady(): Promise<SendResult> {
  return { ok: false, error: "NOT_CONFIGURED" };
}
