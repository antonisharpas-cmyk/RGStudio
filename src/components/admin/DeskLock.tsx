"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { Button } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { Section } from "@/components/ui/Section";
import { Wordmark } from "@/components/ui/Wordmark";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * The door into the desk console, and the only one.
 *
 * Typing /admin is the whole journey: the credentials are asked for right here
 * rather than bouncing through the member sign-in page and back. Two shapes of
 * the same screen — email and password for somebody arriving cold, password
 * alone for staff already signed in whose 15-minute idle window has lapsed. The
 * second shape always offers a way out to the first, because the person sitting
 * down is not always the person who stood up.
 *
 * Why the second door exists at all: the reception computer stands in a public
 * room, signed in all day, and one click behind that session are every member's
 * phone number and a password reset. A long-lived session cookie is the right
 * trade for booking a class; it is the wrong trade for this. The password is the
 * staff member's own, so there is nothing extra to share or write on a note.
 *
 * A member's correct password is refused with the same words as a wrong one.
 * This screen tells a stranger nothing about who works here.
 */
export function DeskLock({ name }: { name?: string }) {
  const { t } = useI18n();
  const d = t.desk;
  const router = useRouter();

  /* With a name, somebody staff is already signed in and only the lock stands
     in the way. Without one, this is the front door. */
  const knownStaff = Boolean(name);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * "That is not me."
   *
   * Two people share this machine. When the desk locks itself after fifteen
   * idle minutes
   * the browser still remembers whoever signed in last, so a password-only
   * screen quietly insists that the person in front of it is that same person.
   * Often they are not — reception went home and the owner sat down. Ending the
   * session turns this back into the front door, with an email box.
   */
  async function switchAccount() {
    setBusy(true);
    await Promise.all([
      fetch("/api/admin/lock", { method: "POST" }),
      fetch("/api/auth/logout", { method: "POST" }),
    ]);
    setPassword("");
    setError(null);
    setBusy(false);
    router.refresh();
  }

  async function open(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password || (!knownStaff && !email)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(knownStaff ? { password } : { email, password }),
      });
      if (res.ok) {
        setPassword("");
        router.refresh();
        return;
      }
      setError(knownStaff ? d.lockedWrong : d.signInWrong);
    } catch {
      setError(t.common.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* The desk has no website navigation, so the closed door carries only the
          mark and the language switch — nothing to wander off into. */}
      <div className="border-b border-mocha-200/70 bg-cream/95">
        <div className="container-x flex h-20 items-center justify-between">
          <Wordmark className="w-[132px]" priority />
          <LanguageToggle />
        </div>
      </div>

      <Section className="pt-16 md:pt-24">
        <div className="container-x max-w-md">
          <div className="rounded-4xl border border-mocha-200/70 bg-white/70 p-8 backdrop-blur-sm md:p-10">
            <Monogram className="h-10 w-10 text-clay/50" />

            <h1 className="h-display mt-8 text-[2rem] leading-tight">
              {knownStaff ? d.lockedTitle : d.signInTitle}
            </h1>
            <p className="mt-4 text-[14px] leading-relaxed text-mocha-500">
              {knownStaff ? d.lockedBody : d.signInBody}
            </p>

            <form onSubmit={open} noValidate className="mt-8">
              {!knownStaff && (
                <>
                  <label className="label" htmlFor="desk-email">
                    {d.signInEmail}
                  </label>
                  <input
                    id="desk-email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input mb-5"
                  />
                </>
              )}

              <label className="label" htmlFor="desk-password">
                {knownStaff ? d.lockedField : t.common.password}
              </label>
              <input
                id="desk-password"
                type="password"
                autoComplete="current-password"
                autoFocus={knownStaff}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="mt-7 w-full"
                disabled={busy || !password || (!knownStaff && !email)}
              >
                {busy
                  ? t.common.loading
                  : knownStaff
                    ? d.lockedCta
                    : d.signInCta}
              </Button>
            </form>

            {knownStaff && (
              <div className="mt-7 border-t border-mocha-200/70 pt-6">
                <p className="text-[13px] leading-relaxed text-mocha-500">
                  {d.switchBody.replace("{name}", name ?? "")}
                </p>
                <button
                  type="button"
                  onClick={switchAccount}
                  disabled={busy}
                  className="mt-3 text-[10px] uppercase tracking-widest text-mocha-600 underline decoration-mocha-300 underline-offset-4 transition-colors hover:decoration-mocha-600 disabled:text-clay"
                >
                  {d.switchAccount}
                </button>
              </div>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
