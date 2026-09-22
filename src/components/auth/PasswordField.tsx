"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * A password box with an eye.
 *
 * Masked by default, shown on request, and the eye is a real button with a
 * label a screen reader can read. The toggle is per field: somebody checking
 * that the two boxes on the reset form agree can uncover one and leave the
 * other hidden.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  minLength,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          minLength={minLength}
          autoComplete={autoComplete}
          required
          className="input pr-12"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t.auth.hidePassword : t.auth.showPassword}
          aria-pressed={shown}
          title={shown ? t.auth.hidePassword : t.auth.showPassword}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-clay transition-colors hover:text-mocha-700"
        >
          {shown ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2.5 2.5 0 0 0 3.5 3.5" />
              <path d="M9.9 5.1A10.6 10.6 0 0 1 12 4.9c5 0 8.6 3.6 10 7.1a12.4 12.4 0 0 1-3 4.1" />
              <path d="M6.2 6.2C4 7.6 2.7 9.7 2 12c1.4 3.5 5 7.1 10 7.1 1.6 0 3-.3 4.3-.9" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 12c1.4-3.5 5-7.1 10-7.1s8.6 3.6 10 7.1c-1.4 3.5-5 7.1-10 7.1S3.4 15.5 2 12z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          )}
        </button>
      </div>
      {hint && <p className="mt-2 text-[11px] text-clay">{hint}</p>}
    </div>
  );
}
