"use client";

import Link from "next/link";
import { useState } from "react";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { useI18n } from "@/i18n/LanguageProvider";

type State = "ready" | "done" | "INVALID" | "EXPIRED" | "USED";

/** The two boxes behind the emailed link. */
export function ResetForm({
  token,
  initialState,
  minutes,
}: {
  token: string;
  initialState: State;
  minutes: number;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dead: Record<Exclude<State, "ready" | "done">, string> = {
    INVALID: t.auth.resetInvalid,
    EXPIRED: t.auth.resetExpired.replace("{n}", String(minutes)),
    USED: t.auth.resetUsed,
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password.length < 8) return setError(t.auth.errPassword);
    if (password !== confirm) return setError(t.auth.errMismatch);

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirm }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setState("done");
        return;
      }
      if (data.error === "INVALID" || data.error === "EXPIRED" || data.error === "USED") {
        setState(data.error);
        return;
      }
      setError(
        data.error === "PASSWORD_SHORT"
          ? t.auth.errPassword
          : data.error === "MISMATCH"
            ? t.auth.errMismatch
            : t.common.somethingWrong,
      );
    } catch {
      setError(t.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  const title =
    state === "ready"
      ? t.auth.resetTitle
      : state === "done"
        ? t.auth.resetDoneTitle
        : t.auth.resetInvalidTitle;
  const body =
    state === "ready" ? t.auth.resetBody : state === "done" ? t.auth.resetDoneBody : dead[state];

  return (
    <div className="container-x flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Monogram className="mx-auto h-11 w-11 text-clay/60" />
          <h1 className="h-display mt-8 text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-mocha-500">{body}</p>
        </div>

        {state === "ready" ? (
          <form
            onSubmit={submit}
            noValidate
            className="mt-10 rounded-4xl border border-mocha-200/70 bg-white/70 p-8 backdrop-blur-sm"
          >
            <div className="space-y-5">
              <PasswordField
                id="password"
                name="password"
                label={t.auth.newPassword}
                autoComplete="new-password"
                minLength={8}
              />
              <PasswordField
                id="confirm"
                name="confirm"
                label={t.auth.confirmPassword}
                autoComplete="new-password"
                minLength={8}
              />
            </div>

            {error && (
              <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button type="submit" className="mt-8 w-full" disabled={busy}>
              {busy ? t.common.loading : t.auth.resetCta}
            </Button>
          </form>
        ) : (
          <div className="mt-10 flex flex-col items-center gap-4">
            {state === "done" ? (
              <ButtonLink href="/login">{t.auth.signIn}</ButtonLink>
            ) : (
              <>
                <ButtonLink href="/forgot">{t.auth.requestNewLink}</ButtonLink>
                <Link href="/login" className="link-underline text-[12px] text-mocha-600">
                  {t.auth.backToLogin}
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
