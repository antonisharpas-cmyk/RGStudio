"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Monogram } from "@/components/ui/Monogram";
import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * The team, from the desk. The owner's tab.
 *
 * Whoever is here and switched on is on the studio page and in the instructor
 * pickers. Hide takes somebody off the site and keeps their name on the
 * classes they taught; Delete removes them for good.
 */

/** Centre crop to a square and shrink, so an upload is small and card shaped. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const EDGE = 900;
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(EDGE, side);
  canvas.height = canvas.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
    if (blob && blob.size <= 580 * 1024) return blob;
  }
  throw new Error("too large");
}

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
  /* A picked photo waits here until Save, so a new instructor can have one
     too (the upload needs the row's id, which exists only after saving). */
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(null);
    setDropPhoto(false);
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await shrinkPhoto(file);
      clearPhoto();
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch {
      onNotice(d.teamPhotoBad);
    }
  }

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
    clearPhoto();
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
    clearPhoto();
    setEditing("new");
    setDraft(EMPTY);
  }

  async function call(method: string, payload?: unknown, query = "") {
    const res = await fetch(`/api/admin/team${query}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      team?: Member[];
      member?: Member;
    };
    if (!res.ok) {
      const known: Record<string, string> = {
        NAME_TAKEN: d.teamNameTaken,
        BAD_NAME: d.teamName,
        BAD_PHOTO: d.teamPhotoHelp,
      };
      onNotice(known[data.error ?? ""] ?? data.error ?? t.common.somethingWrong);
      return null;
    }
    if (data.team) setTeam(data.team);
    /* The studio page is server rendered from the same table, so a refresh is
       what proves the change landed there too. */
    router.refresh();
    return data;
  }

  async function save() {
    setBusy("save");
    try {
      /* The photo address is managed by the upload, not typed. */
      const { photoUrl: _typed, ...fields } = draft;
      void _typed;
      const saved =
        editing === "new"
          ? await call("POST", fields)
          : await call("PATCH", { id: editing, ...fields });
      if (!saved) return;
      const id = saved.member?.id ?? (editing !== "new" ? editing : null);
      if (id && photo) {
        const form = new FormData();
        form.set("id", id);
        form.set("photo", photo.blob, "photo.jpg");
        const res = await fetch("/api/admin/team/photo", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { team?: Member[] };
        if (!res.ok) onNotice(d.teamPhotoBad);
        else if (data.team) setTeam(data.team);
      } else if (id && dropPhoto) {
        const res = await fetch(`/api/admin/team/photo?id=${id}`, { method: "DELETE" });
        const data = (await res.json().catch(() => ({}))) as { team?: Member[] };
        if (data.team) setTeam(data.team);
      }
      router.refresh();
      clearPhoto();
      onNotice(d.teamSaved);
      setEditing(null);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(m: Member) {
    setBusy(m.id);
    try {
      const ok = await call("PATCH", { id: m.id, active: !m.active });
      if (ok) onNotice(m.active ? d.teamRemoved : d.teamSaved);
    } finally {
      setBusy(null);
    }
  }

  /* Two presses, like deleting a pack: the first arms the button. */
  async function remove(m: Member) {
    if (armed !== m.id) {
      setArmed(m.id);
      return;
    }
    setArmed(null);
    setBusy(m.id);
    try {
      const ok = await call("DELETE", undefined, `?id=${m.id}`);
      if (ok) onNotice(d.teamDeleted);
    } finally {
      setBusy(null);
    }
  }

  const current = editing && editing !== "new" ? team.find((m) => m.id === editing) : null;
  const shownPhoto = photo?.preview ?? (dropPhoto ? null : current?.photoUrl ?? null);

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
        <div className="sm:col-span-2">
          <span className="label">{d.teamPhoto}</span>
          <div className="mt-1 flex flex-wrap items-center gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-cream-200">
              {shownPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownPhoto} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center">
                  <Monogram className="h-8 w-8 text-clay/50" />
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                void pickPhoto(e.currentTarget.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <Button size="sm" variant="outline" type="button" onClick={() => fileRef.current?.click()}>
              {shownPhoto ? d.teamPhotoChange : d.teamPhotoUpload}
            </Button>
            {shownPhoto && (
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  if (photo) {
                    URL.revokeObjectURL(photo.preview);
                    setPhoto(null);
                  }
                  if (current?.photoUrl) setDropPhoto(true);
                }}
              >
                {d.teamPhotoRemove}
              </Button>
            )}
          </div>
          <span className="mt-2 block text-[11px] text-clay">{d.teamPhotoHelp}</span>
        </div>
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
            {key !== "bioEn" && (
              <span className="mt-1 block text-[11px] text-clay">{d.teamBioFallback}</span>
            )}
          </label>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button size="sm" disabled={busy === "save" || draft.name.trim().length < 2} onClick={save}>
          {busy === "save" ? t.common.loading : t.common.save}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            clearPhoto();
            setEditing(null);
          }}
        >
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
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === m.id}
                      onClick={() => void remove(m)}
                      onBlur={() => armed === m.id && setArmed(null)}
                      className={armed === m.id ? "text-red-700" : "text-clay"}
                    >
                      {armed === m.id ? d.teamDeleteConfirm : d.teamDelete}
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
