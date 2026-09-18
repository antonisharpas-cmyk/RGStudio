"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * The offer running on the price list.
 *
 * Two things make this safe to hand to the desk. The prices are worked out in
 * one place on the server, so what a member is shown is what they are charged;
 * and every pack is listed here with its old and new price side by side, so
 * nobody has to trust arithmetic done in their head at the counter.
 *
 * "Back to normal prices" clears everything in one press. That matters more
 * than it sounds: an offer that is hard to switch off is an offer that runs all
 * summer by accident.
 */

type Pack = {
  id: string;
  slug: string;
  nameEn: string;
  nameEl: string;
  credits: number;
  priceCents: number;
  listPriceCents: number | null;
  discountLabelEn: string | null;
  discountLabelEl: string | null;
  basePriceCents: number;
  priceEdited: boolean;
};

type DeskPack = {
  id: string;
  slug: string;
  nameEn: string;
  nameEl: string;
  credits: number;
  priceCents: number;
  validityDays: number;
  active: boolean;
  group: string;
  kind: string;
  editedAt: string | null;
};

type PackDraft = {
  nameEn: string;
  nameEl: string;
  credits: string;
  priceEuros: string;
  validityDays: string;
  group: string;
};

const EMPTY_PACK: PackDraft = {
  nameEn: "",
  nameEl: "",
  credits: "10",
  priceEuros: "150",
  validityDays: "90",
  group: "month",
};

type Promo = {
  id: string;
  code: string;
  kind: "PERCENT" | "FLAT";
  value: number;
  packageId: string | null;
  active: boolean;
  validFrom: string | null;
  validUntil: string | null;
  maxUses: number | null;
  uses: number;
  state: "LIVE" | "OFF" | "SCHEDULED" | "EXPIRED" | "USED_UP";
};

type Rule = {
  id: string;
  packageId: string | null;
  kind: "PERCENT" | "FLAT";
  value: number;
  labelEn: string;
};

export function PricingPanel({
  packs,
  onNotice,
}: {
  packs: Pack[];
  onNotice: (s: string) => void;
}) {
  const { t, locale, fmtMoney, fmtSessions, fmtShortDate } = useI18n();
  const d = t.desk;
  const router = useRouter();
  /* Pack names in the language the desk is reading. */
  const name = (p: { nameEn: string; nameEl: string }) =>
    locale === "el" ? p.nameEl : p.nameEn;

  const [rules, setRules] = useState<Rule[]>([]);
  const [scope, setScope] = useState<string>("");
  const [kind, setKind] = useState<"PERCENT" | "FLAT">("PERCENT");
  const [value, setValue] = useState("20");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  /* Every pack, on sale or not, with the row being edited. */
  const [deskPacks, setDeskPacks] = useState<DeskPack[]>([]);
  const [editingPack, setEditingPack] = useState<string | "new" | null>(null);
  const [packDraft, setPackDraft] = useState<PackDraft>(EMPTY_PACK);

  /* Promo codes. */
  const [codes, setCodes] = useState<Promo[]>([]);
  const [pCode, setPCode] = useState("");
  const [pKind, setPKind] = useState<"PERCENT" | "FLAT">("PERCENT");
  const [pValue, setPValue] = useState("10");
  const [pScope, setPScope] = useState("");
  const [pFrom, setPFrom] = useState("");
  const [pUntil, setPUntil] = useState("");
  const [pMax, setPMax] = useState("");

  const load = useCallback(async () => {
    const [r, c, k] = await Promise.all([
      fetch("/api/admin/pricing"),
      fetch("/api/admin/promo"),
      fetch("/api/admin/packs"),
    ]);
    if (r.ok) {
      const data = (await r.json()) as { rules: Rule[] };
      setRules(data.rules ?? []);
    }
    if (c.ok) {
      const data = (await c.json()) as { codes: Promo[] };
      setCodes(data.codes ?? []);
    }
    if (k.ok) {
      const data = (await k.json()) as { packs: DeskPack[] };
      setDeskPacks(data.packs ?? []);
    }
  }, []);

  function editPack(p: DeskPack) {
    setEditingPack(p.id);
    setPackDraft({
      nameEn: p.nameEn,
      nameEl: p.nameEl,
      credits: String(p.credits),
      priceEuros: (p.priceCents / 100).toFixed(p.priceCents % 100 ? 2 : 0),
      validityDays: String(p.validityDays),
      group: p.group,
    });
  }

  async function savePack() {
    setBusy("pack");
    try {
      const payload = {
        nameEn: packDraft.nameEn,
        nameEl: packDraft.nameEl || packDraft.nameEn,
        credits: Number(packDraft.credits),
        priceCents: Math.round(Number(packDraft.priceEuros.replace(",", ".")) * 100),
        validityDays: Number(packDraft.validityDays),
        group: packDraft.group,
      };
      const res = await fetch("/api/admin/packs", {
        method: editingPack === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingPack === "new" ? payload : { id: editingPack, ...payload }),
      });
      const data = (await res.json()) as { error?: string; packs?: DeskPack[] };
      if (data.error) {
        onNotice(d.packBad);
        return;
      }
      if (data.packs) setDeskPacks(data.packs);
      setEditingPack(null);
      onNotice(editingPack === "new" ? d.packCreated : d.packSaved);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function togglePack(p: DeskPack) {
    setBusy(`pack-${p.id}`);
    try {
      const res = await fetch("/api/admin/packs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, active: !p.active }),
      });
      const data = (await res.json()) as { packs?: DeskPack[] };
      if (data.packs) setDeskPacks(data.packs);
      onNotice(d.packSaved);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const groupLabel = (g: string) =>
    g === "single"
      ? d.packGroupSingle
      : g === "quarter"
        ? d.packGroupQuarter
        : g === "personal"
          ? d.packGroupPersonal
          : g === "half" || g === "nine"
            ? g === "half"
              ? "6 months"
              : "9 months"
            : d.packGroupMonth;

  async function createCode() {
    setBusy("promo");
    try {
      const raw = Number(pValue.replace(",", "."));
      const res = await fetch("/api/admin/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: pCode,
          kind: pKind,
          value: pKind === "PERCENT" ? Math.round(raw) : Math.round(raw * 100),
          packageId: pScope || null,
          validFrom: pFrom || null,
          validUntil: pUntil || null,
          maxUses: pMax ? Number(pMax) : null,
        }),
      });
      const data = (await res.json()) as { error?: string; codes?: Promo[] };
      if (data.error) {
        onNotice(data.error === "EXISTS" ? d.promoExists : d.promoBad);
        return;
      }
      setCodes(data.codes ?? []);
      setPCode("");
      onNotice(d.promoCreated);
    } finally {
      setBusy(null);
    }
  }

  async function togglePromo(c: Promo) {
    setBusy(c.id);
    try {
      const res = await fetch("/api/admin/promo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, active: !c.active }),
      });
      const data = (await res.json()) as { codes?: Promo[] };
      if (data.codes) setCodes(data.codes);
    } finally {
      setBusy(null);
    }
  }

  async function deletePromo(c: Promo) {
    setBusy(c.id);
    try {
      const res = await fetch(`/api/admin/promo?id=${c.id}`, { method: "DELETE" });
      const data = (await res.json()) as { codes?: Promo[] };
      if (data.codes) setCodes(data.codes);
      onNotice(d.promoDeleted);
    } finally {
      setBusy(null);
    }
  }

  const stateLabel = (c: Promo) =>
    c.state === "LIVE"
      ? d.promoActive
      : c.state === "OFF"
        ? d.promoInactive
        : c.state === "SCHEDULED"
          ? d.promoScheduled
          : c.state === "EXPIRED"
            ? d.promoExpired
            : d.promoUsedUp;

  useEffect(() => {
    void load();
  }, [load]);

  const packForm = (
    <div className="rounded-2xl border border-mocha-300 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="label">{d.packNameEn}</span>
          <input
            value={packDraft.nameEn}
            onChange={(e) => setPackDraft({ ...packDraft, nameEn: e.target.value })}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">{d.packNameEl}</span>
          <input
            value={packDraft.nameEl}
            onChange={(e) => setPackDraft({ ...packDraft, nameEl: e.target.value })}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">{d.packGroup}</span>
          <select
            value={packDraft.group}
            onChange={(e) => setPackDraft({ ...packDraft, group: e.target.value })}
            className="input"
          >
            <option value="single">{d.packGroupSingle}</option>
            <option value="month">{d.packGroupMonth}</option>
            <option value="quarter">{d.packGroupQuarter}</option>
            <option value="personal">{d.packGroupPersonal}</option>
          </select>
        </label>
        <label className="block">
          <span className="label">{d.packSessions}</span>
          <input
            value={packDraft.credits}
            onChange={(e) => setPackDraft({ ...packDraft, credits: e.target.value })}
            inputMode="numeric"
            className="input lining-nums tabular-nums"
          />
        </label>
        <label className="block">
          <span className="label">{d.packDays}</span>
          <input
            value={packDraft.validityDays}
            onChange={(e) => setPackDraft({ ...packDraft, validityDays: e.target.value })}
            inputMode="numeric"
            className="input lining-nums tabular-nums"
          />
        </label>
        <label className="block">
          <span className="label">{d.packPrice}</span>
          <input
            value={packDraft.priceEuros}
            onChange={(e) => setPackDraft({ ...packDraft, priceEuros: e.target.value })}
            inputMode="decimal"
            className="input lining-nums tabular-nums"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          size="sm"
          disabled={busy === "pack" || packDraft.nameEn.trim().length < 2}
          onClick={() => void savePack()}
        >
          {busy === "pack" ? t.common.loading : t.common.save}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditingPack(null)}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );

  async function apply() {
    setBusy("apply");
    try {
      const raw = Number(value.replace(",", "."));
      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: scope || null,
          kind,
          /* Percent goes as typed; euros go as cents. */
          value: kind === "PERCENT" ? Math.round(raw) : Math.round(raw * 100),
          labelEn: label || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        onNotice(data.error);
        return;
      }
      onNotice(d.priceApplied);
      await load();
      /* The pack prices on this page come from the server, so a refresh is what
         shows the new numbers — and proves they are the real ones rather than
         arithmetic done in the browser. router.refresh() rather than a reload,
         so the desk stays on this tab instead of being thrown back to Today. */
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function clear(all: boolean, packageId?: string | null) {
    setBusy(all ? "clear" : (packageId ?? "list"));
    try {
      const q = all
        ? "all=1"
        : packageId
          ? `packageId=${packageId}`
          : "";
      await fetch(`/api/admin/pricing?${q}`, { method: "DELETE" });
      onNotice(d.priceCleared);
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const listRule = rules.find((r) => r.packageId === null);

  return (
    <div className="mt-10 space-y-6">
      {/* ---------------------------------------------------------- packs */}
      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[10px] uppercase tracking-brand text-clay">
            {d.packTitle}
          </p>
          {editingPack !== "new" && (
            <Button
              size="sm"
              onClick={() => {
                setEditingPack("new");
                setPackDraft(EMPTY_PACK);
              }}
            >
              {d.packNew}
            </Button>
          )}
        </div>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-clay">
          {d.packHelp}
        </p>

        {editingPack === "new" && <div className="mt-6">{packForm}</div>}

        <ul className="mt-5 divide-y divide-mocha-200/70">
          {deskPacks.map((p) => (
            <li key={p.id} className="py-3">
              {editingPack === p.id ? (
                packForm
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span
                    className={cn(
                      "text-[14px]",
                      p.active ? "text-mocha-600" : "text-clay line-through",
                    )}
                  >
                    {name(p)}
                    <span className="ml-3 text-[12px] text-clay no-underline">
                      {fmtSessions(p.credits)} · {p.validityDays} {t.pricingPage.days}
                    </span>
                    <span className="ml-3 rounded-full bg-mocha-100 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mocha-500">
                      {groupLabel(p.group)}
                    </span>
                    {!p.active && (
                      <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#8a6f1a]">
                        {d.packOff}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="lining-nums tabular-nums text-mocha-600">
                      {fmtMoney(p.priceCents)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => editPack(p)}>
                      {d.teamEdit}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === `pack-${p.id}`}
                      onClick={() => void togglePack(p)}
                    >
                      {p.active ? d.packSwitchOff : d.packSwitchOn}
                    </Button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* ---------------------------------------------------- promo codes */}
      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <p className="text-[10px] uppercase tracking-brand text-clay">
          {d.promoTitle}
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-clay">
          {d.promoHelp}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label">{d.promoCode}</span>
            <input
              value={pCode}
              onChange={(e) => setPCode(e.target.value.toUpperCase())}
              placeholder="WELCOME10"
              className="input uppercase tracking-widest"
            />
          </label>
          <label className="block">
            <span className="label">{d.promoKind}</span>
            <select
              value={pKind}
              onChange={(e) => setPKind(e.target.value as "PERCENT" | "FLAT")}
              className="input"
            >
              <option value="PERCENT">{d.pricePercent}</option>
              <option value="FLAT">{d.priceFlat}</option>
            </select>
          </label>
          <label className="block">
            <span className="label">{d.promoValue}</span>
            <input
              value={pValue}
              onChange={(e) => setPValue(e.target.value)}
              inputMode="decimal"
              className="input lining-nums tabular-nums"
            />
          </label>
          <label className="block">
            <span className="label">{d.priceScope}</span>
            <select
              value={pScope}
              onChange={(e) => setPScope(e.target.value)}
              className="input"
            >
              <option value="">{d.priceAll}</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {name(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{d.promoFrom}</span>
            <input
              type="date"
              value={pFrom}
              onChange={(e) => setPFrom(e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="label">{d.promoUntil}</span>
            <input
              type="date"
              value={pUntil}
              onChange={(e) => setPUntil(e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="label">{d.promoMaxUses}</span>
            <input
              value={pMax}
              onChange={(e) => setPMax(e.target.value)}
              inputMode="numeric"
              placeholder={d.promoMaxUsesHelp}
              className="input lining-nums tabular-nums"
            />
          </label>
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={busy === "promo" || pCode.trim().length < 3}
              onClick={() => void createCode()}
            >
              {busy === "promo" ? t.common.loading : d.promoCreate}
            </Button>
          </div>
        </div>

        {codes.length === 0 ? (
          <p className="mt-6 text-sm text-clay">{d.promoNone}</p>
        ) : (
          <ul className="mt-6 divide-y divide-mocha-200/70">
            {codes.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[14px] tracking-widest text-mocha-600">
                    {c.code}
                  </span>
                  <span className="text-[12px] text-clay">
                    {c.kind === "PERCENT" ? `${c.value}%` : fmtMoney(c.value)}
                    {c.packageId
                      ? ` · ${name(packs.find((p) => p.id === c.packageId) ?? packs[0])}`
                      : ""}
                  </span>
                  <span className="text-[11px] text-clay">
                    {c.validFrom ? fmtShortDate(c.validFrom) : "…"}
                    {" → "}
                    {c.validUntil ? fmtShortDate(c.validUntil) : "…"}
                  </span>
                  <span className="text-[11px] text-clay">
                    {d.promoUses.replace(
                      "{n}",
                      c.maxUses ? `${c.uses}/${c.maxUses}` : String(c.uses),
                    )}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest",
                      c.state === "LIVE"
                        ? "bg-mocha-600 text-cream"
                        : "bg-mocha-100 text-mocha-500",
                    )}
                  >
                    {stateLabel(c)}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === c.id}
                    onClick={() => void togglePromo(c)}
                  >
                    {c.active ? d.promoDisable : d.promoEnable}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === c.id}
                    onClick={() => void deletePromo(c)}
                  >
                    {d.promoDelete}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------------------------------------------------- offers */}
      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <p className="text-[10px] uppercase tracking-brand text-clay">
          {d.priceTitle}
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-clay">
          {d.priceHelp}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label">{d.priceScope}</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="input"
            >
              <option value="">{d.priceAll}</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {name(p)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label">{d.priceKind}</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "PERCENT" | "FLAT")}
              className="input"
            >
              <option value="PERCENT">{d.pricePercent}</option>
              <option value="FLAT">{d.priceFlat}</option>
            </select>
          </label>

          <label className="block">
            <span className="label">{d.priceValue}</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              className="input lining-nums tabular-nums"
            />
          </label>

          <label className="block">
            <span className="label">{d.priceLabel}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Summer offer"
              className="input"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="sm" disabled={busy === "apply"} onClick={apply}>
            {busy === "apply" ? t.common.loading : d.priceApply}
          </Button>
          {rules.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "clear"}
              onClick={() => void clear(true)}
            >
              {d.priceClear}
            </Button>
          )}
        </div>
      </div>

      {/* what it does to the list */}
      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[10px] uppercase tracking-brand text-clay">
            {d.priceLive}
          </p>
          {listRule && (
            <p className="text-[11px] text-clay">
              {d.priceAll}:{" "}
              {listRule.kind === "PERCENT"
                ? `${listRule.value}%`
                : fmtMoney(listRule.value)}
            </p>
          )}
        </div>

        {rules.length === 0 && (
          <p className="mt-5 text-sm text-clay">{d.priceNone}</p>
        )}

        <ul className="mt-5 divide-y divide-mocha-200/70">
          {packs.map((p) => {
            const own = rules.find((r) => r.packageId === p.id);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span className="text-[14px] text-mocha-600">
                  {name(p)}
                  <span className="ml-3 text-[12px] text-clay">
                    {fmtSessions(p.credits)}
                  </span>
                  {own && (
                    <span className="ml-3 rounded-full bg-mocha-100 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mocha-500">
                      {own.kind === "PERCENT"
                        ? `${own.value}%`
                        : fmtMoney(own.value)}
                    </span>
                  )}
                </span>

                <span className="flex items-center gap-4">
                  <span className="lining-nums tabular-nums">
                    {p.listPriceCents ? (
                      <>
                        <span className="text-clay line-through">
                          {fmtMoney(p.listPriceCents)}
                        </span>
                        <span className="ml-2 text-mocha-600">
                          {fmtMoney(p.priceCents)}
                        </span>
                      </>
                    ) : (
                      <span className="text-mocha-600">
                        {fmtMoney(p.priceCents)}
                      </span>
                    )}
                  </span>
                  {p.listPriceCents && (
                    <span
                      className={cn(
                        "rounded-full bg-gold/15 px-2.5 py-1 text-[10px] uppercase tracking-widest text-[#8a6f1a]",
                      )}
                    >
                      {p.discountLabelEn}
                    </span>
                  )}
                  {own && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === p.id}
                      onClick={() => void clear(false, p.id)}
                    >
                      {t.common.cancel}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
