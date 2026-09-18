"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { useI18n } from "@/i18n/LanguageProvider";
import { signOutAndGoHome } from "@/lib/sign-out";
import { cn } from "@/lib/utils";

type State = {
  expired: boolean;
  locked: boolean;
  attemptsLeft: number;
  resendInSeconds: number;
} | null;

/**
 * Six digits, one box, one button.
 *
 * A single input rather than six little ones. Six boxes look tidy in a design
 * and are miserable in use: pasting a code out of an email fills the first box
 * with all six characters on some browsers and one character on others, and
 * backspacing between them never behaves the way anybody expects. One field of
 * six digits pastes correctly everywhere and can be typed without thinking.
 *
 * The submit fires by itself on the sixth digit. Somebody who has just typed a
 * code they read thirty seconds ago has finished — asking them to also find and
 * press a button is a step that exists only because the form was built that way.
 */
export function VerifyForm({
  email,
  next,
  state,
  sendFailed = false,
}: {
  email: string;
  next: string;
  state: State;
  /** The code could not be emailed. Say so rather than let them wait. */
  sendFailed?: boolean;
}) {
  const { t } = useI18n();
  const v = t.verify;

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    sendFailed
      ? v.errSendFailed
      : state?.locked
        ? v.errLocked
        : state?.expired
          ? v.errExpired
          : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(state?.resendInSeconds ?? 0);
  const inputRef = useRef<HTMLInputElement>(null);
  /* Guards the auto-submit: without it, a wrong code sits at six digits and the
     effect fires again on every re-render, walking through the five attempts in
     one go. */
  const tried = useRef<string>("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* The resend cooldown, counted down on screen. A disabled button with no
     explanation reads as broken; a disabled button that says "in 34 seconds"
     reads as a rule. */
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(
      () => setCooldown((s) => (s <= 1 ? 0 : s - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [cooldown]);

  async function submit(value: string) {
    if (busy || value.length !== 6 || tried.current === value) return;
    tried.current = value;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        attemptsLeft?: number;
      };

      if (data.ok) {
        /* A document load, not a client navigation: the header, the balance and
           the notice badge are all rendered on the server and would otherwise
           spend a moment still showing an unverified account. */
        window.location.assign(next);
        return;
      }

      if (data.error === "WRONG") {
        setError(
          data.attemptsLeft && data.attemptsLeft > 0
            ? v.errWrong.replace("{n}", String(data.attemptsLeft))
            : v.errLocked,
        );
      } else if (data.error === "EXPIRED") {
        setError(v.errExpired);
      } else if (data.error === "LOCKED") {
        setError(v.errLocked);
      } else if (data.error === "NO_CHALLENGE") {
        setError(v.errNoCode);
      } else {
        setError(t.common.somethingWrong);
      }
      setCode("");
      inputRef.current?.focus();
    } catch {
      setError(t.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/verify/resend", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        secondsLeft?: number;
        minutesLeft?: number;
      };
      if (data.ok) {
        setNotice(v.resent);
        setCooldown(60);
        setCode("");
        tried.current = "";
        inputRef.current?.focus();
        return;
      }
      if (data.error === "TOO_SOON") {
        setCooldown(data.secondsLeft ?? 60);
        setError(v.errTooSoon.replace("{n}", String(data.secondsLeft ?? 60)));
      } else if (data.error === "LIMIT") {
        setError(v.errLimit.replace("{n}", String(data.minutesLeft ?? 60)));
      } else {
        setError(v.errSendFailed);
      }
    } catch {
      setError(t.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-x flex min-h-[70vh] items-center justify-center py-16">
      {/* A stable hook for the manual's figure capture: the whole card, heading
          and address included, rather than just the form underneath them. */}
      <div data-verify-card className="w-full max-w-md">
        <div className="text-center">
          <Monogram className="mx-auto h-11 w-11 text-clay/60" />
          <h1 className="h-display mt-8 text-4xl">{v.title}</h1>
          <p className="mt-3 text-sm text-mocha-500">{v.body}</p>
          <p className="mt-2 break-all text-sm text-mocha-700">{email}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
          className="mt-10 rounded-4xl border border-mocha-200/70 bg-white/70 p-8 backdrop-blur-sm"
        >
          <label className="label" htmlFor="code">
            {v.codeLabel}
          </label>
          <input
            ref={inputRef}
            id="code"
            name="code"
            /* `text` with a numeric input mode rather than `number`: a number
               field drops a leading zero, and a code beginning 0 is one code in
               ten. `one-time-code` is what lets iOS and Android offer the digits
               straight off the notification. */
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(next);
              if (next.length === 6) void submit(next);
            }}
            className={cn(
              "input text-center font-display text-[30px] tracking-[0.4em] lining-nums tabular-nums",
              error && "border-red-300",
            )}
            aria-describedby="code-help"
          />
          <p id="code-help" className="mt-2 text-[11px] text-clay">
            {v.codeHint}
          </p>

          {error && (
            <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && !error && (
            <p className="mt-6 rounded-xl border border-mocha-200 bg-cream-200/70 px-4 py-3 text-sm text-mocha-600">
              {notice}
            </p>
          )}

          <Button
            type="submit"
            className="mt-8 w-full"
            disabled={busy || code.length !== 6}
          >
            {busy ? t.common.loading : v.submit}
          </Button>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => void resend()}
              disabled={busy || cooldown > 0}
              className="link-underline text-[12px] text-mocha-600 disabled:cursor-not-allowed disabled:text-clay disabled:no-underline"
            >
              {cooldown > 0
                ? v.resendIn.replace("{n}", String(cooldown))
                : v.resend}
            </button>
          </div>

          {/* The way out, and now the only one.
              
              Until the code is typed every other address on the site sends them
              back here, so this is not a footnote — it is the door. The
              commonest real reason to need it is a typo in their own email,
              which no number of resends can fix. */}
          <div className="mt-8 border-t border-mocha-200/70 pt-6 text-center">
            <p className="text-[11px] leading-relaxed text-clay">
              {v.wrongAddress}
            </p>
            <button
              type="button"
              onClick={() => void signOutAndGoHome()}
              className="link-underline mt-3 text-[12px] text-mocha-600"
            >
              {t.account.signOut}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
