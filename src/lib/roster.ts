import { sqlite } from "@/db";

/**
 * The studio's opening team, as shipped with the site.
 *
 * From the day the site goes live the team is managed from the desk (the
 * owner's Team tab) and the database is the truth: the desk adds, edits and
 * hides instructors, and the studio page reads whoever is active. This list is
 * only what an empty database starts with, see reconcileRoster below.
 *
 * `name` should match the schedule in `lib/rota.ts`: the schedule names who
 * teaches each hour, and the reconcile below is what turns those names into
 * the ids the templates and classes carry. A name the rota uses that is not
 * an active instructor simply leaves that hour unassigned; the desk can put
 * somebody on it from the Bookings tab.
 */
export type RosterMember = {
  name: string;
  bioEn: string;
  bioEl: string;
  bioRu: string;
  photoUrl: string;
  sortOrder: number;
};

export const INSTRUCTOR_ROSTER: readonly RosterMember[] = [
  /* TODO: the two names below are placeholders: Andrea is thanked by name in RG's reviews, Maria was given by the studio.
     Confirm the full team, their bios and their photographs with the studio,
     and drop the portraits into public/team/. An empty photoUrl shows the
     studio's mark in place of a portrait. */
  {
    name: "Andrea",
    bioEn:
      "Andrea is the person most members meet first. Friendly, patient and precise, she sets your springs and your pace so your first class feels like it was built for you, and she keeps that attention on your fiftieth.",
    bioEl:
      "Η Andrea είναι το πρόσωπο που συναντούν πρώτα τα περισσότερα μέλη. Φιλική, υπομονετική και ακριβής, ρυθμίζει τα ελατήρια και τον ρυθμό σου ώστε το πρώτο μάθημα να νιώθει φτιαγμένο για εσένα, και κρατά την ίδια προσοχή και στο πεντηκοστό.",
    bioRu:
      "Андреа первая, кого встречают большинство участников. Дружелюбная, терпеливая и точная, она подбирает пружины и темп так, чтобы первое занятие казалось созданным для вас, и сохраняет то же внимание на пятидесятом.",
    photoUrl: "",
    sortOrder: 1,
  },
  {
    name: "Maria",
    bioEn:
      "Maria takes the time to make sure every position is right for the body in front of her. Calm and quietly demanding, she meets you at your level and moves you on from there, one clear cue at a time.",
    bioEl:
      "Η Maria αφιερώνει χρόνο ώστε κάθε θέση να είναι σωστή για το σώμα που έχει μπροστά της. Ήρεμη και διακριτικά απαιτητική, σε συναντά στο επίπεδό σου και σε εξελίσσει από εκεί, με μία σαφή οδηγία τη φορά.",
    bioRu:
      "Мария не торопится и следит, чтобы каждое положение подходило именно тому телу, что перед ней. Спокойная и негромко требовательная, она встречает вас на вашем уровне и ведёт дальше, по одной ясной подсказке за раз.",
    photoUrl: "",
    sortOrder: 2,
  },
] as const;

/**
 * Make sure the studio has a team on the first boot, and hand back a
 * name → id map for whoever needs to turn a schedule name into a row.
 *
 * **The database is the truth; this file is only the starting point.** The
 * owner manages the team from the desk (Team tab): adding, editing, hiding.
 * So this no longer forces the table to match the list above. It does three
 * quiet things:
 *
 *   - an empty table is filled from the roster, so a fresh install has a team,
 *     and each seeded row remembers its roster key;
 *   - nobody is ever re-added: a roster member the desk renamed or deleted
 *     stays that way, and the rota finds a renamed one by roster key;
 *   - a roster member the desk has never touched (`edited_at` is null) has its
 *     bio and photo refreshed from here, so a copy fix in the repo still lands.
 *
 * It never deactivates anybody and never overwrites a row the desk has edited.
 * The map returned covers every *active* instructor, desk-made ones included.
 */
export function reconcileRoster(): Map<string, string> {
  const map = new Map<string, string>();

  const hasTable = sqlite
    .prepare(
      "select name from sqlite_master where type='table' and name='instructors'",
    )
    .get();
  if (!hasTable) return map;

  sqlite.transaction(() => {
    /* Rows seeded before roster_key existed: tag them by name, once. */
    const tag = sqlite.prepare(
      "update instructors set roster_key = ? where name = ? and roster_key is null",
    );
    const byKey = sqlite.prepare(
      "select id, edited_at from instructors where roster_key = ? limit 1",
    );
    const insert = sqlite.prepare(
      `insert into instructors (id, name, bio_en, bio_el, bio_ru, photo_url, active, sort_order, roster_key)
       values (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    const refresh = sqlite.prepare(
      `update instructors
          set photo_url = ?, sort_order = ?, bio_en = ?, bio_el = ?, bio_ru = ?
        where id = ? and edited_at is null`,
    );

    /* Only a brand new install is filled from the roster. Once the studio has
       a team, the desk owns it: a roster member renamed or deleted from the
       Team tab must stay renamed or deleted, not come back on the next boot. */
    const empty =
      (sqlite.prepare("select count(*) as n from instructors").get() as { n: number }).n === 0;
    const anyTagged =
      (sqlite.prepare("select count(*) as n from instructors where roster_key is not null").get() as { n: number }).n > 0;

    for (const m of INSTRUCTOR_ROSTER) {
      if (!anyTagged) tag.run(m.name, m.name);
      const row = byKey.get(m.name) as { id: string; edited_at: number | null } | undefined;
      if (row) {
        refresh.run(m.photoUrl || null, m.sortOrder, m.bioEn, m.bioEl, m.bioRu, row.id);
      } else if (empty) {
        insert.run(
          crypto.randomUUID(),
          m.name,
          m.bioEn,
          m.bioEl,
          m.bioRu,
          m.photoUrl || null,
          m.sortOrder,
          m.name,
        );
      }
    }

    /* Every active instructor by name, and roster members also by their
       roster key, so the rota still finds "Andrea" after a rename. */
    const active = sqlite
      .prepare("select id, name, roster_key from instructors where active = 1")
      .all() as { id: string; name: string; roster_key: string | null }[];
    for (const r of active) {
      map.set(r.name, r.id);
      if (r.roster_key) map.set(r.roster_key, r.id);
    }
  })();

  return map;
}

let done = false;

/** Reconcile once per process, for read paths that only need it done. */
export function reconcileRosterOnce() {
  if (done) return;
  done = true;
  try {
    reconcileRoster();
  } catch (err) {
    /* A roster that fails to reconcile must not take the page down: the old
       names showing is better than a 500. */
    console.error("[roster] reconcile failed", err);
  }
}
