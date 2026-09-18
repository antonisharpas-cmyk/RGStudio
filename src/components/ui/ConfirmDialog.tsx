"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * "Are you sure?", once, for everywhere that asks it.
 *
 * ---
 *
 * **Why this exists rather than a third copy.**
 *
 * There were two hand-built dialogs in the codebase and they had drifted:
 * `LegalModal` freezes the page behind it, closes on Escape and moves focus
 * into the panel; the cancel confirmation on the account page did none of those
 * three. Both were correct enough to ship and neither was the same as the
 * other, which is what happens to a pattern that lives in the components that
 * use it.
 *
 * Then the desk needed a third — remove somebody from a class, with or without
 * refunding the session — and a third copy would have been the point at which
 * one of them was wrong in a way nobody noticed. So the behaviour is here once:
 * Escape closes, the page behind does not scroll, the panel takes focus, a
 * click on the darkened area closes and a click inside does not.
 *
 * ---
 *
 * **`actions` is a list on purpose.**
 *
 * A confirm dialog is usually one button and a way out, and that is the common
 * case here too. But the desk's removal is genuinely two different actions —
 * refund the session or keep it — and neither is a default the software should
 * pick on somebody's behalf, because it is a decision about a member's money
 * made by the only person who knows which it is. A dialog that took a single
 * `onConfirm` would have forced that choice into a checkbox, or into two
 * separate dialogs that ask the same question twice.
 *
 * The way out is always last and always plain, so "no" is in the same place
 * whatever is being asked.
 */
export type ConfirmAction = {
  label: string;
  onClick: () => void;
  variant?: "solid" | "outline" | "ghost";
  /** Set while the action is in flight, so it cannot be pressed twice. */
  busy?: boolean;
  /** Greys it out and refuses the press. Used for a window that has closed. */
  disabled?: boolean;
};

export function ConfirmDialog({
  title,
  body,
  actions,
  cancelLabel,
  onClose,
}: {
  title: string;
  /** A string, or richer content when the answer depends on something. */
  body?: React.ReactNode;
  actions: ConfirmAction[];
  /** Defaults to the shared "Back". */
  cancelLabel?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    /* The page behind must not scroll. Without this, a flick on a phone scrolls
       the desk's day list away underneath the dialog, and the answer to "which
       class was I looking at" is gone by the time it closes. */
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-mocha-900/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl bg-cream p-8 shadow-lift outline-none sm:rounded-3xl"
      >
        <p className="h-display text-[1.35rem] leading-snug text-mocha-600">
          {title}
        </p>
        {body ? (
          <div className="mt-3 text-[13px] leading-relaxed text-mocha-500">
            {body}
          </div>
        ) : null}

        <div className="mt-7 space-y-2">
          {actions.map((a) => (
            <Button
              key={a.label}
              variant={a.variant ?? "solid"}
              className="w-full"
              disabled={a.busy || a.disabled}
              onClick={a.onClick}
            >
              {a.busy ? t.common.loading : a.label}
            </Button>
          ))}
          {/* Always last, always plain: "no" in the same place every time. */}
          <Button variant="ghost" className="w-full" onClick={onClose}>
            {cancelLabel ?? t.common.back}
          </Button>
        </div>
      </div>
    </div>
  );
}
