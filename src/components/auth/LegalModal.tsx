"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";
import { type LegalKind, legalSections } from "@/lib/legal";
import { RichText } from "@/components/marketing/LegalBody";

/**
 * The terms and the privacy notice, read without leaving the form.
 *
 * Sign-up requires accepting both, and the link to read them cannot be an
 * ordinary link: following it away from a half-filled registration form loses
 * the name, the email and the phone somebody has just typed, and they come back
 * to an empty form. Nobody reads the terms twice after that happens once.
 *
 * So it opens here, over the form, and closing it puts them back exactly where
 * they were. The accept button is the same act as ticking the box, which is why
 * it hands the decision back to the form rather than keeping its own state: one
 * answer, one place, and no way for the box and the document to disagree.
 */
export function LegalModal({
  kind,
  onAccept,
  onClose,
}: {
  kind: LegalKind;
  /** Called when they accept in here, which ticks the box on the form. */
  onAccept: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  /**
   * Escape closes it, and the scroll behind it is frozen.
   *
   * Without the second part, scrolling to the end of a long document carries on
   * into the page underneath once it runs out, and the form the member was
   * filling in scrolls away behind the panel.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items = legalSections(kind, locale);
  const title = kind === "privacy" ? t.legal.privacyTitle : t.legal.termsTitle;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-mocha-900/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      /* Clicking the darkened area closes it, the way every other dialog on the
         web behaves. The stopPropagation on the panel keeps a click inside the
         text from doing the same. */
      onClick={onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-3xl bg-cream shadow-2xl outline-none sm:max-h-[86vh] sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-mocha-200/70 px-6 py-5 sm:px-8">
          <div>
            <p className="eyebrow mb-1.5">{t.footer.legal}</p>
            <h2 className="h-display text-[1.5rem] leading-tight">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.nav.close}
            className="-mr-1 shrink-0 rounded-full p-2 text-clay transition-colors hover:bg-mocha-100 hover:text-mocha-700"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <div className="space-y-7">
            {items.map(({ title: heading, body }) => (
              <div key={heading}>
                <h3 className="text-[12px] uppercase tracking-widest">
                  {heading}
                </h3>
                <p className="mt-2 whitespace-pre-line text-[14px] leading-[1.85] text-mocha-500">
                  <RichText text={body} />
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-mocha-200/70 px-6 py-5 sm:flex-row sm:justify-end sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-clay underline decoration-clay/40 underline-offset-4 transition-colors hover:text-mocha-700"
          >
            {t.nav.close}
          </button>
          <Button
            type="button"
            onClick={() => {
              onAccept();
              onClose();
            }}
          >
            {t.auth.legalAcceptCta}
          </Button>
        </div>
      </div>
    </div>
  );
}
