"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * Stripe's card fields, mounted inside our own page.
 *
 * Everything visible here is drawn by Stripe inside iframes it owns, styled
 * through the appearance API to match the studio's palette. That is the whole
 * trick behind an on-page card form that does not drag the studio into PCI
 * scope: it looks like our form, it sits in our layout, and the card number
 * goes straight from the member's browser to Stripe without passing through
 * this application at all.
 *
 * This module is loaded on demand by CheckoutBody, so Stripe's JavaScript is
 * fetched only by somebody actually paying — it is not in the bundle for the
 * timetable or the home page.
 */
export default function StripeFields({
  publicKey,
  clientSecret,
  returnUrl,
  amountLabel,
  email,
  onPaid,
}: {
  publicKey: string;
  clientSecret: string;
  /** Where Stripe sends the member back if the bank demands 3-D Secure. */
  returnUrl: string;
  amountLabel: string;
  /**
   * The member's own address, so the form does not ask for it again.
   *
   * They are signed in; we know it. Passing it removes a field from the card
   * form and, where Stripe's Link prompt is switched on in the dashboard,
   * removes the separate email step in front of the card as well. Stripe
   * documents this as the recommended integration for exactly that reason.
   */
  email?: string;
  onPaid: () => void;
}) {
  const stripe = useMemo(() => loadStripe(publicKey), [publicKey]);

  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret,
        appearance: {
          theme: "flat",
          variables: {
            colorPrimary: "#3A3532",
            colorBackground: "#FFFFFF",
            colorText: "#2C2826",
            colorTextSecondary: "#8F857D",
            colorDanger: "#B4453C",
            fontFamily: "var(--font-jost), ui-sans-serif, system-ui, sans-serif",
            fontSizeBase: "15px",
            borderRadius: "14px",
            spacingUnit: "5px",
          },
          rules: {
            ".Input": {
              border: "1px solid #DFD8D3",
              boxShadow: "none",
              padding: "12px 14px",
            },
            ".Input:focus": {
              border: "1px solid #A69B93",
              boxShadow: "none",
            },
            ".Label": {
              fontSize: "11px",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "#8F857D",
            },
          },
        },
      }}
    >
      <Form
        returnUrl={returnUrl}
        amountLabel={amountLabel}
        email={email}
        onPaid={onPaid}
      />
    </Elements>
  );
}

function Form({
  returnUrl,
  amountLabel,
  email,
  onPaid,
}: {
  returnUrl: string;
  amountLabel: string;
  email?: string;
  onPaid: () => void;
}) {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    /* `if_required` keeps the member here for the ordinary case and hands over
       to the bank's own screen only when 3-D Secure is demanded. */
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (err) {
      setError(err.message ?? t.checkoutPage.errCard);
      setBusy(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      onPaid();
      return;
    }

    /* Taken, but the bank has not finished. The success page waits for it. */
    if (paymentIntent?.status === "processing") {
      onPaid();
      return;
    }

    setError(t.checkoutPage.declined);
    setBusy(false);
  }

  return (
    <form onSubmit={pay} noValidate>
      {/* Card, Apple Pay, Google Pay. "auto" means each wallet appears only on a
          device that can actually use it — an Apple Pay button on a Windows
          desktop is a button that cannot work. The intent is nailed down here as
          well as on the server so a future change has to be deliberate in both
          places. */}
      <PaymentElement
        onReady={() => setReady(true)}
        options={{
          wallets: { applePay: "auto", googlePay: "auto" },
          layout: { type: "tabs", defaultCollapsed: false },
          ...(email
            ? { defaultValues: { billingDetails: { email } } }
            : {}),
        }}
      />

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="mt-7 w-full"
        disabled={!ready || busy}
      >
        {busy
          ? t.checkoutPage.paying
          : t.checkoutPage.payButton.replace("{amount}", amountLabel)}
      </Button>
    </form>
  );
}
