import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import {
  deliverNotice,
  describeSegment,
  reachOf,
  transportStatus,
  type Audience,
  type Segment,
} from "@/lib/messaging/deliver";
import { pushReady } from "@/lib/messaging/push";
import { MAX_SEGMENTS, smsBodyFor, smsCost } from "@/lib/messaging/segments";
import { CHANNELS, type Channel } from "@/lib/messaging/types";
import { createNotice, deleteNotice, noticeHistory } from "@/lib/notices";

/**
 * Messages from the studio to its members.
 *
 * Every notice lands in the member's account whatever else happens — that part
 * is not optional and not a channel. Push, email and SMS are then chosen at the
 * desk, and each one is filtered again by what the member agreed to.
 *
 * The audience is the important guard: OFFERS never reaches somebody who did not
 * tick offers, however the request is put together. That is checked here rather
 * than in the screen, because a screen is a suggestion.
 */
export const dynamic = "force-dynamic";

/**
 * A segment, cleaned up.
 *
 * A day count is capped rather than trusted: an absurd number is either a typo
 * or somebody poking at the endpoint, and in both cases the honest response is
 * a sane audience rather than an error. Ten years is longer than the studio has
 * existed, so nothing real is lost at the ceiling.
 */
function segmentFrom(raw: {
  neverPaid: boolean;
  noSessionsLeft: boolean;
  inactiveDays: number;
}): Segment {
  const days = Number.isFinite(raw.inactiveDays)
    ? Math.min(Math.max(Math.trunc(raw.inactiveDays), 0), 3650)
    : 0;
  return {
    ...(raw.neverPaid ? { neverPaid: true } : {}),
    ...(raw.noSessionsLeft ? { noSessionsLeft: true } : {}),
    ...(days > 0 ? { inactiveDays: days } : {}),
  };
}

export async function GET(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  /* The desk asks before writing: how many people would each channel reach if
     I sent this now. Sending blind to four hundred people is how a studio
     discovers its SMS bill after the fact. */
  const url = new URL(req.url);
  const audience: Audience =
    url.searchParams.get("audience") === "OFFERS" ? "OFFERS" : "ALL";
  const includeTest = url.searchParams.get("includeTest") === "1";
  const segment = segmentFrom({
    neverPaid: url.searchParams.get("neverPaid") === "1",
    noSessionsLeft: url.searchParams.get("noSessionsLeft") === "1",
    inactiveDays: Number(url.searchParams.get("inactiveDays") ?? 0),
  });

  /* The history is filtered and paged server side. "What did we send by SMS" is
     a question with a bill attached to it, and scrolling two hundred rows
     looking for the ones that cost money is not an answer. */
  const asked = url.searchParams.get("channel");
  const channel =
    asked === "push" || asked === "email" || asked === "sms" ? asked : null;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);

  const history = noticeHistory({ channel, page });

  return NextResponse.json({
    /* Kept as `notices` for the rows so the screen's existing reader is happy,
       with the paging alongside it. */
    notices: history.rows,
    history: { page: history.page, pages: history.pages, total: history.total, counts: history.counts },
    channel,
    reach: reachOf(audience, includeTest, segment),
    includeTest,
    segment,
    transports: { ...transportStatus(), push: { name: "Web push", ready: pushReady() } },
    /* So the screen can put a number next to the SMS box while the desk types.
       The price is configuration, not a guess: unset it and the screen shows
       segments and stays quiet about money, which is the honest failure mode. */
    sms: {
      maxSegments: MAX_SEGMENTS,
      /* The name that will appear where a phone number normally does, so the
         preview at the desk shows the real thing rather than a guess. */
      sender: process.env.SMS_SENDER ?? process.env.TWILIO_FROM ?? "RG Pilates Studio",
      pricePerSegment: Number.isFinite(Number(process.env.SMS_PRICE_PER_SEGMENT))
        ? Number(process.env.SMS_PRICE_PER_SEGMENT)
        : null,
    },
  });
}

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const data = await body<{
    titleEn?: string;
    bodyEn?: string;
    titleEl?: string;
    bodyEl?: string;
    important?: boolean;
    audience?: string;
    channels?: string[];
    includeTest?: boolean;
    neverPaid?: boolean;
    noSessionsLeft?: boolean;
    inactiveDays?: number;
    smsLang?: string;
    smsEn?: string;
    smsEl?: string;
  }>(req);

  const title = (data?.titleEn ?? "").trim();
  const text = (data?.bodyEn ?? "").trim();

  /* A notice with no words in it would still light up everybody's badge. */
  if (title.length < 3 || text.length < 3) {
    return NextResponse.json({ error: "TOO_SHORT" }, { status: 400 });
  }
  if (title.length > 120 || text.length > 2000) {
    return NextResponse.json({ error: "TOO_LONG" }, { status: 400 });
  }

  const audience: Audience = data?.audience === "OFFERS" ? "OFFERS" : "ALL";
  const channels = (data?.channels ?? []).filter((c): c is Channel =>
    CHANNELS.includes(c as Channel),
  );
  /* Read from the body and sanitised here, not trusted from the screen: a
     segment decides who gets written to, so it is checked on the way in like
     the audience is. */
  const segment = segmentFrom({
    neverPaid: Boolean(data?.neverPaid),
    noSessionsLeft: Boolean(data?.noSessionsLeft),
    inactiveDays: Number(data?.inactiveDays ?? 0),
  });

  /* Which language the text message carries, and a short version of it.
     English unless asked otherwise, because English is one segment and Greek is
     three. Anything unrecognised means English rather than an error — a typo in
     a field should not stop a studio announcing that a class is cancelled. */
  const smsLang: "en" | "el" | "both" =
    data?.smsLang === "el" ? "el" : data?.smsLang === "both" ? "both" : "en";
  const smsText = {
    en: (data?.smsEn ?? "").trim() || undefined,
    el: (data?.smsEl ?? "").trim() || undefined,
  };

  /* The guard that stops an expensive mistake.
     Checked here and not only in the screen, because the screen is a suggestion
     and this one has an invoice attached. The message is refused *before* the
     notice is written, so the desk can shorten the text and send once rather
     than finding a half-sent announcement in the history. */
  if (channels.includes("sms")) {
    const preview = smsBodyFor(
      smsLang,
      { subject: title, body: text },
      data?.titleEl && data?.bodyEl
        ? { subject: data.titleEl.trim(), body: data.bodyEl.trim() }
        : undefined,
      smsText,
    );
    const cost = smsCost(preview);
    if (cost.segments > MAX_SEGMENTS) {
      return NextResponse.json(
        {
          error: "SMS_TOO_LONG",
          segments: cost.segments,
          max: MAX_SEGMENTS,
          encoding: cost.encoding,
        },
        { status: 400 },
      );
    }
  }

  const notice = createNotice({
    titleEn: title,
    bodyEn: text,
    titleEl: (data?.titleEl ?? "").trim(),
    bodyEl: (data?.bodyEl ?? "").trim(),
    important: Boolean(data?.important),
    audience,
    channels,
    includedTest: Boolean(data?.includeTest),
    segment: describeSegment(audience, segment, Boolean(data?.includeTest)),
    staffId: gate.user.id,
  });

  /* The notice exists now. If a channel fails after this point the message is
     still in every member's account, which is the outcome that matters. */
  const reports = channels.length
    ? await deliverNotice({
        noticeId: notice.id,
        audience,
        channels,
        en: {
          subject: title,
          body: text,
          url: "/account?tab=notifications",
        },
        el:
          data?.titleEl && data?.bodyEl
            ? { subject: data.titleEl.trim(), body: data.bodyEl.trim() }
            : undefined,
        includeTest: Boolean(data?.includeTest),
        segment,
        smsLang,
        smsText,
      })
    : [];

  return NextResponse.json({ ok: true, id: notice.id, audience, reports });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  return NextResponse.json({ ok: deleteNotice(id) });
}
