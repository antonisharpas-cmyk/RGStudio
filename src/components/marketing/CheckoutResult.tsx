"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { Section } from "@/components/ui/Section";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * The page a member lands on the moment a payment goes through.
 *
 * Two separate things can make the numbers here lie, and both are handled.
 *
 * 1. The count in the header lives in the site layout, and a client-side
 *    navigation keeps the layout it already has — so buying a pack used to
 *    leave the old number in the corner of the screen until a hard reload.
 *    One refresh on arrival re-renders the layout as well as this page.
 * 2. The provider sends the member back here the instant the card clears,
 *    which can be a moment before the webhook that actually grants the
 *    sessions has landed. While the balance still reads zero we keep
 *    re-checking rather than showing a wrong number.
 */
export function CheckoutResult({
  kind,
  credits,
}: {
  kind: "success" | "cancelled";
  credits: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [waiting, setWaiting] = useState(kind === "success" && credits === 0);

  /* (1) — once, on arrival, whatever the balance says. */
  const refreshed = useRef(false);
  useEffect(() => {
    if (kind !== "success" || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [kind, router]);

  /* (2) — and again until the webhook has done its work. */
  useEffect(() => {
    if (!waiting) return;
    if (credits > 0) {
      setWaiting(false);
      return;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      router.refresh();
      /* About fifteen seconds. Past that the payment is recorded and the
         sessions will appear on the account either way, so stop spinning and
         show the balance we have rather than an endless ellipsis. */
      if (tries >= 8) {
        setWaiting(false);
        window.clearInterval(id);
      }
    }, 1800);
    return () => window.clearInterval(id);
  }, [waiting, credits, router]);

  const success = kind === "success";

  return (
    <Section className="py-28 md:py-36">
      <div className="container-x max-w-2xl text-center">
        <Monogram className="mx-auto h-14 w-14 text-clay/60" />

        <h1 className="h-display mt-10 text-[2.6rem] leading-tight sm:text-5xl">
          {success ? t.checkout.successTitle : t.checkout.cancelTitle}
        </h1>
        <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-mocha-500">
          {success ? t.checkout.successBody : t.checkout.cancelBody}
        </p>

        {success && (
          <p className="mt-10 inline-flex items-baseline gap-3 rounded-full border border-mocha-200 bg-white/70 px-6 py-3">
            <span className="font-display text-3xl text-mocha-600">
              {waiting ? "…" : credits}
            </span>
            <span className="text-[11px] uppercase tracking-widest text-clay">
              {waiting ? t.checkout.processing : t.common.creditsLeft}
            </span>
          </p>
        )}

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href={success ? "/timetable" : "/pricing"} size="lg">
            {success ? t.checkout.successCta : t.checkout.cancelCta}
          </ButtonLink>
          <ButtonLink href="/account" variant="outline" size="lg">
            {t.nav.account}
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
