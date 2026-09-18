import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { Outgoing, SendResult, Transport } from "./types";

/**
 * Email through a mailbox the studio already owns.
 *
 * The other two transports (Resend, Brevo) are companies you sign up with, and
 * they need the sending *domain* verified with DNS records before they will send
 * anything. That is the right answer eventually and the wrong answer on a
 * Tuesday afternoon, because it means editing DNS and waiting.
 *
 * This one needs neither. It signs in to an ordinary mailbox — the same
 * credentials a mail client would use — and hands the message over. Nothing
 * about the domain changes, no records are added, and there is no third company
 * holding a copy of every email the studio sends.
 *
 *   EMAIL_PROVIDER=smtp
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_USER=info@rgpilatesstudio.com
 *   SMTP_PASS=<app password, not the account password>
 *   EMAIL_FROM="RG Pilates Studio <info@rgpilatesstudio.com>"
 *
 * The honest limits, because they decide whether this stays or is replaced:
 *
 *   - A mailbox is not a bulk sender. Google allows roughly 2,000 messages a
 *     day on a Workspace account and throttles bursts, so a one-off announcement
 *     to 400 members is near the edge of what it will tolerate and a mistake
 *     that sends twice is over it. Booking and payment confirmations — a handful
 *     an hour — are comfortably inside it.
 *   - `SMTP_USER` and `EMAIL_FROM` must be the same mailbox. Mail servers refuse
 *     to send as somebody else, which is the one thing standing between all of
 *     us and a world of forged email. An alias the mailbox owns is fine.
 *   - The password must be an **app password**, not the account's own. Google
 *     rejects the real one outright.
 *
 * Written against the protocol rather than a library, so there is nothing to
 * install and nothing to keep up to date. SMTP is a conversation in short lines,
 * and the whole of it is below. Every failure returns the server's own words —
 * `535 Username and Password not accepted` is a far more useful thing to read
 * than "send failed".
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  /**
   * Encrypted from the first byte, rather than starting in the clear and
   * upgrading with STARTTLS. Defaults to true on port 465 and false elsewhere,
   * which is the convention — but it is only a convention, and a mail server on
   * an unusual port is a bad reason to guess wrong, so it can be said outright.
   */
  secure?: boolean;
  /** Only for a mail server with a self-signed certificate. Off by default. */
  insecureTls?: boolean;
};

export function smtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT ?? 465);
  return {
    host,
    port,
    user,
    pass,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE !== "false"
      : port === 465,
    insecureTls: process.env.SMTP_TLS_INSECURE === "1",
  };
}

/* ------------------------------------------------------------------ the wire */

/**
 * One SMTP conversation, kept open only as long as it takes.
 *
 * A connection per message rather than a pool. A studio sends single figures of
 * email a minute, and a pooled connection that has quietly died is a class of
 * bug worth not having for a saving nobody would notice.
 */
class Session {
  private sock: Socket | TLSSocket | null = null;
  private buf = "";
  private waiting: ((line: string) => void) | null = null;
  private failed: ((e: Error) => void) | null = null;
  /**
   * Replies that arrived before anything asked for them.
   *
   * The server speaks first — it sends its 220 greeting the moment the socket
   * opens, which can be before the code that wants to read it has started
   * waiting. Without somewhere to put it, that greeting is dropped and the
   * session then waits twenty seconds for a line that has already been and
   * gone. Every reply is queued instead, so it does not matter which of the two
   * happens first.
   */
  private queued: string[] = [];

  /** Every line in both directions, for the diagnostic when something breaks. */
  readonly log: string[] = [];

  constructor(private cfg: SmtpConfig) {}

  private attach(sock: Socket | TLSSocket) {
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      this.buf += chunk;
      /* One chunk can hold more than one reply, and one reply can span several
         chunks — TCP promises nothing about where the boundaries fall. So drain
         everything complete that is in the buffer, and leave the rest. */
      for (;;) {
        /* A reply can span several lines: "250-STARTTLS" continues, "250 OK"
           ends. Only a space in the fourth column means the server has finished
           talking, so anything else is left in the buffer. */
        const m = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/.exec(this.buf);
        if (!m) return;
        this.take(m[0].length);
      }
    });
    sock.on("error", (e) => {
      const fail = this.failed;
      this.failed = null;
      this.waiting = null;
      fail?.(e);
    });
  }

  /** Hands one complete reply to whoever is waiting, or parks it. */
  private take(length: number) {
    const reply = this.buf.slice(0, length);
    this.buf = this.buf.slice(length);
    for (const l of reply.trimEnd().split(/\r?\n/)) this.log.push(`S: ${l}`);
    const done = this.waiting;
    this.waiting = null;
    if (done) done(reply);
    else this.queued.push(reply);
  }

  /** Waits for the next complete reply, or gives up rather than hanging. */
  private reply(): Promise<string> {
    const already = this.queued.shift();
    if (already !== undefined) return Promise.resolve(already);

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for the mail server")),
        20_000,
      );
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.failed = (e) => {
        clearTimeout(timer);
        reject(e);
      };
    });
  }

  /** Sends a command and returns the reply, refusing anything but the codes given. */
  private async cmd(line: string, expect: number[], redact = false) {
    this.log.push(`C: ${redact ? "<credentials withheld>" : line}`);
    this.sock!.write(line + "\r\n");
    const reply = await this.reply();
    const code = Number(reply.slice(0, 3));
    if (!expect.includes(code)) {
      throw new Error(reply.trimEnd().replace(/\s+/g, " "));
    }
    return reply;
  }

  async open() {
    const { host, port, insecureTls } = this.cfg;
    const implicit = this.cfg.secure ?? port === 465;
    /* The name to check the certificate against. An IP address is not a valid
       one — Node warns about it — and there is nothing to verify anyway. */
    const servername = /^[\d.]+$/.test(host) || host.includes(":") ? undefined : host;

    /* TLS from the first byte, or start in the clear and upgrade below — never
       left there. */
    if (implicit) {
      this.attach(
        await new Promise<TLSSocket>((resolve, reject) => {
          const s = tlsConnect(
            { host, port, servername, rejectUnauthorized: !insecureTls },
            () => resolve(s),
          );
          s.once("error", reject);
        }),
      );
    } else {
      this.attach(
        await new Promise<Socket>((resolve, reject) => {
          const s = netConnect({ host, port }, () => resolve(s));
          s.once("error", reject);
        }),
      );
    }

    await this.reply(); // the 220 greeting
    const me = hostname() || "localhost";
    let greeting = await this.cmd(`EHLO ${me}`, [250]);

    if (!implicit) {
      if (!/STARTTLS/i.test(greeting)) {
        /* Refuse rather than send a password in the clear. A mail server that
           cannot be upgraded is one that should not be given credentials. */
        throw new Error(
          `${host}:${port} does not offer STARTTLS, so the password would travel unencrypted`,
        );
      }
      await this.cmd("STARTTLS", [220]);
      const plain = this.sock as Socket;
      plain.removeAllListeners("data");
      /* Everything said in the clear is discarded with the plaintext socket. A
         reply parked before the upgrade belongs to the old conversation. */
      this.buf = "";
      this.queued = [];
      this.attach(
        await new Promise<TLSSocket>((resolve, reject) => {
          const s = tlsConnect(
            { socket: plain, servername, rejectUnauthorized: !insecureTls },
            () => resolve(s),
          );
          s.once("error", reject);
        }),
      );
      greeting = await this.cmd(`EHLO ${me}`, [250]);
    }

    /* PLAIN is one round trip and LOGIN is three. Either is fine over TLS; the
       choice is whatever the server admits to supporting. */
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
    if (/AUTH[^\n]*PLAIN/i.test(greeting)) {
      await this.cmd(
        `AUTH PLAIN ${b64(`\0${this.cfg.user}\0${this.cfg.pass}`)}`,
        [235],
        true,
      );
    } else if (/AUTH[^\n]*LOGIN/i.test(greeting)) {
      await this.cmd("AUTH LOGIN", [334]);
      await this.cmd(b64(this.cfg.user), [334], true);
      await this.cmd(b64(this.cfg.pass), [235], true);
    } else {
      throw new Error("the mail server does not offer a sign-in method we know");
    }
  }

  async deliver(envelopeFrom: string, to: string, message: string) {
    await this.cmd(`MAIL FROM:<${envelopeFrom}>`, [250]);
    await this.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await this.cmd("DATA", [354]);
    /* A line of exactly "." ends the message, so any real line starting with a
       dot gets a second one. Base64 bodies cannot contain a dot at all, but the
       headers are not base64 and this costs nothing. */
    const body = message.replace(/\r\n\./g, "\r\n..");
    this.log.push(`C: <message, ${Buffer.byteLength(message)} bytes>`);
    this.sock!.write(body + "\r\n.\r\n");
    const reply = await this.reply();
    if (!reply.startsWith("250")) {
      throw new Error(reply.trimEnd().replace(/\s+/g, " "));
    }
    return /\bid=([^\s]+)/i.exec(reply)?.[1] ?? reply.slice(4, 60).trim();
  }

  async close() {
    try {
      if (this.sock && !this.sock.destroyed) {
        this.log.push("C: QUIT");
        this.sock.write("QUIT\r\n");
      }
    } catch {
      /* Saying goodbye politely is not worth an error. */
    }
    this.sock?.destroy();
    this.sock = null;
  }
}

/* --------------------------------------------------------------- the message */

/** `"RG Pilates Studio" <info@…>` split into the bit servers care about. */
export function addressOf(from: string) {
  return /<([^>]+)>/.exec(from)?.[1]?.trim() ?? from.trim();
}

/** A header value with anything but plain ASCII in it has to be encoded. */
function headerValue(s: string) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** Base64 wrapped at 76 characters, as the format requires. */
function base64Lines(s: string) {
  return (Buffer.from(s, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join(
    "\r\n",
  );
}

/**
 * The message itself: the same words twice, once as text and once as the styled
 * version, so a mail client that refuses HTML still shows something a person can
 * read. Both parts are base64 so that Greek text arrives as Greek text.
 *
 * With a file attached the structure gains a layer, because MIME has no way to
 * say "two alternatives and also a PDF" in one part. The whole alternative pair
 * becomes the first part of a `multipart/mixed`, and the files follow it:
 *
 *   multipart/mixed
 *     multipart/alternative      the text and the HTML, as before
 *       text/plain
 *       text/html
 *     application/pdf            the invoice
 *
 * Getting that nesting wrong is what produces the mail everyone has received at
 * some point: a message body that is a wall of base64, or an attachment the
 * reader shows inline as gibberish.
 */
export function buildMessage(args: {
  from: string;
  to: string;
  msg: Outgoing;
  html: string;
  date?: Date;
}) {
  const alt = `rg_alt_${randomBytes(9).toString("hex")}`;
  const mixed = `rg_mix_${randomBytes(9).toString("hex")}`;
  const domain = addressOf(args.from).split("@")[1] ?? "localhost";
  const id = `<${randomBytes(12).toString("hex")}@${domain}>`;
  const files = args.msg.attachments ?? [];

  /* The body pair, which is the whole message when nothing is attached and the
     first part of it when something is. */
  const alternative = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(args.msg.body),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(args.html),
    `--${alt}--`,
  ];

  const headers = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${headerValue(args.msg.subject)}`,
    `Date: ${(args.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${id}`,
    "MIME-Version: 1.0",
  ];

  if (files.length === 0) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      "This message needs a mail reader that understands MIME.",
      "",
      ...alternative,
      "",
    ].join("\r\n");
  }

  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    "This message needs a mail reader that understands MIME.",
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    ...alternative,
  ];

  for (const f of files) {
    parts.push(
      `--${mixed}`,
      `Content-Type: ${f.contentType}; name="${f.filename}"`,
      "Content-Transfer-Encoding: base64",
      /* `attachment` rather than `inline`: an invoice belongs in the paperclip,
         not rendered in the middle of the sentence about expiry dates. */
      `Content-Disposition: attachment; filename="${f.filename}"`,
      "",
      base64Buffer(f.content),
    );
  }

  parts.push(`--${mixed}--`, "");
  return parts.join("\r\n");
}

/** The same 76-character wrapping, for bytes that were never a string. */
function base64Buffer(b: Buffer) {
  return (b.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

/* ------------------------------------------------------------- the transport */

export function smtp(
  cfg: SmtpConfig,
  from: string,
  render: (msg: Outgoing) => string,
): Transport {
  return {
    name: `SMTP (${cfg.host} as ${cfg.user})`,
    ready: true,
    async send(to, msg): Promise<SendResult> {
      const session = new Session(cfg);
      try {
        await session.open();
        const id = await session.deliver(
          addressOf(from),
          to,
          buildMessage({ from, to, msg, html: render(msg) }),
        );
        return { ok: true, id };
      } catch (e) {
        /* The server's own sentence, which usually says exactly what is wrong:
           535 for a bad app password, 550 for sending as the wrong mailbox. */
        return { ok: false, error: `smtp: ${(e as Error).message}` };
      } finally {
        await session.close();
      }
    },
    /** The whole dialogue, for `npm run email:test`. */
    async trace(to, msg) {
      const session = new Session(cfg);
      try {
        await session.open();
        await session.deliver(
          addressOf(from),
          to,
          buildMessage({ from, to, msg, html: render(msg) }),
        );
        return { ok: true, log: session.log };
      } catch (e) {
        return { ok: false, error: (e as Error).message, log: session.log };
      } finally {
        await session.close();
      }
    },
  };
}
