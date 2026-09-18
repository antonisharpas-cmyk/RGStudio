"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DateField, dayKey } from "@/components/ui/DateField";
import { useI18n } from "@/i18n/LanguageProvider";

/**
 * Closing the studio for a day.
 *
 * The consequence is spelled out on screen before the button is pressed,
 * because it is not a small one: every class on that day is cancelled and every
 * session goes back. Afterwards the desk is shown exactly who was in those
 * classes, with their phone numbers, so somebody can be told rather than
 * finding out by turning up.
 */

type Closure = { id: string; day: string; reasonEn: string; reasonEl: string };

type Affected = {
  name: string;
  email: string;
  phone: string | null;
  startsAt: string;
  refunded: boolean;
};

export function ClosurePanel({
  onNotice,
  scheduled,
}: {
  onNotice: (s: string) => void;
  /** Classes already on the books, shown beside the roll-forward control. */
  scheduled: number;
}) {
  const { t, fmtFullDate, fmtTime } = useI18n();
  const d = t.desk;

  const [closures, setClosures] = useState<Closure[]>([]);
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const [reasonEl, setReasonEl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [affected, setAffected] = useState<Affected[] | null>(null);
  const [weeks, setWeeks] = useState(6);

  /* What the last roll-forward actually added, kept so it can be taken back.
     Rolling forward is safe to repeat — the classes are unique per template and
     time, so a second run changes nothing — but a run that went further ahead
     than intended is worth being able to undo without editing the timetable by
     hand. */
  const [lastRun, setLastRun] = useState<{
    created: number;
    skipped: number;
    ids: string[];
  } | null>(null);

  async function generate() {
    setBusy("generate");
    try {
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeks }),
      });
      const data = (await res.json()) as {
        created?: number;
        skipped?: number;
        createdIds?: string[];
      };
      setLastRun({
        created: data.created ?? 0,
        skipped: data.skipped ?? 0,
        ids: data.createdIds ?? [],
      });
      onNotice(
        d.rotaResult
          .replace("{created}", String(data.created ?? 0))
          .replace("{skipped}", String(data.skipped ?? 0)),
      );
    } finally {
      setBusy(null);
    }
  }

  async function undoGenerate() {
    if (!lastRun?.ids.length) return;
    setBusy("undo");
    try {
      const res = await fetch("/api/admin/generate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: lastRun.ids }),
      });
      const data = (await res.json()) as { removed?: number; kept?: number };
      onNotice(
        d.rotaUndone
          .replace("{removed}", String(data.removed ?? 0))
          .replace("{kept}", String(data.kept ?? 0)),
      );
      setLastRun(null);
      /* The class count above it is server-rendered. */
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/closures");
    if (!res.ok) return;
    const data = (await res.json()) as { closures: Closure[] };
    setClosures(data.closures ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function close() {
    if (!day) return;
    setBusy("close");
    try {
      const res = await fetch("/api/admin/closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, reasonEn: reason, reasonEl }),
      });
      const data = (await res.json()) as {
        error?: string;
        classesCancelled?: number;
        affected?: Affected[];
      };
      if (data.error) {
        onNotice(data.error);
        return;
      }
      const refunds = (data.affected ?? []).filter((a) => a.refunded).length;
      onNotice(
        d.closedResult
          .replace("{classes}", String(data.classesCancelled ?? 0))
          .replace("{refunds}", String(refunds)),
      );
      setAffected(data.affected ?? []);
      setDay("");
      setReason("");
      setReasonEl("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function reopen(which: string) {
    setBusy(which);
    try {
      await fetch(`/api/admin/closures?day=${which}`, { method: "DELETE" });
      await load();
      onNotice(`${which}: ${d.closeOpen}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <p className="text-[10px] uppercase tracking-brand text-clay">
          {d.closeTitle}
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-clay">
          {d.closeHelp}
        </p>

        <label className="label mt-6" htmlFor="closure-day">
          {d.closeDay}
        </label>
        {/* A calendar, not a typed date. The browser's own field reads
            dd/mm/yyyy here and mm/dd/yyyy on an American machine, and the
            button below this one cancels everybody's classes — that is not a
            place for the day to be ambiguous. Today onwards only: a day in the
            past has already happened, closing it changes nothing. */}
        <DateField
          id="closure-day"
          value={day}
          min={dayKey(new Date())}
          onChange={setDay}
          placeholder={d.pickDay}
        />

        <label className="label mt-5" htmlFor="closure-reason">
          {d.closeReason}
        </label>
        <input
          id="closure-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Public holiday"
          className="input"
        />

        <label className="label mt-5" htmlFor="closure-reason-el">
          {d.noticeGreek}
        </label>
        <input
          id="closure-reason-el"
          value={reasonEl}
          onChange={(e) => setReasonEl(e.target.value)}
          className="input"
        />

        <Button
          className="mt-6"
          size="sm"
          disabled={busy === "close" || !day}
          onClick={close}
        >
          {busy === "close" ? t.common.loading : d.closeDo}
        </Button>
      </div>

      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <p className="text-[10px] uppercase tracking-brand text-clay">
          {d.closedDays}
        </p>

        {closures.length === 0 ? (
          <p className="mt-5 text-sm text-clay">{d.noClosures}</p>
        ) : (
          <ul className="mt-5 divide-y divide-mocha-200/70">
            {closures.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span>
                  <span className="text-[14px] text-mocha-600 lining-nums tabular-nums">
                    {fmtFullDate(`${c.day}T12:00:00Z`)}
                  </span>
                  {c.reasonEn && (
                    <span className="ml-3 text-[12px] text-clay">
                      {c.reasonEn}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === c.day}
                  onClick={() => void reopen(c.day)}
                >
                  {d.closeOpen}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {affected && affected.length > 0 && (
          <div className="mt-8 border-t border-mocha-200/70 pt-6">
            <p className="text-[10px] uppercase tracking-brand text-clay">
              {d.affected}
            </p>
            <ul className="mt-4 space-y-2 text-[13px]">
              {affected.map((a, i) => (
                <li
                  key={`${a.email}-${i}`}
                  className="flex justify-between gap-4"
                >
                  <span className="text-mocha-600">
                    {a.name}
                    <span className="ml-2 text-clay">{a.phone ?? a.email}</span>
                  </span>
                  <span className="shrink-0 text-clay lining-nums tabular-nums">
                    {fmtTime(a.startsAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Rolling the rota forward lives here rather than in the top bar: it is
            a timetable job, and this is the timetable tab. Out of the bar it is
            also out of reach of an idle click while somebody is on another
            screen. */}
        <div className="mt-8 border-t border-mocha-200/70 pt-6">
          <p className="text-[10px] uppercase tracking-brand text-clay">
            {d.rotaTitle}
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-clay">
            {d.rotaHelp}
          </p>
          <p className="mt-4 text-[12px] text-mocha-500 lining-nums tabular-nums">
            {d.rotaScheduled.replace("{n}", String(scheduled))}
          </p>

          <div className="mt-5 flex items-end gap-3">
            <div>
              <label className="label" htmlFor="rota-weeks">
                {d.rotaWeeks}
              </label>
              <input
                id="rota-weeks"
                type="number"
                min={1}
                max={26}
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
                className="input w-24 lining-nums tabular-nums"
              />
            </div>
            <Button
              size="sm"
              className="mb-1"
              disabled={busy === "generate"}
              onClick={generate}
            >
              {busy === "generate" ? t.common.loading : t.admin.generate}
            </Button>
          </div>

          {/* What the run did, and the way back. Shown only after a run, because
              before one there is nothing to say and nothing to undo. */}
          {lastRun && (
            <div className="mt-5 rounded-2xl border border-mocha-200/70 bg-cream-200/40 p-4">
              <p className="text-[12px] leading-relaxed text-mocha-600">
                {d.rotaResult
                  .replace("{created}", String(lastRun.created))
                  .replace("{skipped}", String(lastRun.skipped))}
              </p>
              {lastRun.created > 0 ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={busy === "undo"}
                    onClick={undoGenerate}
                  >
                    {busy === "undo" ? t.common.loading : d.rotaUndo}
                  </Button>
                  <p className="mt-2 text-[11px] leading-relaxed text-clay">
                    {d.rotaUndoWhy}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-clay">
                  {d.rotaNothingToUndo}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
