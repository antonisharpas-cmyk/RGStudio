"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * The team, from the desk. The owner's tab.
 *
 * Whoever is here and switched on is on the studio page and in the instructor
 * pickers. Nobody is ever deleted: switching somebody off takes them off the
 * site and keeps their name on the classes they taught.
 */

type Member = {
  id: string;
  name: string;
  bioEn: string;
  bioEl: string;
  bioRu: string;
  photoUrl: string | null;
  active: boolean;
  sortOrder: number;
};

type Draft = {
  name: string;
  bioEn: string;
  bioEl: string;
  bioRu: string;
  photoUrl: string;
};

const EMPTY: Draft = { name: "", bioEn: "", bioEl: "", bioRu: "", photoUrl: "" };

export function TeamPanel({ onNotice }: { onNotice: (s: string) => void }) {
  const { t } = useI18n();
  const d = t.desk;
  const router = useRouter();

  const [team, setTeam] = useState<Member[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/team");
    if (!res.ok) return;
    const data = (await res.json()) as { team: Member[] };
    setTeam(data.team ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(m: Member) {
    setEditing(m.id);
    setDraft({
      name: m.name,
      bioEn: m.bioEn,
      bioEl: m.bioEl,
      bioRu: m.bioRu,
      photoUrl: m.photoUrl ?? "",
    });
  }

  function startNew() {
    setEditing("new");
    setDraft(EMPTY);
  }

  async function call(method: string, payload?: unknown, query = "") {
    const res = await fetch(`/api/admin/team${query}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = (await res.json()) as { error?: string; team?: Member[] };
    if (!res.ok) {
      const known: Record<string, string> = {
        NAME_TAKEN: d.teamNameTaken,
        BAD_NAME: d.teamName,
        BAD_PHOTO: d.teamPhotoHelp,
      };
      onNotice(known[data.error ?? ""] ?? data.error ?? t.common.somethingWrong);
      return false;
    }
    if (data.team) setTeam(data.team);
    /* The studio page is server rendered from the same table, so a refresh is
       what proves the change landed there too. */
    router.refresh();
    return true;
  }

  async function save() {
    setBusy("save");
    try {
      const ok =
        editing === "new"
          ? await call("POST", draft)
          : await call("PATCH", { id: editing, ...draft });
      if (ok) {
        onNotice(d.teamSaved);
        setEditing(null);
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggle(m: Member) {
    setBusy(m.id);
    try {
      const ok = m.active
        ? await call("DELETE", undefined, `?id=${m.id}`)
        : await call("PATCH", { id: m.id, active: true });
      if (ok) onNotice(m.active ? d.teamRemoved : d.teamSaved);
    } finally {
      setBusy(null);
    }
  }

  const form = (
    <div className="rounded-3xl border border-mocha-300 bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">{d.teamName}</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="input"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">{d.teamPhoto}</span>
          <input
            value={draft.photoUrl}
            onChange={(e) => setDraft({ ...draft, photoUrl: e.target.value })}
            placeholder="/team/name.jpg"
            className="input"
          />
          <span className="mt-1 block text-[11px] text-clay">{d.teamPhotoHelp}</span>
        </label>
        {(
          [
            ["bioEn", d.teamBioEn],
            ["bioEl", d.teamBioEl],
            ["bioRu", d.teamBioRu],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block sm:col-span-2">
            <span className="label">{label}</span>
            <textarea
              rows={3}
              maxLength={600}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              className="input resize-y"
            />
          </label>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button size="sm" disabled={busy === "save" || draft.name.trim().length < 2} onClick={save}>
          {busy === "save" ? t.common.loading : t.common.save}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mt-10 space-y-6">
      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[10px] uppercase tracking-brand text-clay">{d.teamTitle}</p>
          {editing !== "new" && (
            <Button size="sm" onClick={startNew}>
              {d.teamAdd}
            </Button>
          )}
        </div>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-clay">{d.teamHelp}</p>

        {editing === "new" && <div className="mt-6">{form}</div>}

        {team.length === 0 && editing !== "new" && (
          <p className="mt-5 text-sm text-clay">{d.teamEmpty}</p>
        )}

        <ul className="mt-6 space-y-3">
          {team.map((m) => (
            <li
              key={m.id}
              className={cn(
                "rounded-3xl border p-5",
                m.active ? "border-mocha-200/70 bg-cream" : "border-dashed border-mocha-200/70 bg-white/40",
              )}
            >
              {editing === m.id ? (
                form
              ) : (
                <div className="flex flex-wrap items-start gap-5">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-cream-200">
                    {m.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.photoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center">
                        <Monogram className="h-7 w-7 text-clay/50" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-display text-2xl text-mocha-600">{m.name}</p>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest",
                          m.active ? "bg-mocha-600 text-cream" : "bg-mocha-100 text-mocha-500",
                        )}
                      >
                        {m.active ? d.teamActive : d.teamHidden}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-mocha-500">
                      {m.bioEn || <span className="text-clay">…</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEdit(m)}>
                      {d.teamEdit}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === m.id}
                      onClick={() => void toggle(m)}
                    >
                      {m.active ? d.teamRemove : d.teamRestore}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
