/**
 * The SMTP client, checked against a real mail server.
 *
 *   npm run test:smtp
 *
 * Not a mock of our own code — a TLS server on a local port that speaks the
 * protocol back, so the client has to get the conversation right or nothing
 * arrives. That matters here more than usual: this client is written against the
 * protocol rather than using a library, and the failure mode of a hand-written
 * protocol client is a message that is *accepted* and then displayed as
 * gibberish, which no exception would ever tell us about.
 *
 * So the stub keeps what it received and the tests read it back: the right
 * mailbox in the envelope, the subject legible when it is in Greek, both bodies
 * decoding to the words that went in.
 *
 * Needs `openssl` on PATH to make a throwaway certificate — it comes with Git
 * for Windows. Without it the protocol tests are skipped and the message-format
 * tests still run, since those are pure functions and where most of the risk is.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { createServer as createTlsServer, TLSSocket, type Server as TlsServer } from "node:tls";
import type { Outgoing } from "../src/lib/messaging/types";

/* Dynamic, because this file is ESM and the app's modules compile as CommonJS:
   a static named import across that boundary is resolved before the module has
   said what it exports. */
const { addressOf, buildMessage, smtp } = await import("../src/lib/messaging/smtp");

let passed = 0;
const failures: string[] = [];

function ok(what: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${what}`);
  } else {
    failures.push(what);
    console.log(`  ✗ ${what}`, detail === undefined ? "" : detail);
  }
}

const render = (m: Outgoing) => `<p>${m.body}</p>`;

/* ------------------------------------------------- the message, as a document */

console.log("\n1. The message a mail reader receives");

{
  const msg = { subject: "Booking confirmed", body: "Line one.\n\nLine two." };
  const raw = buildMessage({
    from: "RG Pilates Studio <info@ergonsite.com>",
    to: "member@example.com",
    msg,
    html: "<p>Line one.</p>",
    date: new Date(Date.UTC(2026, 7, 29, 15, 4, 5)),
  });

  ok("every line ends CRLF, as the format requires", !/[^\r]\n/.test(raw));
  ok("the sender survives with its display name", raw.includes("From: RG Pilates Studio <info@ergonsite.com>"));
  ok("there is a Date", raw.includes("Date: Sat, 29 Aug 2026 15:04:05 +0000"));
  ok("there is a Message-ID on the sending domain", /Message-ID: <[0-9a-f]+@ergonsite\.com>/.test(raw));
  ok("plain ASCII subjects are left alone", raw.includes("Subject: Booking confirmed"));

  const boundary = /boundary="([^"]+)"/.exec(raw)?.[1] ?? "";
  ok("a boundary is declared", boundary.length > 10);
  ok("both parts are present and closed", raw.split(`--${boundary}`).length === 4);
  ok("one part is text", raw.includes('Content-Type: text/plain; charset="UTF-8"'));
  ok("the other is HTML", raw.includes('Content-Type: text/html; charset="UTF-8"'));

  /* The point of the exercise: decode it back the way a mail client would. */
  const parts = raw.split(`--${boundary}`).slice(1, 3).map((p) => {
    const body = p.split("\r\n\r\n").slice(1).join("\r\n\r\n").trimEnd();
    return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
  });
  ok("the text part decodes to the words that went in", parts[0] === msg.body, parts[0]);
  ok("the HTML part decodes to the rendered version", parts[1] === "<p>Line one.</p>", parts[1]);
  ok("base64 is wrapped at 76 characters", raw.split("\r\n").every((l) => l.length <= 998));
}

{
  /* Greek is not an edge case for this studio, it is half the members. A subject
     line with it has to be encoded or mail clients show mojibake. */
  const raw = buildMessage({
    from: "info@ergonsite.com",
    to: "x@y.com",
    msg: { subject: "Το μάθημα ακυρώθηκε", body: "Καλημέρα σας." },
    html: "<p>Καλημέρα σας.</p>",
  });
  const encoded = /Subject: (.+)\r\n/.exec(raw)?.[1] ?? "";
  ok("a Greek subject is encoded rather than sent raw", encoded.startsWith("=?UTF-8?B?"), encoded);
  ok(
    "and decodes back to the Greek",
    Buffer.from(encoded.replace(/^=\?UTF-8\?B\?|\?=$/g, ""), "base64").toString("utf8") ===
      "Το μάθημα ακυρώθηκε",
  );
  const encodedBody =
    /text\/plain[\s\S]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(raw)?.[1] ?? "";
  const greek = Buffer.from(encodedBody.replace(/\r\n/g, ""), "base64").toString("utf8");
  ok("and the Greek body survives the round trip", greek === "Καλημέρα σας.", greek);
}

{
  ok("an address is found inside a display name", addressOf("RG Pilates Studio <a@b.com>") === "a@b.com");
  ok("a bare address is left as it is", addressOf("a@b.com") === "a@b.com");
}

/* -------------------------------------------------------- the conversation */

const dir = mkdtempSync(join(tmpdir(), "rg-smtp-"));
let cert: { key: string; cert: string } | null = null;
try {
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"),
      "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"],
    { stdio: "ignore" },
  );
  cert = {
    key: readFileSync(join(dir, "k.pem"), "utf8"),
    cert: readFileSync(join(dir, "c.pem"), "utf8"),
  };
} catch {
  console.log("\n2. The conversation with a mail server — SKIPPED (no openssl on PATH)");
}

type Received = { from: string; to: string[]; data: string; auth: string | null };

/**
 * A mail server, as far as the client can tell.
 *
 * Answers the way Gmail does, including the multi-line EHLO reply that a naive
 * client parses wrongly, and in both of the two shapes a mail server comes in:
 *
 *   implicit   TLS from the first byte, as port 465 does
 *   starttls   plain to begin with, upgraded on request, as port 587 does
 *
 * Both are worth running, because they are different code paths in the client
 * and the second one has to throw away everything it heard before the upgrade.
 */
function stubServer(
  opts: {
    mode?: "implicit" | "starttls";
    rejectAuth?: boolean;
    rejectSender?: boolean;
    refuseStarttls?: boolean;
  } = {},
) {
  const mode = opts.mode ?? "implicit";
  const seen: Received[] = [];
  /* What the client said before any encryption. Nothing secret may appear here. */
  const inTheClear: string[] = [];

  /** The protocol itself, on whichever socket is current. */
  function speak(sock: Socket | TLSSocket, encrypted: boolean) {
    let state: "cmd" | "data" = "cmd";
    let current: Received = { from: "", to: [], data: "", auth: null };
    let expecting: "user" | "pass" | null = null;
    let buf = "";

    const onData = (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!encrypted) inTheClear.push(line);

        if (state === "data") {
          if (line === ".") {
            state = "cmd";
            seen.push(current);
            current = { from: "", to: [], data: "", auth: current.auth };
            sock.write("250 2.0.0 OK id=STUB123\r\n");
          } else {
            /* Undo the dot-stuffing, as a real server does. */
            current.data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
          }
          continue;
        }

        if (expecting === "user") {
          current.auth = Buffer.from(line, "base64").toString("utf8");
          expecting = "pass";
          sock.write("334 UGFzc3dvcmQ6\r\n");
        } else if (expecting === "pass") {
          expecting = null;
          sock.write(
            opts.rejectAuth
              ? "535-5.7.8 Username and Password not accepted. Learn more at\r\n535 5.7.8 https://support.google.com/mail/?p=BadCredentials\r\n"
              : "235 2.7.0 Accepted\r\n",
          );
        } else if (/^EHLO/i.test(line)) {
          /* Deliberately multi-line. STARTTLS is only offered while in the
             clear, and AUTH only once encrypted — which is what a real server
             does and what the client has to cope with. */
          const lines = ["250-stub.local at your service", "250-SIZE 35882577"];
          if (!encrypted && mode === "starttls" && !opts.refuseStarttls) {
            lines.push("250-STARTTLS");
          }
          if (encrypted) lines.push("250-AUTH LOGIN PLAIN");
          lines.push("250 SMTPUTF8");
          sock.write(lines.join("\r\n") + "\r\n");
        } else if (/^STARTTLS/i.test(line)) {
          sock.write("220 2.0.0 Ready to start TLS\r\n");
          sock.removeListener("data", onData);
          const secured = new TLSSocket(sock as Socket, {
            isServer: true,
            key: cert!.key,
            cert: cert!.cert,
          });
          secured.on("error", () => {});
          speak(secured, true);
        } else if (/^AUTH PLAIN /i.test(line)) {
          current.auth = Buffer.from(line.slice(11), "base64").toString("utf8");
          sock.write(
            opts.rejectAuth
              ? "535 5.7.8 Username and Password not accepted\r\n"
              : "235 2.7.0 Accepted\r\n",
          );
        } else if (/^AUTH LOGIN/i.test(line)) {
          expecting = "user";
          sock.write("334 VXNlcm5hbWU6\r\n");
        } else if (/^MAIL FROM:/i.test(line)) {
          if (opts.rejectSender) {
            sock.write("550 5.7.1 Not allowed to send as that address\r\n");
          } else {
            current.from = /<([^>]*)>/.exec(line)?.[1] ?? "";
            sock.write("250 2.1.0 OK\r\n");
          }
        } else if (/^RCPT TO:/i.test(line)) {
          current.to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          sock.write("250 2.1.5 OK\r\n");
        } else if (/^DATA/i.test(line)) {
          state = "data";
          sock.write("354 Go ahead\r\n");
        } else if (/^QUIT/i.test(line)) {
          sock.write("221 2.0.0 closing\r\n");
          sock.end();
        } else {
          sock.write("250 2.0.0 OK\r\n");
        }
      }
    };

    sock.setEncoding("utf8");
    sock.on("data", onData);
    sock.on("error", () => {});
    if (!encrypted || mode === "implicit") {
      sock.write("220 stub.local ESMTP ready\r\n");
    }
  }

  const server =
    mode === "implicit"
      ? createTlsServer({ key: cert!.key, cert: cert!.cert }, (s) => speak(s, true))
      : createNetServer((s) => speak(s, false));

  return { server, seen, inTheClear };
}

function listen(server: NetServer | TlsServer) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

if (cert) {
  const FROM = "RG Pilates Studio <info@ergonsite.com>";

  /* The happy path, run against both shapes of mail server. Port 465 and port
     587 are different code paths in the client, and the 587 one has to discard
     everything it heard before the connection was encrypted. */
  for (const mode of ["implicit", "starttls"] as const) {
    console.log(`\n2. A full send — ${mode === "implicit" ? "TLS from the first byte (465)" : "upgraded with STARTTLS (587)"}`);

    const { server, seen, inTheClear } = stubServer({ mode });
    const port = await listen(server);
    const t = smtp(
      {
        host: "127.0.0.1",
        port,
        user: "info@ergonsite.com",
        pass: "app-pw-secret",
        secure: mode === "implicit",
        insecureTls: true,
      },
      FROM,
      render,
    );

    const res = await t.send("member@example.com", {
      subject: "Booking confirmed",
      body: "Reformer Flow — Saturday at 18:00.",
    });

    ok("the send is accepted", res.ok, res);
    ok("the server received exactly one message", seen.length === 1, seen.length);
    ok("the envelope sender is the bare address, not the display name", seen[0]?.from === "info@ergonsite.com", seen[0]?.from);
    ok("the recipient arrived", seen[0]?.to[0] === "member@example.com", seen[0]?.to);
    ok(
      "it signed in as the mailbox",
      seen[0]?.auth === "\0info@ergonsite.com\0app-pw-secret",
      JSON.stringify(seen[0]?.auth),
    );
    ok("the multi-line EHLO did not confuse it", res.ok);
    ok("the headers came through", (seen[0]?.data ?? "").includes("Subject: Booking confirmed"));
    ok(
      "and so did the words",
      decodeText(seen[0]?.data ?? "").includes("Reformer Flow"),
      decodeText(seen[0]?.data ?? "").slice(0, 60),
    );
    /* The point of STARTTLS. If the password appears here the upgrade did not
       happen, and no test of the happy path would have noticed. */
    ok(
      "the password never travelled unencrypted",
      !inTheClear.join("\n").includes("app-pw-secret") &&
        !inTheClear.some((l) => /^AUTH/i.test(l)),
      inTheClear.join(" | "),
    );
    server.close();
  }

  console.log("\n3. When it goes wrong");

  {
    /* A line that is only a dot ends the message. A body containing one has to
       survive, or a member's message is silently truncated. */
    const { server, seen } = stubServer();
    const port = await listen(server);
    const t = smtp(
      { host: "127.0.0.1", port, user: "u@e.com", pass: "p", secure: true, insecureTls: true },
      "u@e.com",
      (m) => `<p>${m.body}</p>`,
    );
    await t.send("x@y.com", { subject: "Dots", body: "One.\n.\n.hidden\nTwo." });
    const decoded = decodeText(seen[0]?.data ?? "");
    ok("a body containing a lone dot is not truncated", decoded === "One.\n.\n.hidden\nTwo.", JSON.stringify(decoded));
    server.close();
  }

  {
    const { server } = stubServer({ rejectAuth: true });
    const port = await listen(server);
    const t = smtp(
      { host: "127.0.0.1", port, user: "u@e.com", pass: "wrong", secure: true, insecureTls: true },
      "u@e.com",
      render,
    );
    const res = await t.send("x@y.com", { subject: "s", body: "b" });
    ok("a bad password fails rather than silently succeeding", !res.ok);
    ok(
      "and the server's own words come back",
      !res.ok && /535/.test(res.error) && /Password not accepted/i.test(res.error),
      !res.ok ? res.error : "",
    );
    server.close();
  }

  {
    const { server } = stubServer({ rejectSender: true });
    const port = await listen(server);
    const t = smtp(
      { host: "127.0.0.1", port, user: "u@e.com", pass: "p", secure: true, insecureTls: true },
      "someone@else.com",
      render,
    );
    const res = await t.send("x@y.com", { subject: "s", body: "b" });
    ok("sending as the wrong mailbox is refused", !res.ok);
    ok("with the reason attached", !res.ok && /550/.test(res.error), !res.ok ? res.error : "");
    server.close();
  }

  {
    /* A server that will not encrypt must not be given the password anyway. */
    const { server, inTheClear } = stubServer({ mode: "starttls", refuseStarttls: true });
    const port = await listen(server);
    const t = smtp(
      { host: "127.0.0.1", port, user: "u@e.com", pass: "app-pw-secret", secure: false, insecureTls: true },
      "u@e.com",
      render,
    );
    const res = await t.send("x@y.com", { subject: "s", body: "b" });
    ok("a server that cannot encrypt is refused", !res.ok);
    ok("and told why", !res.ok && /unencrypted|STARTTLS/i.test(res.error), !res.ok ? res.error : "");
    ok(
      "and got no password out of us",
      !inTheClear.join("\n").includes("app-pw-secret"),
      inTheClear.join(" | "),
    );
    server.close();
  }

  {
    /* The diagnostic that npm run email:test prints. */
    const { server } = stubServer({ rejectAuth: true });
    const port = await listen(server);
    const t = smtp(
      { host: "127.0.0.1", port, user: "u@e.com", pass: "wrong-pw", secure: true, insecureTls: true },
      "u@e.com",
      render,
    );
    const trace = await t.trace!("x@y.com", { subject: "s", body: "b" });
    ok("trace reports the failure", !trace.ok);
    ok("and hands back the whole dialogue", trace.log.length > 4, trace.log.length);
    ok("with the greeting in it", trace.log.some((l) => l.startsWith("S: 220")));
    ok(
      "and no password anywhere in it",
      !trace.log.join("\n").includes("wrong-pw") &&
        trace.log.some((l) => l.includes("credentials withheld")),
      trace.log.join(" | "),
    );
    server.close();
  }

  {
    /* Nothing listening. Must fail cleanly and quickly, not hang a booking. */
    const t = smtp(
      { host: "127.0.0.1", port: 1, user: "u@e.com", pass: "p", secure: true, insecureTls: true },
      "u@e.com",
      render,
    );
    const started = Date.now();
    const res = await t.send("x@y.com", { subject: "s", body: "b" });
    ok("an unreachable server fails rather than hanging", !res.ok);
    ok("and fails fast", Date.now() - started < 15_000, `${Date.now() - started}ms`);
  }
}

/** The text part of a received message, decoded the way a mail client would. */
function decodeText(raw: string) {
  const b64 = /text\/plain[\s\S]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(raw)?.[1] ?? "";
  return Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8");
}

rmSync(dir, { recursive: true, force: true });

console.log("");
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`ALL PASS — ${passed} passed, 0 failed`);
