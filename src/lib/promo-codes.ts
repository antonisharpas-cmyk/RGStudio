import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { promoCodes, type PromoCode } from "@/db/schema";

/**
 * Promo codes: a discount for whoever has the code, typed at checkout.
 *
 * Kept apart from `pricing.ts` on purpose. A pricing rule changes the price on
 * the card for everybody; a code changes nothing anybody can see until it is
 * typed, and it carries its own switch, its own dates and its own use count.
 * The two stack in one direction only: a code is applied to whatever the pack
 * costs today, offer included, and never takes the pack below one euro.
 *
 * Codes are stored upper case and matched case insensitively, so "welcome10",
 * "Welcome10" and "WELCOME10" are one code. Spaces are stripped for the same
 * reason: a member reading a code off a story types it however they like.
 */

/** The smallest a pack may get after a code, so a bad code cannot make it free. */
const FLOOR_CENTS = 100;

export type PromoView = {
  id: string;
  code: string;
  kind: "PERCENT" | "FLAT";
  value: number;
  packageId: string | null;
  active: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  maxUses: number | null;
  uses: number;
  createdAt: Date;
  /** What the desk sees at a glance: live, off, not yet, over, used up. */
  state: "LIVE" | "OFF" | "SCHEDULED" | "EXPIRED" | "USED_UP";
};

export function normaliseCode(raw: string) {
  return raw.replace(/\s+/g, "").toUpperCase().slice(0, 32);
}

function stateOf(r: PromoCode, now: Date): PromoView["state"] {
  if (!r.active) return "OFF";
  if (r.maxUses !== null && r.uses >= r.maxUses) return "USED_UP";
  if (r.validFrom && now < r.validFrom) return "SCHEDULED";
  if (r.validUntil && now > r.validUntil) return "EXPIRED";
  return "LIVE";
}

function view(r: PromoCode, now = new Date()): PromoView {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind === "FLAT" ? "FLAT" : "PERCENT",
    value: r.value,
    packageId: r.packageId,
    active: r.active,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
    maxUses: r.maxUses,
    uses: r.uses,
    createdAt: r.createdAt,
    state: stateOf(r, now),
  };
}

export function listPromoCodes(now = new Date()): PromoView[] {
  return db
    .select()
    .from(promoCodes)
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => view(r, now));
}

/** What a code takes off a price, in cents, rounded so the result is whole euros. */
export function discountFor(cents: number, code: Pick<PromoCode, "kind" | "value">) {
  const off =
    code.kind === "PERCENT" ? Math.round((cents * code.value) / 100) : code.value;
  const after = Math.max(FLOOR_CENTS, Math.floor((cents - off) / 100) * 100);
  return Math.max(0, cents - after);
}

export type PromoCheck =
  | { ok: true; code: PromoView; discountCents: number; amountCents: number }
  | { ok: false; reason: "UNKNOWN" | "OFF" | "SCHEDULED" | "EXPIRED" | "USED_UP" | "WRONG_PACK" | "NO_EFFECT" };

/**
 * Is this code good for this pack, right now, and what does it do to the price?
 *
 * Every refusal has its own reason so the desk can be told exactly why a code a
 * member is quoting down the phone does not work; the member is only ever told
 * that it is not valid, because "expired yesterday" and "twenty people got
 * there first" are both invitations to argue at a counter.
 */
export function checkPromo(
  raw: string,
  pack: { id: string; priceCents: number },
  now = new Date(),
): PromoCheck {
  const code = normaliseCode(raw);
  if (!code) return { ok: false, reason: "UNKNOWN" };
  const row = db.select().from(promoCodes).where(eq(promoCodes.code, code)).get();
  if (!row) return { ok: false, reason: "UNKNOWN" };
  const state = stateOf(row, now);
  if (state !== "LIVE") return { ok: false, reason: state };
  if (row.packageId && row.packageId !== pack.id) {
    return { ok: false, reason: "WRONG_PACK" };
  }
  const discountCents = discountFor(pack.priceCents, row);
  if (discountCents <= 0) return { ok: false, reason: "NO_EFFECT" };
  return {
    ok: true,
    code: view(row, now),
    discountCents,
    amountCents: pack.priceCents - discountCents,
  };
}

/**
 * Count a use, once the money has actually arrived.
 *
 * Called from fulfilment rather than from checkout, so an abandoned card form
 * does not spend one of the fifty uses. The guard on `uses < max_uses` is a
 * backstop: two members finishing the last use in the same second is unlikely
 * and this makes it harmless.
 */
export function consumePromo(code: string) {
  const c = normaliseCode(code);
  if (!c) return;
  db.update(promoCodes)
    .set({ uses: sql`${promoCodes.uses} + 1` })
    .where(and(eq(promoCodes.code, c)))
    .run();
}

/* --------------------------------------------------------------- the desk */

export type CreatePromoResult =
  | { ok: true; code: PromoView }
  | { ok: false; code: "EXISTS" | "BAD_CODE" | "BAD_VALUE" | "BAD_DATES" };

export function createPromoCode(args: {
  code: string;
  kind: "PERCENT" | "FLAT";
  value: number;
  packageId?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  maxUses?: number | null;
  staffId: string;
}): CreatePromoResult {
  const code = normaliseCode(args.code);
  if (!/^[A-Z0-9]{3,32}$/.test(code)) return { ok: false, code: "BAD_CODE" };

  const value = Math.round(Number(args.value));
  const sane =
    Number.isFinite(value) &&
    value > 0 &&
    (args.kind === "PERCENT" ? value <= 90 : value <= 50000);
  if (!sane) return { ok: false, code: "BAD_VALUE" };

  if (args.validFrom && args.validUntil && args.validFrom > args.validUntil) {
    return { ok: false, code: "BAD_DATES" };
  }

  const exists = db.select().from(promoCodes).where(eq(promoCodes.code, code)).get();
  if (exists) return { ok: false, code: "EXISTS" };

  const row = db
    .insert(promoCodes)
    .values({
      code,
      kind: args.kind,
      value,
      packageId: args.packageId ?? null,
      validFrom: args.validFrom ?? null,
      validUntil: args.validUntil ?? null,
      maxUses:
        args.maxUses && Number.isFinite(args.maxUses) && args.maxUses > 0
          ? Math.round(args.maxUses)
          : null,
      createdBy: args.staffId,
    })
    .returning()
    .get();
  return { ok: true, code: view(row) };
}

export function setPromoActive(id: string, active: boolean) {
  return db
    .update(promoCodes)
    .set({ active })
    .where(eq(promoCodes.id, id))
    .run().changes;
}

/**
 * Delete a code outright. Purchases that used it keep the code's text on their
 * own row (`purchases.promo_code`), so nothing in the books goes missing.
 */
export function deletePromoCode(id: string) {
  return db.delete(promoCodes).where(eq(promoCodes.id, id)).run().changes;
}
