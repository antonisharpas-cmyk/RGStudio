import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { classTypes, creditPackages, instructors } from "@/db/schema";
import { repairCatalogueOnce } from "./catalogue-repair";
import { reconcileRosterOnce } from "./roster";
import { groupOf, INSTRUCTOR_PHOTOS, type PackGroup } from "./packs";
import { priceList } from "@/lib/pricing";

export async function getClassTypes() {
  return db
    .select()
    .from(classTypes)
    .where(eq(classTypes.active, true))
    .orderBy(asc(classTypes.sortOrder));
}

export async function getClassType(slug: string) {
  return db
    .select()
    .from(classTypes)
    .where(and(eq(classTypes.slug, slug), eq(classTypes.active, true)))
    .get();
}

export async function getPackages() {
  /* Drop anything the studio no longer sells before listing. */
  repairCatalogueOnce();

  const packs = await db
    .select()
    .from(creditPackages)
    .where(eq(creditPackages.active, true))
    .orderBy(asc(creditPackages.sortOrder));

  /* Priced here, once, so the list, the checkout and the amount charged can
     never disagree about what an offer is worth. See lib/pricing.ts. */
  /* A desk created pack carries its own heading; a code pack takes it from
     the price list in packs.ts. */
  return priceList(packs).map((p) => ({
    ...p,
    group: (p.group as PackGroup | null) ?? groupOf(p.slug),
  }));
}

export async function getPackageById(id: string) {
  const pack = db
    .select()
    .from(creditPackages)
    .where(eq(creditPackages.id, id))
    .get();
  return pack ? priceList([pack])[0] : undefined;
}

export async function getInstructors() {
  /* Bring the roster in line with the studio's real team before reading it, so
     placeholders from an earlier seed drop off without needing a re-seed. */
  reconcileRosterOnce();

  const rows = await db
    .select()
    .from(instructors)
    .where(eq(instructors.active, true))
    .orderBy(asc(instructors.sortOrder));

  /* A row's own photo wins; otherwise fall back to the portrait shipped with
     the site, so the team cards have faces without needing a re-seed. */
  return rows.map((r) => ({
    ...r,
    photoUrl: r.photoUrl || INSTRUCTOR_PHOTOS[r.name] || null,
  }));
}

/** By the slug that appears in a URL — /checkout?pack=month-2. */
export async function getPackageBySlug(slug: string) {
  repairCatalogueOnce();

  const pack = db
    .select()
    .from(creditPackages)
    .where(eq(creditPackages.slug, slug))
    .get();
  return pack ? priceList([pack])[0] : undefined;
}
