import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { instructors, type Instructor } from "@/db/schema";

/**
 * The team, managed from the desk.
 *
 * Instructors are never deleted: past classes and bookings point at whoever
 * taught them, and a member's history is not ours to rewrite. "Removing"
 * somebody switches them off, which takes them off the studio page and out of
 * the instructor pickers at once; "putting them back" switches them on again
 * with their bio intact.
 */

export type TeamMember = Pick<
  Instructor,
  | "id"
  | "name"
  | "bioEn"
  | "bioEl"
  | "bioRu"
  | "photoUrl"
  | "active"
  | "sortOrder"
  | "editedAt"
>;

export function listTeam(): TeamMember[] {
  return db
    .select({
      id: instructors.id,
      name: instructors.name,
      bioEn: instructors.bioEn,
      bioEl: instructors.bioEl,
      bioRu: instructors.bioRu,
      photoUrl: instructors.photoUrl,
      active: instructors.active,
      sortOrder: instructors.sortOrder,
      editedAt: instructors.editedAt,
    })
    .from(instructors)
    .orderBy(asc(instructors.active), asc(instructors.sortOrder), asc(instructors.name))
    .all()
    /* Active first, then hidden. */
    .sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder);
}

export type TeamPatch = {
  name?: string;
  bioEn?: string;
  bioEl?: string;
  bioRu?: string;
  photoUrl?: string | null;
  active?: boolean;
  sortOrder?: number;
};

export type TeamResult =
  | { ok: true; member: TeamMember }
  | { ok: false; code: "BAD_NAME" | "NAME_TAKEN" | "NOT_FOUND" | "BAD_PHOTO" };

const NAME_MAX = 60;
const BIO_MAX = 600;

function cleanName(raw: unknown) {
  return String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
}
function cleanBio(raw: unknown) {
  return String(raw ?? "").trim().slice(0, BIO_MAX);
}
/** A site path (/team/x.jpg) or an https address; anything else is refused. */
function cleanPhoto(raw: unknown): string | null | false {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//") && v.length < 300) return v;
  if (/^https:\/\/[^\s]+$/i.test(v) && v.length < 500) return v;
  return false;
}

function nameTaken(name: string, exceptId?: string) {
  const rows = db
    .select({ id: instructors.id, name: instructors.name })
    .from(instructors)
    .all();
  return rows.some(
    (r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase(),
  );
}

export function addTeamMember(input: TeamPatch): TeamResult {
  const name = cleanName(input.name);
  if (name.length < 2) return { ok: false, code: "BAD_NAME" };
  if (nameTaken(name)) return { ok: false, code: "NAME_TAKEN" };
  const photo = cleanPhoto(input.photoUrl);
  if (photo === false) return { ok: false, code: "BAD_PHOTO" };

  const last = db
    .select({ sortOrder: instructors.sortOrder })
    .from(instructors)
    .all()
    .reduce((m, r) => Math.max(m, r.sortOrder), 0);

  const row = db
    .insert(instructors)
    .values({
      name,
      bioEn: cleanBio(input.bioEn),
      bioEl: cleanBio(input.bioEl),
      bioRu: cleanBio(input.bioRu),
      photoUrl: photo,
      active: input.active ?? true,
      sortOrder: last + 1,
      editedAt: new Date(),
    })
    .returning()
    .get();
  return { ok: true, member: row };
}

export function updateTeamMember(id: string, patch: TeamPatch): TeamResult {
  const existing = db.select().from(instructors).where(eq(instructors.id, id)).get();
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  const set: Partial<typeof instructors.$inferInsert> = { editedAt: new Date() };

  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (name.length < 2) return { ok: false, code: "BAD_NAME" };
    if (nameTaken(name, id)) return { ok: false, code: "NAME_TAKEN" };
    set.name = name;
  }
  if (patch.bioEn !== undefined) set.bioEn = cleanBio(patch.bioEn);
  if (patch.bioEl !== undefined) set.bioEl = cleanBio(patch.bioEl);
  if (patch.bioRu !== undefined) set.bioRu = cleanBio(patch.bioRu);
  if (patch.photoUrl !== undefined) {
    const photo = cleanPhoto(patch.photoUrl);
    if (photo === false) return { ok: false, code: "BAD_PHOTO" };
    set.photoUrl = photo;
  }
  if (patch.active !== undefined) set.active = Boolean(patch.active);
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    set.sortOrder = Math.round(patch.sortOrder);
  }

  const row = db
    .update(instructors)
    .set(set)
    .where(eq(instructors.id, id))
    .returning()
    .get();
  return { ok: true, member: row };
}
