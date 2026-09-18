"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PushEnroller } from "@/components/account/PushEnroller";
import { UserAvatar } from "@/components/account/UserAvatar";
import { IntakeForm } from "@/components/auth/IntakeForm";
import { useI18n } from "@/i18n/LanguageProvider";
import type { PilatesExperience, PilatesLevel } from "@/lib/intake";
import {
  AVATAR_EDGE_PX,
  AVATAR_MAX_BYTES,
  REMINDER_MAX_MINUTES,
  REMINDER_MIN_MINUTES,
  REMINDER_STEP_MINUTES,
  ageFromBirthDate,
  formatLeadTime,
} from "@/lib/profile";
import { PASSWORD_MIN } from "@/lib/validation";
import { cn } from "@/lib/utils";

export type ProfileValues = {
  name: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  marketingOptIn: boolean;
  serviceOptIn: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyPush: boolean;
  reminderMinutes: number | null;
  hasPhoto: boolean;
  /* The three answers from the welcome step. Editable here for as long as they
     stay true, which is the point of asking rather than assuming. */
  pilatesLevel: PilatesLevel | null;
  pilatesSince: PilatesExperience | null;
  healthCondition: string | null;
  intakeAnswered: boolean;
};

/**
 * Everything a member can change about themselves.
 *
 * Email and phone are shown but not editable: they are how the studio reaches
 * someone about a class that has moved, and how a password reset finds them,
 * so changing either is a conversation with the studio rather than a text
 * field. Saying that on the page is kinder than a field that silently fails.
 */
export function ProfilePanel({
  initial,
  section,
  pushPublicKey = "",
}: {
  initial: ProfileValues;
  /** Which part to render. The state and the save button are shared. */
  section: "profile" | "notifications" | "password";
  /** VAPID public key. Empty when push has not been configured yet. */
  pushPublicKey?: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const p = t.profile;

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  /* Cache-busted so a new photograph appears at once rather than after the
     browser decides the old one has expired. */
  const [photoVersion, setPhotoVersion] = useState(0);
  const [hasPhoto, setHasPhoto] = useState(initial.hasPhoto);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNotice, setPwNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const message = (code: string) =>
    (p.errors as Record<string, string>)[code] ?? t.common.somethingWrong;

  function flash(kind: "ok" | "error", text: string) {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 6000);
  }

  /* ------------------------------------------------------------- photograph */

  /**
   * Resize and re-encode in the browser before uploading.
   *
   * A phone camera JPEG is several megabytes; a 512px square avatar is tens of
   * kilobytes. Doing it here means the upload is quick on studio wifi and the
   * server never has to run image processing.
   */
  async function squareJpeg(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_EDGE_PX;
    canvas.height = AVATAR_EDGE_PX;
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
      AVATAR_EDGE_PX,
      AVATAR_EDGE_PX,
    );
    bitmap.close?.();

    /* Step the quality down until it fits, rather than failing on a large
       photograph and making the member go and find a smaller one. */
    for (const q of [0.85, 0.72, 0.6, 0.45]) {
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/jpeg", q),
      );
      if (blob && blob.size <= AVATAR_MAX_BYTES) return blob;
    }
    throw new Error("AVATAR_TOO_LARGE");
  }

  async function uploadPhoto(file: File) {
    setPhotoBusy(true);
    try {
      const blob = await squareJpeg(file);
      const body = new FormData();
      body.append(
        "photo",
        new File([blob], "avatar.jpg", { type: "image/jpeg" }),
      );
      const res = await fetch("/api/profile/avatar", { method: "POST", body });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setHasPhoto(true);
        setPhotoVersion((v) => v + 1);
        flash("ok", p.photoSaved);
      } else {
        flash("error", message(data.error ?? ""));
      }
    } catch (e) {
      flash(
        "error",
        e instanceof Error && e.message === "AVATAR_TOO_LARGE"
          ? message("AVATAR_TOO_LARGE")
          : t.common.somethingWrong,
      );
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await fetch("/api/profile/avatar", { method: "DELETE" });
      setHasPhoto(false);
      setPhotoVersion((v) => v + 1);
      flash("ok", p.photoRemoved);
    } finally {
      setPhotoBusy(false);
    }
  }

  /* ------------------------------------------------------------------- save */

  /* Takes an optional override so a single-click action (accepting offers from
     the prompt) saves that value immediately rather than waiting for the
     member to also find the Save button. */
  async function save(override?: ProfileValues) {
    const v = override ?? values;
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: v.name.trim(),
          birthDate: v.birthDate || "",
          marketingOptIn: v.marketingOptIn,
          serviceOptIn: v.serviceOptIn,
          notifyEmail: v.notifyEmail,
          notifySms: v.notifySms,
          notifyPush: v.notifyPush,
          reminderMinutes: v.reminderMinutes,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        flash("ok", p.saved);
        router.refresh();
      } else {
        flash("error", message(data.error ?? ""));
      }
    } catch {
      flash("error", t.common.somethingWrong);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next.length < PASSWORD_MIN) {
      setPwNotice({ kind: "error", text: message("PASSWORD_SHORT") });
      return;
    }
    setPwBusy(true);
    setPwNotice(null);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: pw.current,
          newPassword: pw.next,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setPw({ current: "", next: "" });
        setPwNotice({ kind: "ok", text: p.passwordChanged });
      } else {
        setPwNotice({ kind: "error", text: message(data.error ?? "") });
      }
    } catch {
      setPwNotice({ kind: "error", text: t.common.somethingWrong });
    } finally {
      setPwBusy(false);
    }
  }

  const age = values.birthDate ? ageFromBirthDate(values.birthDate) : null;
  const anyChannel =
    values.notifyEmail || values.notifySms || values.notifyPush;
  const remindersOn = values.reminderMinutes !== null;

  /* Things worth asking for, shown where the member already is rather than in
     an email they have not agreed to receive yet: ask once, in context, and let
     them say no by simply not pressing it.

     There used to be a second card here nudging members to add their date of
     birth. Removed at the studio's request: it is genuinely optional, nothing
     depends on it, and a card asking for it made an optional field look like an
     outstanding task. The field itself is still on the form for anybody who
     wants to fill it in. */
  const wantsMarketing = values.marketingOptIn;

  return (
    /* Two columns for the profile and password sections, which have two cards.
       Notifications is one card and now sits inside a column of its own beside
       the message list, so it must not be split again. */
    <div
      className={cn(
        "grid gap-6",
        section === "notifications" ? "" : "lg:grid-cols-[1fr_1fr]",
      )}
    >
      {section === "profile" && (
        <>
          {/* ---------------------------------------------------------- identity */}
          <section className="card p-7 md:p-8">
            <h3 className="eyebrow">{p.youTitle}</h3>

            <div className="mt-6 flex flex-wrap items-center gap-6">
              <UserAvatar
                hasPhoto={hasPhoto}
                name={values.name}
                version={photoVersion}
                className="h-24 w-24"
              />

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) void uploadPhoto(f);
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={photoBusy}
                  onClick={() => fileInput.current?.click()}
                >
                  {photoBusy
                    ? t.common.loading
                    : hasPhoto
                      ? p.photoChange
                      : p.photoAdd}
                </Button>
                {hasPhoto && (
                  <button
                    onClick={removePhoto}
                    disabled={photoBusy}
                    className="link-underline text-[11px] uppercase tracking-widest text-clay hover:text-mocha-600"
                  >
                    {p.photoRemove}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-8 grid gap-5">
              <div>
                <label className="label" htmlFor="pf-name">
                  {p.name}
                </label>
                <input
                  id="pf-name"
                  className="input"
                  value={values.name}
                  onChange={(e) =>
                    setValues({ ...values, name: e.currentTarget.value })
                  }
                />
              </div>

              {/* Contact of record: shown, explained, not editable here. */}
              <div className="rounded-2xl border border-mocha-200/70 bg-cream-200/50 p-5">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="label mb-1">{p.email}</dt>
                    <dd className="text-sm text-mocha-600">{values.email}</dd>
                  </div>
                  <div>
                    <dt className="label mb-1">{p.phone}</dt>
                    <dd className="text-sm text-mocha-600">
                      {values.phone ?? "—"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-[12px] leading-relaxed text-clay">
                  {p.contactLocked}
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="pf-dob">
                    {p.birthDate}
                  </label>
                  <input
                    id="pf-dob"
                    type="date"
                    className="input"
                    value={values.birthDate ?? ""}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        birthDate: e.currentTarget.value || null,
                      })
                    }
                  />
                  {age !== null && (
                    <p className="mt-1.5 text-[11px] text-clay">
                      {p.ageIs.replace("{n}", String(age))}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/**
            * Their pilates, in the same tab and saved by its own button.
            *
            * Kept out of the profile card's save on purpose. That button sends a
            * whole profile and this is a different route with different rules;
            * sharing one button would mean a member who came here only to add a
            * shoulder injury also re-submitting their consents and their
            * reminder time, and any validation failure in those would lose the
            * injury.
            */}
          <section className="card p-7 md:p-8">
            <h2 className="text-[13px] uppercase tracking-widest">
              {t.intake.sectionTitle}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-mocha-500">
              {t.intake.sectionBody}
            </p>
            <div className="mt-6">
              <IntakeForm
                embedded
                initial={{
                  level: values.pilatesLevel,
                  experience: values.pilatesSince,
                  condition: values.healthCondition,
                  answered: values.intakeAnswered,
                }}
                onSaved={() => router.refresh()}
              />
            </div>
          </section>

          {/* The two asks, in the tab a member actually opens. */}
          <div className="space-y-4">
            {!wantsMarketing && (
              <div className="card border-gold/40 bg-[#FBF6E7] p-6">
                <p className="eyebrow text-clay">{p.offerTitle}</p>
                <p className="mt-3 text-[15px] leading-relaxed text-mocha-600">
                  {p.offerBody}
                </p>
                <Button
                  size="sm"
                  className="mt-5"
                  disabled={saving}
                  onClick={() => {
                    setValues({ ...values, marketingOptIn: true });
                    void save({ ...values, marketingOptIn: true });
                  }}
                >
                  {saving ? t.common.loading : p.offerAccept}
                </Button>
                <p className="mt-3 text-[11px] text-clay">{p.offerNote}</p>
              </div>
            )}

          </div>

          <div className="lg:col-span-2">
            <Button
              className="w-full sm:w-auto"
              disabled={saving}
              onClick={() => save()}
            >
              {saving ? t.common.loading : p.save}
            </Button>
            {notice && (
              <p
                className={cn(
                  "mt-4 text-sm",
                  notice.kind === "ok" ? "text-mocha-600" : "text-red-700",
                )}
                role="status"
              >
                {notice.text}
              </p>
            )}
          </div>
        </>
      )}

      {section === "notifications" && (
        <section className="card p-7 md:p-8">
          <h3 className="eyebrow">{p.notifyTitle}</h3>

          <div className="mt-6 space-y-4">
            {/* Push is not a switch. The studio keeps it on — it is how a
                cancelled class reaches somebody in time — and the only thing
                that can silence it is the member's own browser or phone, which
                is said plainly rather than hidden behind a toggle that would
                imply we control it. */}
            <div className="rounded-2xl border border-mocha-300 bg-white/70 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[14px] text-mocha-700">
                  {p.channelPush}
                </span>
                <span className="rounded-full bg-mocha-600 px-3 py-1 text-[10px] uppercase tracking-widest text-cream">
                  {p.channelPushAlways}
                </span>
              </div>
              <PushEnroller publicKey={pushPublicKey} />
            </div>

            <Toggle
              label={p.channelEmail}
              hint={values.email}
              on={values.notifyEmail}
              onChange={(v) => setValues({ ...values, notifyEmail: v })}
            />
            <Toggle
              label={p.channelSms}
              hint={values.phone ?? ""}
              on={values.notifySms}
              onChange={(v) => setValues({ ...values, notifySms: v })}
            />
          </div>

          <div className="mt-7 border-t border-mocha-200/70 pt-6">
            <p className="label mb-3">{p.consentTitle}</p>

            {/* Already on record: stated as a fact, not offered as a choice.
              Withdrawing it means closing the account, which is a conversation
              with the studio. Members who joined before this consent existed
              have none recorded, so they are asked for it here rather than
              being shown a tick they never gave. */}
            {values.serviceOptIn ? (
              <div className="flex items-start gap-3 rounded-2xl border border-mocha-200/70 bg-cream-200/50 p-4">
                <span
                  aria-hidden
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mocha-600 text-[11px] text-cream"
                >
                  ✓
                </span>
                <div>
                  <p className="text-sm text-mocha-600">{p.consentService}</p>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-gold/40 bg-[#FBF6E7] p-4">
                <input
                  type="checkbox"
                  checked={values.serviceOptIn}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      serviceOptIn: e.currentTarget.checked,
                    })
                  }
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-mocha-300 accent-mocha-600"
                />
                <span className="block text-sm text-mocha-700">
                  {p.consentService}
                </span>
              </label>
            )}

            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={values.marketingOptIn}
                /* Accepting offers switches SMS on in the same press, so the
                   screen shows what the server is about to record rather than
                   surprising them with it after a save. */
                onChange={(e) =>
                  setValues({
                    ...values,
                    marketingOptIn: e.currentTarget.checked,
                    notifySms: e.currentTarget.checked ? true : values.notifySms,
                  })
                }
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-mocha-300 accent-mocha-600"
              />
              <span>
                <span className="block text-sm text-mocha-600">
                  {p.consentMarketing}
                </span>
                <span className="mt-1 block text-[12px] text-clay">
                  {p.consentOptional}
                </span>
              </span>
            </label>
          </div>

          {/* -------------------------------------------------- reminder timing */}
          <div className="mt-7 border-t border-mocha-200/70 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="label mb-0">{p.reminderTitle}</p>
              <button
                onClick={() =>
                  setValues({
                    ...values,
                    reminderMinutes: remindersOn ? null : 120,
                  })
                }
                className="link-underline text-[11px] uppercase tracking-widest text-clay hover:text-mocha-600"
              >
                {remindersOn ? p.reminderOff : p.reminderOn}
              </button>
            </div>

            {remindersOn ? (
              <>
                <p className="mt-4 font-display text-3xl font-light text-mocha-600">
                  {formatLeadTime(values.reminderMinutes!, locale)}
                </p>
                <p className="mt-1 text-[12px] text-clay">{p.reminderBefore}</p>
                <input
                  type="range"
                  min={REMINDER_MIN_MINUTES}
                  max={REMINDER_MAX_MINUTES}
                  step={REMINDER_STEP_MINUTES}
                  value={values.reminderMinutes ?? 0}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      reminderMinutes: Number(e.currentTarget.value),
                    })
                  }
                  className="mt-4 w-full accent-mocha-600"
                  aria-label={p.reminderTitle}
                />
                <div className="mt-1 flex justify-between text-[10px] uppercase tracking-widest text-clay">
                  <span>{formatLeadTime(REMINDER_MIN_MINUTES, locale)}</span>
                  <span>{formatLeadTime(REMINDER_MAX_MINUTES, locale)}</span>
                </div>
                {!anyChannel && (
                  <p className="mt-3 text-[12px] text-red-700">
                    {p.reminderNeedsChannel}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-4 text-sm text-clay">{p.reminderIsOff}</p>
            )}
          </div>

          {notice && (
            <p
              className={cn(
                "mt-6 text-sm",
                notice.kind === "ok" ? "text-mocha-600" : "text-red-700",
              )}
              role="status"
            >
              {notice.text}
            </p>
          )}

          <Button
            className="mt-7 w-full"
            disabled={saving}
            onClick={() => save()}
          >
            {saving ? t.common.loading : p.save}
          </Button>
        </section>
      )}

      {section === "password" && (
        <section className="card p-7 md:p-8 lg:col-span-2">
          <h3 className="eyebrow">{p.passwordTitle}</h3>
          <form
            onSubmit={changePassword}
            noValidate
            className="mt-6 grid items-end gap-5 sm:grid-cols-[1fr_1fr_auto]"
          >
            <div>
              <label className="label" htmlFor="pf-pw-current">
                {p.passwordCurrent}
              </label>
              <input
                id="pf-pw-current"
                type="password"
                autoComplete="current-password"
                className="input"
                value={pw.current}
                onChange={(e) =>
                  setPw({ ...pw, current: e.currentTarget.value })
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="pf-pw-new">
                {p.passwordNew}
              </label>
              <input
                id="pf-pw-new"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
                className="input"
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.currentTarget.value })}
              />
            </div>
            <Button type="submit" disabled={pwBusy || !pw.current || !pw.next}>
              {pwBusy ? t.common.loading : p.passwordSubmit}
            </Button>
          </form>
          <p className="mt-3 text-[12px] text-clay">
            {p.passwordHint.replace("{n}", String(PASSWORD_MIN))}
          </p>
          {pwNotice && (
            <p
              className={cn(
                "mt-4 text-sm",
                pwNotice.kind === "ok" ? "text-mocha-600" : "text-red-700",
              )}
              role="status"
            >
              {pwNotice.text}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm text-mocha-600">{label}</span>
        {hint && <span className="block text-[11px] text-clay">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-400",
          on
            ? "border-mocha-600 bg-mocha-600"
            : "border-mocha-300 bg-cream-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full transition-all duration-400 ease-silk",
            on ? "left-[1.55rem] bg-cream" : "left-0.5 bg-clay",
          )}
        />
      </button>
    </div>
  );
}
