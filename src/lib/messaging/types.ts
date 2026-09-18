/**
 * Getting a message out of the building.
 *
 * Three channels, one shape. The studio has not chosen an email or SMS company
 * yet and may change its mind later, so nothing above this file knows which one
 * is in use — the same way payments work. Adding a provider means adding an
 * adapter here, not editing the notice screen.
 *
 * Every provider also has a `log` mode that records what *would* have been sent
 * without sending it. That is not a stub to be replaced later: it is how the
 * whole pipeline is tested, and how the studio can rehearse a message before
 * real money and real phones are involved.
 */

export type Channel = "push" | "email" | "sms";

/**
 * A file travelling with an email.
 *
 * Only email carries these; a push notification and a text message have nowhere
 * to put one, and ignore the field the same way email ignores `url`.
 */
export type Attachment = {
  /** What it is called when it lands on somebody's desktop. */
  filename: string;
  content: Buffer;
  /** e.g. "application/pdf". Guessed by nobody: say what it is. */
  contentType: string;
};

/** One message, already in the recipient's language. */
export type Outgoing = {
  subject: string;
  body: string;
  /** Where a push notification should open. Ignored by email and SMS. */
  url?: string;
  /**
   * Files to send with it. Email only.
   *
   * Here rather than as a fourth argument to `send` because every transport
   * already receives this object and passes it whole — adding a parameter would
   * have meant touching four adapters and every call site to thread through
   * something three of them ignore. A transport that cannot attach a file
   * simply does not read this, exactly as the SMS transports do not read `url`.
   */
  attachments?: Attachment[];
};

export type SendResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; /** The endpoint is gone: stop using it. */ gone?: boolean };

export type Transport = {
  /** For the desk: which company is doing the sending, or "not configured". */
  name: string;
  /** False when the environment has no credentials, so the UI can say so. */
  ready: boolean;
  send(to: string, msg: Outgoing): Promise<SendResult>;
  /**
   * Optional: the same send, but reporting every step.
   *
   * Only `npm run email:test` calls this. A transport that talks a conversation
   * rather than making one request can say which line the server objected to,
   * and "535 Username and Password not accepted" is worth a hundred retries of
   * "sending failed". Providers that are a single HTTPS call have nothing extra
   * to tell, so they leave it out.
   */
  trace?(
    to: string,
    msg: Outgoing,
  ): Promise<{ ok: boolean; error?: string; log: string[] }>;
};

/** What one channel did with one notice. */
export type ChannelReport = {
  channel: Channel;
  sent: number;
  failed: number;
  /** Recipients this channel did not apply to: no consent, no phone, no device. */
  skipped: number;
  errors: string[];
  /**
   * SMS only: how many billable segments each message became, and which
   * alphabet forced it. `sent` counts people; the invoice counts people times
   * segments, and those are different numbers the moment Greek is involved.
   */
  segments?: number;
  encoding?: "gsm7" | "unicode";
};

export const CHANNELS: Channel[] = ["push", "email", "sms"];

/** Trims a body to something an SMS will not be silently cut in half by. */
export function smsLength(body: string) {
  /* Anything outside GSM-7 pushes the whole message into UCS-2, where a single
     SMS holds 70 characters instead of 160. Greek text does exactly that, which
     is why the desk is shown the count rather than left to guess. */
  const unicode = /[^\r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]/.test(
    body,
  );
  const per = unicode ? 70 : 160;
  return { unicode, per, parts: Math.max(1, Math.ceil(body.length / per)) };
}
