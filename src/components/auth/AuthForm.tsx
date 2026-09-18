"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LegalModal } from "@/components/auth/LegalModal";
import { Button } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { useI18n } from "@/i18n/LanguageProvider";
import type { LegalKind } from "@/lib/legal";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  /**
   * Where to go afterwards.
   *
   * The timetable, not the account page. Somebody who has just signed in or just
   * signed up is here to book a class — that is what the site is for — and the
   * account page is a filing cabinet: a balance, some settings, a list of past
   * sessions. Landing there means one more click before the thing they came to
   * do, every single time.
   *
   * A `next` in the URL still wins, because that is somebody who was interrupted
   * on their way somewhere specific and should be put back.
   */
  /* Only a local path is ever honoured. A `next` of https://evil.example would
     otherwise send a member straight to an attacker's page the instant they sign
     in — the classic post-login open redirect. Protocol-relative (//host) is
     rejected too, since the browser reads it as an absolute URL. */
  const rawNext = params.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/timetable";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The terms box, held in state rather than left to the DOM.
   *
   * It can be ticked in two places — the box itself, and the accept button
   * inside the document — and both have to mean the same thing. A plain
   * uncontrolled checkbox would let the modal's button and the box disagree,
   * which is the one thing consent must never do.
   */
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [reading, setReading] = useState<LegalKind | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);

    const payload =
      mode === "login"
        ? { email: form.get("email"), password: form.get("password") }
        : {
            name: form.get("name"),
            email: form.get("email"),
            phone: form.get("phone"),
            password: form.get("password"),
            serviceOptIn: form.get("serviceOptIn") === "on",
            marketingOptIn: form.get("marketingOptIn") === "on",
            termsAccepted,
          };

    /* Said here in the reader's own language rather than leaving them to
       press the button and read a code back from the server. The server checks
       all of this again — a browser is a suggestion — but being told which field
       is wrong before submitting is the difference between correcting a typo and
       guessing. */
    if (mode === "register") {
      const stop = (msg: string) => {
        setError(msg);
        setBusy(false);
      };

      if (String(form.get("name") ?? "").trim().length < 2) {
        return stop(t.auth.errName);
      }

      const email = String(form.get("email") ?? "").trim();
      /* Not a full RFC address parser — those reject real addresses. This asks
         the three questions worth asking: is there an @, is there something
         either side of it, and does the domain have a dot with letters after it.
         The screenshot that prompted this had "cristiano" in the email box. */
      if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
        return stop(t.auth.errEmail);
      }

      const phone = String(form.get("phone") ?? "").trim();
      const digits = (phone.match(/\d/g) ?? []).length;
      /* Eight is a Cyprus landline or mobile without the country code; more is
         a number with one. Anything shorter cannot be dialled. */
      if (digits < 8) {
        return stop(t.auth.errPhone);
      }
      if (digits > 15) {
        /* E.164 caps at fifteen digits, so more than that is a typo. */
        return stop(t.auth.errPhone);
      }
      if (String(form.get("password") ?? "").length < 8) {
        return stop(t.auth.errPassword);
      }
      if (form.get("serviceOptIn") !== "on") {
        return stop(t.auth.errServiceConsent);
      }
      if (!termsAccepted) {
        return stop(t.auth.errTerms);
      }
    }

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        verify?: boolean;
        sent?: boolean;
      };

      if (data.ok) {
        /* An account whose email has not been confirmed goes to the code box,
           carrying its destination with it: somebody who was on their way to
           checkout when they registered gets put back there once the code is
           typed, rather than being dropped on the timetable. */
        if (data.verify) {
          /* `sent=0` when the email could not be got out of the door. Without
             it the member sits watching an inbox for something that was never
             posted; with it the screen says so and offers to try again. */
          const q = new URLSearchParams({ next });
          if (data.sent === false) q.set("sent", "0");
          window.location.assign(`/verify?${q}`);
          return;
        }
        /* A document load rather than a client navigation. Everything that shows
           who is signed in — the header, the session count on their photograph,
           the notice badge — is rendered on the server, and a client push with a
           refresh chasing it lands on the timetable still looking signed out for
           a moment. */
        window.location.assign(next);
        return;
      }
      const known: Record<string, string> = {
        EMAIL_TAKEN: t.auth.emailTaken,
        PHONE_TAKEN: t.auth.phoneTaken,
        INVALID_CREDENTIALS: t.auth.invalid,
        PHONE_REQUIRED: t.auth.errPhone,
        PHONE_INVALID: t.auth.errPhone,
        SERVICE_CONSENT_REQUIRED: t.auth.errServiceConsent,
        TERMS_REQUIRED: t.auth.errTerms,
        NAME_REQUIRED: t.auth.errName,
        EMAIL_INVALID: t.auth.errEmail,
        PASSWORD_SHORT: t.auth.errPassword,
      };
      /* Fall back to the code itself rather than a bare "something went
         wrong". An unmapped code is rare, but when it happens the person
         staring at the screen needs something they can act on or quote,
         not a shrug. */
      setError(
        known[data.error ?? ""] ??
          (data.error
            ? `${t.common.somethingWrong} (${data.error})`
            : t.common.somethingWrong),
      );
    } catch {
      setError(t.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="container-x flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Monogram className="mx-auto h-11 w-11 text-clay/60" />
          <h1 className="h-display mt-8 text-4xl">
            {isLogin ? t.auth.loginTitle : t.auth.registerTitle}
          </h1>
          <p className="mt-3 text-sm text-mocha-500">
            {isLogin ? t.auth.loginBody : t.auth.registerBody}
          </p>
        </div>

        <form
          onSubmit={submit}
          noValidate
          className="mt-10 rounded-4xl border border-mocha-200/70 bg-white/70 p-8 backdrop-blur-sm"
        >
          <div className="space-y-5">
            {!isLogin && (
              <div>
                <label className="label" htmlFor="name">
                  {t.common.fullName}
                </label>
                <input id="name" name="name" required className="input" />
              </div>
            )}

            <div>
              <label className="label" htmlFor="email">
                {t.common.email}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="input"
              />
            </div>

            {!isLogin && (
              <div>
                <label className="label" htmlFor="phone">
                  {t.common.phone}
                </label>
                {/* Still required — the field is marked `required` and checked
                    on the server. The asterisk and the explanation went because
                    every field on this form is required, so marking one of them
                    told the reader nothing except that the others might not be. */}
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  className="input"
                />
              </div>
            )}

            <div>
              <label className="label" htmlFor="password">
                {t.common.password}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                minLength={isLogin ? undefined : 8}
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
                className="input"
              />
              {!isLogin && (
                <p className="mt-2 text-[11px] text-clay">
                  {t.auth.passwordHint}
                </p>
              )}
            </div>

            {!isLogin && (
              <div className="space-y-4 border-t border-mocha-200/70 pt-5">
                {/* Required. Without it the studio cannot tell someone their
                    class has moved, which is the one message nobody should be
                    able to miss. */}
                <label className="flex cursor-pointer items-start gap-3 text-[12px] text-mocha-600">
                  <input
                    type="checkbox"
                    name="serviceOptIn"
                    required
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-mocha-300 accent-mocha-600"
                  />
                  <span>
                    {t.auth.serviceOptIn}{" "}
                    <span aria-hidden className="text-clay/70">
                      *
                    </span>
                  </span>
                </label>

                {/* Required, and the only consent here with a document behind
                    it. The two links open that document over the form rather
                    than navigating away from it: see LegalModal. */}
                <label className="flex cursor-pointer items-start gap-3 text-[12px] text-mocha-600">
                  <input
                    type="checkbox"
                    name="termsAccepted"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.currentTarget.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-mocha-300 accent-mocha-600"
                  />
                  <span>
                    {t.auth.termsAcceptPrefix}{" "}
                    <button
                      type="button"
                      /* Inside a label, so a click here would otherwise also
                         toggle the box on the way past. */
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setReading("terms");
                      }}
                      className="underline decoration-mocha-400 underline-offset-2 transition-colors hover:text-mocha-800"
                    >
                      {t.legal.termsTitle}
                    </button>{" "}
                    {t.auth.termsAcceptJoin}{" "}
                    {/* The link and the required marker are one unbreakable
                        unit. Left to wrap on their own the asterisk dropped to
                        a line by itself under the sentence, which reads as a
                        stray character rather than a mark on this box. */}
                    <span className="whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setReading("privacy");
                        }}
                        className="underline decoration-mocha-400 underline-offset-2 transition-colors hover:text-mocha-800"
                      >
                        {t.legal.privacyTitle}
                      </button>
                      <span aria-hidden className="text-clay/70">
                        {" "}
                        *
                      </span>
                    </span>
                  </span>
                </label>

                {/* Optional, and clearly so. */}
                <label className="flex cursor-pointer items-start gap-3 text-[12px] text-mocha-500">
                  <input
                    type="checkbox"
                    name="marketingOptIn"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-mocha-300 accent-mocha-600"
                  />
                  <span>{t.auth.marketingOptIn}</span>
                </label>
              </div>
            )}
          </div>

          {error && (
            <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <Button type="submit" className="mt-8 w-full" disabled={busy}>
            {busy ? t.common.loading : isLogin ? t.auth.signIn : t.auth.signUp}
          </Button>

          <p className="mt-6 text-center text-[12px] text-mocha-500">
            {isLogin ? t.auth.noAccount : t.auth.hasAccount}{" "}
            {/* Carries the destination across. Somebody who pressed "Buy pack"
                without an account goes login -> register -> checkout, and
                losing the pack in the middle of that would send them back to
                the pricing page to start again. */}
            <Link
              href={`${isLogin ? "/register" : "/login"}${
                /* Only carry `next` when it is a real destination somebody was
                   sent here from. The default is not worth putting in a URL. */
                next !== "/timetable" ? `?next=${encodeURIComponent(next)}` : ""
              }`}
              className="link-underline text-mocha-600"
            >
              {isLogin ? t.auth.signUp : t.auth.signIn}
            </Link>
          </p>
        </form>
      </div>

      {/* Mounted outside the form on purpose: a dialog inside a form inherits
          its submit behaviour, and a stray Enter in there would have posted a
          half-filled registration. */}
      {reading && (
        <LegalModal
          kind={reading}
          onAccept={() => setTermsAccepted(true)}
          onClose={() => setReading(null)}
        />
      )}
    </div>
  );
}
