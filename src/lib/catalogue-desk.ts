import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditPackages, purchases, type CreditPackage } from "@/db/schema";
import { groupOf, type PackGroup } from "./packs";

/**
 * The packs, managed from the desk.
 *
 * `packs.ts` gave the studio its opening price list and still fills an empty
 * database. From the moment the owner edits a pack here, that row is the
 * desk's: the boot sync leaves it alone (see catalogue-repair.ts), and what is
 * on sale, at what price, for how many sessions and how long, is decided on
 * this screen.
 *
 * Packs are never deleted. Purchases and credit batches point at them, and a
 * member's history must keep saying what they bought. Switching a pack off
 * takes it off the pricing page and out of checkout at once.
 */

export type DeskPack = CreditPackage & { group: PackGroup };

export type PackPatch = {
  nameEn?: string;
  nameEl?: string;
  credits?: number;
  priceCents?: number;
  validityDays?: number;
  active?: boolean;
  group?: PackGroup;
  badge?: "POPULAR" | "BEST_VALUE" | null;
  perDayLimit?: number | null;
  kind?: "CLASS" | "PERSONAL" | "DUET";
  seats?: number;
  sortOrder?: number;
};

export type PackResult =
  | { ok: true; pack: DeskPack }
  | { ok: false; code: "NOT_FOUND" | "BAD_NAME" | "BAD_CREDITS" | "BAD_PRICE" | "BAD_DAYS" | "BAD_GROUP" };

const GROUPS: PackGroup[] = ["single", "month", "quarter", "half", "nine", "personal"];

function withGroup(row: CreditPackage): DeskPack {
  return { ...row, group: (row.group as PackGroup | null) ?? groupOf(row.slug) };
}

/** Every pack, on sale or not, for the owner's screen. */
export function listPacks(): DeskPack[] {
  return db
    .select()
    .from(creditPackages)
    .orderBy(asc(creditPackages.sortOrder), asc(creditPackages.nameEn))
    .all()
    .map(withGroup)
    /* On sale first, then withdrawn. */
    .sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder);
}

function clean(patch: PackPatch): PackResult | Partial<typeof creditPackages.$inferInsert> {
  const set: Partial<typeof creditPackages.$inferInsert> = {};
  if (patch.nameEn !== undefined) {
    const v = String(patch.nameEn).trim().slice(0, 80);
    if (v.length < 2) return { ok: false, code: "BAD_NAME" };
    set.nameEn = v;
  }
  if (patch.nameEl !== undefined) set.nameEl = String(patch.nameEl).trim().slice(0, 80);
  if (patch.credits !== undefined) {
    const v = Math.round(Number(patch.credits));
    if (!Number.isFinite(v) || v < 1 || v > 500) return { ok: false, code: "BAD_CREDITS" };
    set.credits = v;
  }
  if (patch.priceCents !== undefined) {
    const v = Math.round(Number(patch.priceCents));
    if (!Number.isFinite(v) || v < 100 || v > 1_000_000) return { ok: false, code: "BAD_PRICE" };
    set.priceCents = v;
    set.priceEditedAt = new Date();
  }
  if (patch.validityDays !== undefined) {
    const v = Math.round(Number(patch.validityDays));
    if (!Number.isFinite(v) || v < 1 || v > 1095) return { ok: false, code: "BAD_DAYS" };
    set.validityDays = v;
  }
  if (patch.active !== undefined) set.active = Boolean(patch.active);
  if (patch.group !== undefined) {
    if (!GROUPS.includes(patch.group)) return { ok: false, code: "BAD_GROUP" };
    set.group = patch.group;
  }
  if (patch.badge !== undefined) {
    set.badge = patch.badge === "POPULAR" || patch.badge === "BEST_VALUE" ? patch.badge : null;
  }
  if (patch.perDayLimit !== undefined) {
    const v = patch.perDayLimit === null ? null : Math.round(Number(patch.perDayLimit));
    set.perDayLimit = v !== null && Number.isFinite(v) && v > 0 ? v : null;
  }
  if (patch.kind !== undefined) {
    set.kind = patch.kind === "PERSONAL" || patch.kind === "DUET" ? patch.kind : "CLASS";
    if (patch.seats === undefined) set.seats = set.kind === "DUET" ? 2 : 1;
  }
  if (patch.seats !== undefined) {
    const v = Math.round(Number(patch.seats));
    set.seats = v === 2 ? 2 : 1;
  }
  if (patch.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))) {
    set.sortOrder = Math.round(Number(patch.sortOrder));
  }
  return set;
}

export function updatePack(id: string, patch: PackPatch): PackResult {
  const existing = db.select().from(creditPackages).where(eq(creditPackages.id, id)).get();
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  const set = clean(patch);
  if ("ok" in set) return set;

  /* Stamp the row as the desk's, and keep its heading explicit from now on so
     a later rename of the code list cannot move it. */
  set.editedAt = new Date();
  if (set.group === undefined) set.group = existing.group ?? groupOf(existing.slug);

  const row = db
    .update(creditPackages)
    .set(set)
    .where(eq(creditPackages.id, id))
    .returning()
    .get();
  return { ok: true, pack: withGroup(row) };
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "SOLD" };

/**
 * Delete a pack, but only one nobody has ever bought.
 *
 * A pack with a purchase against it stays, off sale, because members' history
 * and invoices point at it and must keep saying what was bought. A pack made
 * by mistake and never sold can simply go. Offers scoped to it go with it and
 * promo codes scoped to it fall back to the whole list (the schema says so).
 */
export function deletePack(id: string): DeleteResult {
  const existing = db.select({ id: creditPackages.id }).from(creditPackages).where(eq(creditPackages.id, id)).get();
  if (!existing) return { ok: false, code: "NOT_FOUND" };
  const sold = db
    .select({ n: sql<number>`count(*)` })
    .from(purchases)
    .where(eq(purchases.packageId, id))
    .get();
  if (sold && sold.n > 0) return { ok: false, code: "SOLD" };
  db.delete(creditPackages).where(eq(creditPackages.id, id)).run();
  return { ok: true };
}

export function createPack(input: PackPatch): PackResult {
  const set = clean({
    kind: "CLASS",
    seats: 1,
    group: "month",
    badge: null,
    perDayLimit: null,
    ...input,
  });
  if ("ok" in set) return set;
  if (!set.nameEn) return { ok: false, code: "BAD_NAME" };
  if (!set.credits) return { ok: false, code: "BAD_CREDITS" };
  if (!set.priceCents) return { ok: false, code: "BAD_PRICE" };
  if (!set.validityDays) return { ok: false, code: "BAD_DAYS" };

  const last = db
    .select({ sortOrder: creditPackages.sortOrder })
    .from(creditPackages)
    .all()
    .reduce((m, r) => Math.max(m, r.sortOrder), 0);

  const row = db
    .insert(creditPackages)
    .values({
      slug: `desk-${crypto.randomUUID().slice(0, 8)}`,
      nameEn: set.nameEn,
      nameEl: set.nameEl || set.nameEn,
      credits: set.credits,
      priceCents: set.priceCents,
      validityDays: set.validityDays,
      badge: set.badge ?? null,
      kind: set.kind ?? "CLASS",
      perDayLimit: set.perDayLimit ?? null,
      seats: set.seats ?? 1,
      active: set.active ?? true,
      sortOrder: last + 1,
      group: set.group ?? "month",
      editedAt: new Date(),
      priceEditedAt: new Date(),
    })
    .returning()
    .get();
  return { ok: true, pack: withGroup(row) };
}
