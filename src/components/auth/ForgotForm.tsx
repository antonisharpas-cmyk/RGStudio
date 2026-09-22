"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { useI18n } from "@/i18n/LanguageProvider";

/** "Forgot your password?": one box, one button, one honest answer. */
export function ForgotForm() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ minutes: number; delivered: boolean } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
      setError(t.auth.errEmail);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: boolean; sent?: boolean; minutes?: number; error?: string };
      if (data.ok) {
        setSent({ minutes: data.minutes ?? 60, delivered: data.sent !== false });
        return;
      }
      setError(
        data.error === "EMAIL_INVALID"
          ? t.auth.errEmail
          : t.common.somethingWrong,
      );
    } catch {
      setError(t.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-x flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Monogram className="mx-auto h-11 w-11 text-clay/60" />
          <h1 className="h-display mt-8 text-4xl">
            {sent ? t.auth.forgotSentTitle : t.auth.forgotTitle}
          </h1>
          <p className="mt-3 text-sm text-mocha-500">
            {sent
              ? sent.delivered
                ? t.auth.forgotSentBody.replace("{n}", String(sent.minutes))
                : t.auth.forgotNotSent
              : t.auth.forgotBody}
          </p>
        </div>

        {sent ? (
          <p className="mt-10 text-center text-[12px] text-mocha-500">
            <Link href="/login" className="link-underline text-mocha-600">
              {t.auth.backToLogin}
            </Link>
          </p>
        ) : (
          <form
            onSubmit={submit}
            noValidate
            className="mt-10 rounded-4xl border border-mocha-200/70 bg-white/70 p-8 backdrop-blur-sm"
          >
            <label className="label" htmlFor="email">
              {t.common.email}
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required className="input" />

            {error && (
              <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button type="submit" className="mt-8 w-full" disabled={busy}>
              {busy ? t.common.loading : t.auth.forgotCta}
            </Button>

            <p className="mt-6 text-center text-[12px] text-mocha-500">
              <Link href="/login" className="link-underline text-mocha-600">
                {t.auth.backToLogin}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
