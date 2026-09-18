"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * The card form used while no provider is connected.
 *
 * It exists so the studio can see and feel the finished journey before choosing
 * a provider, and so the whole path — purchase row, settlement, sessions
 * granted, header count moving — is exercised in development and in the tests.
 *
 * It takes nothing. What is typed here stays in this component: the fields are
 * checked in the browser and the only thing sent to the server is the id of the
 * purchase. There is no code path in this application that receives a card
 * number, which is exactly how it should stay.
 */
export function TestCardForm({
  amountLabel,
  onPaid,
}: {
  amountLabel: string;
  onPaid: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const c = t.checkoutPage;
  const [number, setNumber] = useState("");
  /* Picked, not typed. Nobody should have to guess whether this box wants
     "12/30", "12 / 2030" or "1230", and a card only ever expires on one of a
     hundred and forty-odd dates. */
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = number.replace(/\D/g, "");

  /* Twelve years ahead, which is longer than any bank issues a card for. */
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 13 }, (_, i) => thisYear + i);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (
      digits.length < 12 ||
      !month ||
      !year ||
      cvc.replace(/\D/g, "").length < 3 ||
      name.trim().length < 2
    ) {
      setError(c.errCard);
      return;
    }
    setError(null);
    setBusy(true);
    await onPaid();
    setBusy(false);
  }

  return (
    <form onSubmit={pay} noValidate>
      <p className="mb-6 rounded-2xl border border-gold/40 bg-gold/[0.06] px-4 py-3 text-[13px] leading-relaxed text-mocha-600">
        <span className="mr-2 text-[10px] uppercase tracking-brand text-gold">
          {c.testTitle}
        </span>
        {c.testBody}
      </p>

      <div className="grid gap-5">
        <div>
          <label className="label" htmlFor="card-number">
            {c.cardNumber}
          </label>
          <input
            id="card-number"
            className="input lining-nums tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4242 4242 4242 4242"
            value={number}
            onChange={(e) =>
              setNumber(
                e.target.value
                  .replace(/\D/g, "")
                  .slice(0, 19)
                  .replace(/(.{4})/g, "$1 ")
                  .trim(),
              )
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-5 sm:grid-cols-[1fr_1fr_1fr]">
          <div>
            <label className="label" htmlFor="card-month">
              {c.expiryMonth}
            </label>
            <select
              id="card-month"
              className="input lining-nums tabular-nums"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">{c.pick}</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map(
                (m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="card-year">
              {c.expiryYear}
            </label>
            <select
              id="card-year"
              className="input lining-nums tabular-nums"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">{c.pick}</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="card-cvc">
              {c.cvc}
            </label>
            <input
              id="card-cvc"
              className="input lining-nums tabular-nums"
              inputMode="numeric"
              autoComplete="off"
              placeholder="123"
              value={cvc}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="card-name">
            {c.nameOnCard}
          </label>
          <input
            id="card-name"
            className="input"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="mt-7 w-full" disabled={busy}>
        {busy
          ? c.paying
          : c.testPay.replace("{amount}", amountLabel)}
      </Button>
    </form>
  );
}
