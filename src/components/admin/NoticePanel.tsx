"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chevron } from "@/components/ui/Chevron";
import { Pager } from "@/components/ui/Pager";
import { useI18n } from "@/i18n/LanguageProvider";
import { MAX_SEGMENTS, smsBodyFor, smsCost } from "@/lib/messaging/segments";
import { cn } from "@/lib/utils";

/**
 * Writing to every member at once.
 *
 * The message always lands in each member's account, with a count on their
 * photograph until they open it. Beyond that the desk chooses who it goes to
 * and how it travels — push, email, SMS — and each channel says on the button
 * how many people it will actually reach before anything is sent. A channel
 * with no provider connected says so rather than silently doing nothing: a
 * receptionist who believes a text went out will not pick up the phone.
 */

type Delivery = {
  channel: string;
  sent: number;
  failed: number;
  skipped: number;
  detail: string;
};

type Sent = {
  id: string;
  titleEn: string;
  bodyEn: string;
  important: boolean;
  audience: string;
  channels: string;
  segment: string;
  createdAt: string;
  author: string | null;
  reads: number;
  members: number;
  deliveries: Delivery[];
};

type Reach = {
  people: number;
  push: number;
  email: number;
  sms: number;
  /**
   * How many distinct members each combination of channels would reach.
   *
   * Keyed by the channels sorted and joined with "+": "sms",
   * "email+push+sms". Looked up rather than worked out here, so the screen
   * cannot disagree with the server about a union — see `reachOf`.
   */
  onAnyOf: Record<string, number>;
  /** How many accounts are marked as tests, so their exclusion can be stated. */
  testAccounts: number;
  unverifiedAccounts: number;
};
type HistoryMeta = {
  page: number;
  pages: number;
  total: number;
  counts: { all: number; push: number; email: number; sms: number };
};
type Transports = Record<string, { name: string; ready: boolean }>;
type SmsMeta = {
  maxSegments: number;
  /** What appears in the recipient's inbox instead of a phone number. */
  sender: string;
  /** Cost of one segment, or null when nobody has configured a price. */
  pricePerSegment: number | null;
};
type Channel = "push" | "email" | "sms";

export function NoticePanel({ onNotice }: { onNotice: (s: string) => void }) {
  const { t, locale, fmtFullDate } = useI18n();
  const d = t.desk;
  const el = locale === "el";

  const [history, setHistory] = useState<Sent[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [titleEl, setTitleEl] = useState("");
  const [textEl, setTextEl] = useState("");
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /* SMS is the one channel with a price on it, so it carries one choice of its
     own: which language goes out. English by default — one segment against three.

     The wording is *not* a second thing to write. `smsEn`/`smsEl` stay empty and
     the text follows the message above; they only fill up if somebody asks to
     change the wording, and clearing them puts it back to following. Empty is
     therefore a meaningful state and not a missing one. */
  const [smsLang, setSmsLang] = useState<"en" | "el" | "both">("en");
  const [smsEn, setSmsEn] = useState("");
  const [smsEl, setSmsEl] = useState("");
  const [smsEditing, setSmsEditing] = useState(false);

  const [audience, setAudience] = useState<"ALL" | "OFFERS">("ALL");
  /* Push starts ticked, because it is the channel the studio wants used and the
     one that costs nothing. Email and SMS are deliberate choices. */
  const [channels, setChannels] = useState<Channel[]>(["push"]);
  const [reach, setReach] = useState<Reach | null>(null);
  const [transports, setTransports] = useState<Transports>({});
  /* The ceiling and the price come from the server, so a change of provider is
     a change of configuration rather than a change of code. */
  const [smsMeta, setSmsMeta] = useState<SmsMeta | null>(null);

  /* Test accounts are out unless somebody deliberately puts them in. The default
     is the one that matters: a real announcement counted as reaching 41 people
     when four of them are the owner's dummy accounts is a number that will be
     quoted back at somebody later. */
  const [includeTest, setIncludeTest] = useState(false);

  /* Narrowing by what members have actually done. Separate from the audience
     above, which is about consent: these decide relevance, that decides
     permission, and the permission one is never weakened by these. */
  const [neverPaid, setNeverPaid] = useState(false);
  const [noSessionsLeft, setNoSessionsLeft] = useState(false);
  const [awayValue, setAwayValue] = useState(0);
  const [awayUnit, setAwayUnit] = useState<"days" | "weeks" | "months">(
    "months",
  );

  /* Months are 30 days. The desk is choosing a rough cohort — "people we have
     not seen since the summer" — not computing a billing period, and a filter
     that quietly disagreed with a calendar month by a day or two would never be
     noticed and never matter. */
  const awayDays =
    awayValue <= 0
      ? 0
      : awayValue * (awayUnit === "days" ? 1 : awayUnit === "weeks" ? 7 : 30);

  /**
   * How many narrowing filters are on, so the collapsed title can say so.
   *
   * The one state that must never be invisible is a filter left on from the
   * last message. `includeTest` is counted with them: it changes who the
   * message reaches, which is the only thing this badge is about.
   */
  const activeSegments =
    (neverPaid ? 1 : 0) +
    (noSessionsLeft ? 1 : 0) +
    (awayDays > 0 ? 1 : 0) +
    (includeTest ? 1 : 0);

  /**
   * How many distinct members the ticked channels would actually reach.
   *
   * Looked up by the sorted channel key rather than added up here: two on SMS
   * and two on push is three people when one of them has both, and there is no
   * way to get that from three separate totals. The server counts every
   * combination directly — see `reachOf`.
   */
  const channelKey = [...channels].sort().join("+");
  const selectedReach = channels.length === 0 ? 0 : (reach?.onAnyOf?.[channelKey] ?? 0);

  /* "SMS and push", in the reader's own language, for the sentence below. */
  const channelWords = (() => {
    const label: Record<Channel, string> = {
      push: d.chanPush,
      email: d.chanEmail,
      sms: d.chanSms,
    };
    /* A stable order, not the order somebody happened to tick them in.
       "SMS, Push notification and Email" one moment and "Email and SMS" the
       next reads as the sentence being rebuilt rather than the answer
       changing. */
    const parts = (["push", "email", "sms"] as const)
      .filter((c) => channels.includes(c))
      .map((c) => label[c]);
    if (parts.length <= 1) return parts[0] ?? "";
    try {
      return new Intl.ListFormat(el ? "el" : "en-GB", {
        style: "long",
        type: "conjunction",
      }).format(parts);
    } catch {
      return parts.join(", ");
    }
  })();

  /* Which channel's history to show, and where in it. */
  const [channel, setChannel] = useState<Channel | null>(null);
  /* The narrowing filters, shut to begin with. See the note on the title. */
  const [segOpen, setSegOpen] = useState(false);
  const [meta, setMeta] = useState<HistoryMeta | null>(null);
  const [paging, setPaging] = useState(false);

  const load = useCallback(
    async (opts: {
      audience: "ALL" | "OFFERS";
      includeTest: boolean;
      channel: Channel | null;
      page: number;
      neverPaid: boolean;
      noSessionsLeft: boolean;
      awayDays: number;
    }) => {
      const q = new URLSearchParams({
        audience: opts.audience,
        includeTest: opts.includeTest ? "1" : "0",
        page: String(opts.page),
        neverPaid: opts.neverPaid ? "1" : "0",
        noSessionsLeft: opts.noSessionsLeft ? "1" : "0",
        inactiveDays: String(opts.awayDays),
      });
      if (opts.channel) q.set("channel", opts.channel);

      const res = await fetch(`/api/admin/notices?${q}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        notices: Sent[];
        history: HistoryMeta;
        reach: Reach;
        transports: Transports;
        sms?: SmsMeta;
      };
      setHistory(data.notices ?? []);
      setMeta(data.history ?? null);
      setReach(data.reach ?? null);
      setTransports(data.transports ?? {});
      setSmsMeta(data.sms ?? null);
    },
    [],
  );

  const refresh = useCallback(
    (page = 1) =>
      load({
        audience,
        includeTest,
        channel,
        page,
        neverPaid,
        noSessionsLeft,
        awayDays,
      }),
    [load, audience, includeTest, channel, neverPaid, noSessionsLeft, awayDays],
  );

  useEffect(() => {
    void refresh(1);
  }, [refresh]);

  async function goPage(page: number) {
    setPaging(true);
    try {
      await refresh(page);
    } finally {
      setPaging(false);
    }
  }

  const toggle = (c: Channel) =>
    setChannels((cs) =>
      cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c],
    );

  /* The price, worked out from exactly the same code the server bills from —
     imported, not reimplemented. A cost shown at the desk that disagrees with
     the invoice is worse than showing nothing, and two copies of segment
     arithmetic would eventually disagree. */
  const smsNoticeEn = { subject: title, body: text };
  const smsNoticeEl =
    titleEl && textEl ? { subject: titleEl, body: textEl } : undefined;
  const smsPreview = smsBodyFor(smsLang, smsNoticeEn, smsNoticeEl, {
    en: smsEn,
    el: smsEl,
  });
  /* Each language on its own, so pressing "change the wording" starts from the
     words that were about to be sent rather than from an empty box. */
  const smsPreviewEn = smsBodyFor("en", smsNoticeEn, smsNoticeEl);
  /* Empty when no Greek has been typed upstairs, rather than falling back to the
     English. Prefilling a box labelled "Greek" with English words invites
     somebody to send exactly that. */
  const smsPreviewEl = smsNoticeEl
    ? smsBodyFor("el", smsNoticeEn, smsNoticeEl)
    : "";
  const smsPreviewCost = smsCost(smsPreview);
  /* Read from the server rather than assumed, so the preview shows the sender
     the member will actually see. */
  const smsSender = smsMeta?.sender ?? "RG Pilates Studio";
  const smsRecipients = reach?.sms ?? 0;
  const smsTotalSegments = smsPreviewCost.segments * smsRecipients;
  const smsMax = smsMeta?.maxSegments ?? MAX_SEGMENTS;
  const smsOver = smsPreviewCost.segments > smsMax;
  const smsMoney =
    smsMeta?.pricePerSegment == null
      ? null
      : smsTotalSegments * smsMeta.pricePerSegment;

  async function send() {
    setBusy("send");
    try {
      const res = await fetch("/api/admin/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleEn: title,
          bodyEn: text,
          titleEl,
          bodyEl: textEl,
          important,
          audience,
          channels,
          includeTest,
          neverPaid,
          noSessionsLeft,
          inactiveDays: awayDays,
          smsLang,
          smsEn,
          smsEl,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        reports?: { channel: string; sent: number; failed: number }[];
      };
      if (data.error) {
        onNotice(data.error);
        return;
      }
      /* Say what actually happened per channel rather than "sent": the desk
         needs to know if the email provider refused forty of them. */
      const summary = (data.reports ?? [])
        .map(
          (r) =>
            `${r.channel} ${r.sent}${r.failed ? ` (${r.failed} failed)` : ""}`,
        )
        .join(" · ");
      onNotice(
        summary ? d.sentReport.replace("{summary}", summary) : d.noticeSent,
      );
      setTitle("");
      setText("");
      setTitleEl("");
      setTextEl("");
      setSmsEn("");
      setSmsEl("");
      setSmsEditing(false);
      setImportant(false);
      await refresh(1);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <p className="text-[10px] uppercase tracking-brand text-clay">
          {d.noticeTitle}
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-clay">
          {d.noticeHelp}
        </p>

        <label className="label mt-6" htmlFor="notice-subject">
          {d.noticeSubject}
        </label>
        <input
          id="notice-subject"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="input"
        />

        <label className="label mt-5" htmlFor="notice-body">
          {d.noticeBody}
        </label>
        <textarea
          id="notice-body"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          className="input resize-y"
        />

        <details className="mt-5">
          <summary className="cursor-pointer text-[11px] uppercase tracking-widest text-clay">
            {d.noticeGreek}
          </summary>
          <input
            value={titleEl}
            onChange={(e) => setTitleEl(e.target.value)}
            placeholder={d.noticeSubject}
            className="input mt-3"
          />
          <textarea
            rows={4}
            value={textEl}
            onChange={(e) => setTextEl(e.target.value)}
            placeholder={d.noticeBody}
            className="input mt-3 resize-y"
          />
        </details>

        <button
          onClick={() => setImportant((v) => !v)}
          className={cn(
            "mt-6 rounded-full border px-4 py-2 text-[11px] uppercase tracking-widest transition-colors",
            important
              ? "border-gold bg-gold/15 text-[#8a6f1a]"
              : "border-mocha-200 text-mocha-500 hover:border-mocha-400",
          )}
        >
          {d.noticeImportant}
        </button>

        {/* ------------------------------------------------- who it goes to */}
        <div className="mt-8 border-t border-mocha-200/70 pt-6">
          <p className="text-[10px] uppercase tracking-brand text-clay">
            {d.audienceTitle}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["ALL", d.audienceAll, d.audienceAllWhy],
                ["OFFERS", d.audienceOffers, d.audienceOffersWhy],
              ] as const
            ).map(([key, label, why]) => (
              <button
                key={key}
                data-audience={key}
                onClick={() => setAudience(key)}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-colors duration-300",
                  audience === key
                    ? "border-mocha-600 bg-mocha-600/[0.06]"
                    : "border-mocha-200 hover:border-mocha-400",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-mocha-700">{label}</span>
                  {reach && (
                    <span className="text-[11px] text-clay lining-nums tabular-nums">
                      {audience === key ? reach.people : ""}
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-clay">
                  {why}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------ how it goes out */}
        <div className="mt-7">
          <p className="text-[10px] uppercase tracking-brand text-clay">
            {d.channelsTitle}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-clay">
            {d.channelsHelp}
          </p>

          <div className="mt-4 space-y-3">
            {(
              [
                ["push", d.chanPush, d.chanPushWhy, reach?.push],
                ["email", d.chanEmail, d.chanEmailWhy, reach?.email],
                ["sms", d.chanSms, d.chanSmsWhy, reach?.sms],
              ] as const
            ).map(([key, label, why, n]) => {
              const on = channels.includes(key);
              const ready = transports[key]?.ready ?? true;
              return (
                <button
                  key={key}
                  data-channel={key}
                  aria-pressed={on}
                  onClick={() => toggle(key)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors duration-300",
                    on
                      ? "border-mocha-600 bg-mocha-600/[0.06]"
                      : "border-mocha-200 hover:border-mocha-400",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px]",
                      on
                        ? "border-mocha-600 bg-mocha-600 text-cream"
                        : "border-mocha-300",
                    )}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-mocha-700">
                        {label}
                      </span>
                      {/* The count is the point of this screen: nobody should
                          press send wondering who it reaches. */}
                      <span className="text-[11px] text-clay lining-nums tabular-nums">
                        {ready
                          ? d.chanReaches.replace("{n}", String(n ?? 0))
                          : key === "push"
                            ? d.chanNoKeys
                            : d.chanNotSet}
                      </span>
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-clay">
                      {why}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* ---------------------------------------------- the SMS bill
              Shown only when SMS is on, because it is the only channel with a
              price. An SMS is billed per 160-character segment — or per 70, the
              moment one Greek letter appears — so the same announcement can cost
              one message or five. The desk gets that number while it is still
              typing, which is the only moment anybody can act on it. */}
          {channels.includes("sms") && (
            <div
              data-sms-panel
              className="mt-4 rounded-2xl border border-mocha-200 bg-cream-200/40 p-4"
            >
              <p className="text-[10px] uppercase tracking-brand text-clay">
                {d.smsTitle}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ["en", d.smsLangEn],
                    ["el", d.smsLangEl],
                    ["both", d.smsLangBoth],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-sms-lang={key}
                    aria-pressed={smsLang === key}
                    onClick={() => setSmsLang(key)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-[11px] uppercase tracking-widest transition-colors",
                      smsLang === key
                        ? "border-mocha-600 bg-mocha-600 text-cream"
                        : "border-mocha-300 text-mocha-500 hover:border-mocha-500",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* What lands on the phone — always shown, never asked for.
                  The message is written once, above. This is a preview of it,
                  and it stays visible while the wording is being changed so the
                  desk can watch the thing it is editing rather than imagining
                  it. That matters most for "both", where the interesting
                  question is not what the two texts say but how they read
                  stacked in one message. */}
              <div className="mt-4">
                <div className="rounded-2xl rounded-bl-md border border-mocha-200 bg-white/80 px-4 py-3">
                  <p className="text-[9px] uppercase tracking-brand text-clay/70">
                    {smsSender}
                  </p>
                  <p
                    data-sms-preview
                    className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-mocha-700"
                  >
                    {smsPreview || (
                      <span className="text-clay/60">{d.smsEmpty}</span>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  data-sms-edit={smsEditing ? "on" : "off"}
                  onClick={() => {
                    if (smsEditing) {
                      /* Back to following the notice: the override is cleared,
                         not hidden. A stale draft sitting invisibly behind a
                         closed panel is exactly the bug this redesign removes. */
                      setSmsEn("");
                      setSmsEl("");
                      setSmsEditing(false);
                    } else {
                      /* Start from what would have been sent, so changing three
                         words is changing three words. */
                      setSmsEn(smsPreviewEn);
                      setSmsEl(smsPreviewEl);
                      setSmsEditing(true);
                    }
                  }}
                  className="link-underline mt-2.5 text-[11px] uppercase tracking-widest text-mocha-500 transition-colors hover:text-mocha-700"
                >
                  {smsEditing ? d.smsFollow : d.smsEdit}
                </button>

                {/* One box per language actually going out, each named.
                    The first version showed the English box unconditionally, so
                    picking Greek gave two boxes — an unlabelled one and a Greek
                    one — and picking Both gave two boxes with only the second
                    labelled. Both readings were guesswork. A box is shown when
                    its language is being sent, and it always says which. */}
                {smsEditing && (
                  <div className="mt-3 space-y-3">
                    {smsLang !== "el" && (
                      <div>
                        <label className="label" htmlFor="notice-sms">
                          {d.smsLangEn}
                        </label>
                        <textarea
                          id="notice-sms"
                          rows={3}
                          autoFocus
                          value={smsEn}
                          onChange={(e) => setSmsEn(e.target.value)}
                          className="input"
                        />
                      </div>
                    )}
                    {smsLang !== "en" && (
                      <div>
                        <label className="label" htmlFor="notice-sms-el">
                          {d.smsLangEl}
                        </label>
                        <textarea
                          id="notice-sms-el"
                          rows={3}
                          autoFocus={smsLang === "el"}
                          value={smsEl}
                          onChange={(e) => setSmsEl(e.target.value)}
                          className="input"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* What it costs, in the units the invoice uses. */}
              <p
                data-sms-cost
                className={cn(
                  "mt-4 text-[11px] leading-relaxed lining-nums tabular-nums",
                  smsOver ? "text-clay" : "text-mocha-600",
                )}
              >
                {d.smsCount
                  .replace("{chars}", String(smsPreviewCost.units))
                  .replace(
                    "{alphabet}",
                    smsPreviewCost.encoding === "unicode"
                      ? d.smsGreekAlphabet
                      : d.smsLatinAlphabet,
                  )}
                {smsRecipients > 0 && (
                  <>
                    {" · "}
                    {d.smsTotal
                      .replace("{n}", String(smsTotalSegments))
                      .replace("{people}", String(smsRecipients))}
                    {smsMoney !== null && ` ≈ €${smsMoney.toFixed(2)}`}
                  </>
                )}
              </p>

              {/* The sentence that stops the question this label kept raising:
                  a long text is not several texts on the member's phone. The
                  network splits it and the handset puts it back together, so
                  they see one message and the studio pays for three. Said as
                  both facts, and as the edit that fixes it. */}
              {smsPreviewCost.segments > 0 && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-clay">
                  {smsPreviewCost.segments === 1
                    ? d.smsFitsOne
                    : d.smsSplit
                        .replace("{segments}", String(smsPreviewCost.segments))
                        .replace("{over}", String(smsPreviewCost.overBy))}
                </p>
              )}

              {smsOver && (
                <p className="mt-2 rounded-xl bg-clay/10 px-3 py-2 text-[11px] leading-relaxed text-clay">
                  {d.smsTooLong
                    .replace("{n}", String(smsPreviewCost.segments))
                    .replace("{max}", String(smsMax))}
                </p>
              )}

              {smsPreviewCost.encoding === "unicode" && !smsOver && (
                <p className="mt-2 text-[11px] leading-relaxed text-clay">
                  {d.smsGreekWarning}
                </p>
              )}
            </div>
          )}
        </div>

        {/* --------------------------------------- exclusive categories
            Last, and deliberately so. The first two sections are the decisions
            every message needs — who, and how. This one is optional narrowing
            that most announcements will not touch, and it used to sit in the
            middle where it read as a required step.

            The test-account switch lives here too rather than floating on its
            own below. It is the same kind of thing: not "who may we write to"
            but "which of them is this actually for". */}
        <div className="mt-8 border-t border-mocha-200/70 pt-6">
          {/**
            * The title opens it, and it is shut to begin with.
            *
            * Most announcements go to everybody and never touch these, and four
            * controls sitting open under a heading read as four more decisions
            * to make before the Send button means anything. Behind a press they
            * are a thing you go and get.
            *
            * The summary beside the title is what makes that safe: closed, it
            * still says whether anything is narrowing the audience, so the one
            * state that must never be invisible — a filter left on from the last
            * message — is the one state it reports.
            */}
          <button
            type="button"
            data-segments-toggle
            aria-expanded={segOpen}
            onClick={() => setSegOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="text-[10px] uppercase tracking-brand text-clay">
              {d.segTitle}
            </span>
            {activeSegments > 0 && (
              <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[9px] uppercase tracking-widest text-[#8a6f1a]">
                {d.segOn.replace("{n}", String(activeSegments))}
              </span>
            )}
            <Chevron
              className={cn(
                "ml-auto text-clay transition-transform duration-300",
                segOpen && "rotate-180",
              )}
            />
          </button>

          {segOpen && (
          <>
          <p className="mt-2 text-[11px] leading-relaxed text-clay">
            {d.segHelp}
          </p>

          <div className="mt-4 space-y-2">
            {(
              [
                [
                  "neverPaid",
                  d.segNeverPaid,
                  d.segNeverPaidWhy,
                  neverPaid,
                  setNeverPaid,
                ],
                [
                  "noSessions",
                  d.segNoSessions,
                  d.segNoSessionsWhy,
                  noSessionsLeft,
                  setNoSessionsLeft,
                ],
              ] as const
            ).map(([key, label, why, on, set]) => (
              <button
                key={key}
                type="button"
                data-segment={key}
                aria-pressed={on}
                onClick={() => set((v: boolean) => !v)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors duration-300",
                  on
                    ? "border-mocha-600 bg-mocha-600/[0.06]"
                    : "border-mocha-200 hover:border-mocha-400",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px]",
                    on
                      ? "border-mocha-600 bg-mocha-600 text-cream"
                      : "border-mocha-300",
                  )}
                >
                  {on ? "✓" : ""}
                </span>
                <span className="flex-1">
                  <span className="text-[13px] text-mocha-700">{label}</span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-clay">
                    {why}
                  </span>
                </span>
              </button>
            ))}

            {/* Not been in for a while. Zero means "do not filter by this" —
                a number is easier to clear than a fourth checkbox. */}
            <div
              className={cn(
                "rounded-2xl border p-4 transition-colors duration-300",
                awayDays > 0
                  ? "border-mocha-600 bg-mocha-600/[0.06]"
                  : "border-mocha-200",
              )}
            >
              <p className="text-[13px] text-mocha-700">{d.segAway}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={awayValue}
                  data-segment="awayValue"
                  onChange={(e) =>
                    setAwayValue(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="input w-20 lining-nums tabular-nums"
                  aria-label={d.segAway}
                />
                <div className="flex gap-1.5">
                  {(
                    [
                      ["days", d.segDays],
                      ["weeks", d.segWeeks],
                      ["months", d.segMonths],
                    ] as const
                  ).map(([unit, label]) => (
                    <button
                      key={unit}
                      type="button"
                      data-segment-unit={unit}
                      aria-pressed={awayUnit === unit}
                      onClick={() => setAwayUnit(unit)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors",
                        awayUnit === unit
                          ? "border-mocha-600 bg-mocha-600 text-cream"
                          : "border-mocha-200 text-mocha-500 hover:border-mocha-400",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {awayValue > 0 && (
                  <button
                    type="button"
                    onClick={() => setAwayValue(0)}
                    className="text-[10px] uppercase tracking-widest text-clay underline decoration-clay/40 underline-offset-4"
                  >
                    {d.segClear}
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-clay">
                {awayDays > 0
                  ? d.segAwayOn.replace("{n}", String(awayDays))
                  : d.segAwayOff}
              </p>
            </div>
          </div>

          {/* Only shown when there is at least one test account. A checkbox that
            can never change anything is one more thing to read. */}
          {reach && reach.testAccounts > 0 && (
            <button
              type="button"
              data-include-test={includeTest ? "on" : "off"}
              aria-pressed={includeTest}
              onClick={() => setIncludeTest((v) => !v)}
              className={cn(
                "mt-6 flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors duration-300",
                includeTest
                  ? "border-mocha-600 bg-mocha-600/[0.06]"
                  : "border-mocha-200 hover:border-mocha-400",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px]",
                  includeTest
                    ? "border-mocha-600 bg-mocha-600 text-cream"
                    : "border-mocha-300",
                )}
              >
                {includeTest ? "✓" : ""}
              </span>
              <span className="flex-1">
                <span className="text-[13px] text-mocha-700">
                  {d.noticeIncludeTest}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-clay">
                  {(includeTest
                    ? d.noticeIncludeTestOn
                    : d.noticeIncludeTestOff
                  ).replace("{n}", String(reach.testAccounts))}
                </span>
              </span>
            </button>
          )}
          </>
          )}

          {/**
            * The number that matters, and it changed meaning.
            *
            * It used to read "5 members match", which is the size of the
            * audience: everybody whose consent and confirmed address let the
            * studio write to them. Above a Send button that reads as "five
            * people will get this", and it is not the same claim. Tick SMS only
            * and perhaps two of the five have a number the studio may text.
            *
            * So the headline is now the deduplicated union of the channels
            * actually ticked — two on SMS plus two on push is three people when
            * one has both — and the audience total moved to the line underneath,
            * where it belongs: it is the number that gets the in-app copy, which
            * always lands whatever is ticked.
            *
            * Stays visible with the filters collapsed, because it is the answer
            * the whole panel exists to give.
            */}
          {reach && (
            <div
              data-reach-total
              className="mt-5 text-[12px] leading-relaxed"
            >
              {reach.people === 0 ? (
                <p className="text-red-700">{d.segNobody}</p>
              ) : (
                <>
                  <p
                    data-reach-selected={selectedReach}
                    className={
                      selectedReach === 0 ? "text-gold" : "text-mocha-600"
                    }
                  >
                    {channels.length === 0
                      ? d.reachNoChannels
                      : selectedReach === 0
                        ? d.reachNoneOnThese
                        : d.reachOnChannels
                            .replace("{n}", String(selectedReach))
                            .replace("{channels}", channelWords)}
                  </p>
                  {/* The in-app copy, which is not a channel and cannot be
                      switched off. Said second because it is the constant. */}
                  <p className="mt-1 text-clay">
                    {d.reachInApp.replace("{n}", String(reach.people))}
                  </p>
                </>
              )}
              {/* Said rather than left to be noticed. An unconfirmed account is
                  left out of every channel, including the in-app copy, because it
                  cannot reach the list the copy would be filed in. */}
              {reach.unverifiedAccounts > 0 && (
                <p className="mt-1 text-clay">
                  {d.segUnverifiedOut.replace(
                    "{n}",
                    String(reach.unverifiedAccounts),
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <Button
          className="mt-6 block"
          size="sm"
          disabled={
            busy === "send" ||
            title.trim().length < 3 ||
            text.trim().length < 3 ||
            /* Keyed off the audience and not off the channels: with nothing
               ticked this still sends the in-app copy, which is a real thing to
               do and the studio's main channel. Only an audience of nobody has
               nothing to send. */
            reach?.people === 0
          }
          onClick={send}
        >
          {busy === "send"
            ? t.common.loading
            : audience === "OFFERS"
              ? d.noticeSendOffers
              : d.noticeSendAll}
        </Button>
      </div>

      <div className="rounded-3xl border border-mocha-200/70 bg-white/60 p-6">
        <p className="text-[10px] uppercase tracking-brand text-clay">
          {d.noticeHistory}
        </p>

        {/* "What did we send by SMS" is a question with a bill attached, so it
            gets its own answer rather than a scroll through everything. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              [null, d.noticeFilterAll, meta?.counts.all],
              ["push", d.chanPush, meta?.counts.push],
              ["email", d.chanEmail, meta?.counts.email],
              ["sms", d.chanSms, meta?.counts.sms],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key ?? "all"}
              type="button"
              data-history-filter={key ?? "all"}
              aria-pressed={channel === key}
              disabled={paging}
              onClick={() => setChannel(key)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[10px] uppercase tracking-widest transition-colors duration-300",
                channel === key
                  ? "border-mocha-600 bg-mocha-600 text-cream"
                  : "border-mocha-200 text-mocha-500 hover:border-mocha-400",
              )}
            >
              {label}
              <span className="ml-2 lining-nums tabular-nums opacity-70">
                {count ?? 0}
              </span>
            </button>
          ))}
        </div>

        {history.length === 0 ? (
          <p className="mt-5 text-sm text-clay">{d.noticeNone}</p>
        ) : (
          <ul className="mt-5 divide-y divide-mocha-200/70">
            {history.map((h) => (
              <li key={h.id} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="text-[14px] text-mocha-600">
                    {h.important && (
                      <span
                        aria-hidden
                        className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle"
                      />
                    )}
                    {h.titleEn}
                  </span>
                  <span className="text-[11px] text-clay lining-nums tabular-nums">
                    {h.reads}/{h.members} {d.noticeReads}
                  </span>
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-clay">
                  {fmtFullDate(h.createdAt)}
                  {h.author ? ` · ${h.author}` : ""}
                </p>
                {/* Who it went to, in the words recorded when it went out. It
                    cannot be worked out later: the audience for "not been for
                    three months" is different today, because people came back. */}
                <p className="mt-1 text-[11px] text-clay [overflow-wrap:anywhere]">
                  {h.segment ||
                    (h.audience === "OFFERS"
                      ? d.noticeAudienceOffers
                      : d.noticeAudienceAll)}
                </p>
                {h.deliveries.length > 0 && (
                  <p className="mt-1 text-[11px] text-clay lining-nums tabular-nums">
                    {h.deliveries
                      .map(
                        (x) =>
                          `${x.channel} ${x.sent}${x.failed ? ` (${x.failed} failed)` : ""}`,
                      )
                      .join(" · ")}
                  </p>
                )}
                {/**
                 * Why it failed, not just that it did.
                 *
                 * The reason was already being fetched — `detail` has been on
                 * this type the whole time and carries the gateway's own words,
                 * `sms.to 400: {"success":false,...}` — and then nothing
                 * rendered it. So the desk read "1 failed" and had nowhere to
                 * go, which is how a five-second answer becomes a phone call to
                 * whoever built the website.
                 *
                 * Only on failure: a successful send has nothing to explain, and
                 * a line of gateway chatter under every notice would train
                 * everybody to stop reading this area.
                 */}
                {h.deliveries
                  .filter((x) => x.failed > 0 && x.detail)
                  .map((x) => (
                    <p
                      key={x.channel}
                      className="mt-1 rounded-lg bg-mocha-50 px-2 py-1.5 text-[11px] text-mocha-500 [overflow-wrap:anywhere]"
                    >
                      <span className="uppercase tracking-wider text-clay">
                        {x.channel}
                      </span>{" "}
                      {x.detail}
                    </p>
                  ))}
                <p className="mt-2 line-clamp-2 text-[13px] text-mocha-500">
                  {h.bodyEn}
                </p>
              </li>
            ))}
          </ul>
        )}

        {meta && (
          <Pager
            page={meta.page}
            pages={meta.pages}
            total={meta.total}
            busy={paging}
            onPage={(p) => void goPage(p)}
            labels={{
              newer: t.notices.pagerNewer,
              older: t.notices.pagerOlder,
              of: t.notices.pagerOf,
            }}
          />
        )}
      </div>
    </div>
  );
}
