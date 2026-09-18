import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { noticeDeliveries, noticeReads, notices, users } from "@/db/schema";

/**
 * Messages from the studio to its members.
 *
 * Two kinds share this table, because from the member's side they are one inbox:
 * the studio's announcements, and the messages about their own bookings — a
 * confirmation, a cancellation, a reminder. One unread count on their
 * photograph, one list, one read state. `userId` tells them apart: null is the
 * studio talking to everybody, set is the studio talking to one person.
 *
 * Written at the desk, read in the member's account. The in-app copy is the one
 * that always exists: the message lands in the app, the count appears next to
 * the member's face, and it is theirs the next time they open the site — whether
 * or not push, email or SMS got through. See src/lib/messaging/deliver.ts for
 * the channels that go out alongside it, and who each one is allowed to reach.
 *
 * Read state is stored as *presence*: a row in notice_reads means read. So
 * sending a notice to four hundred members writes one row, not four hundred,
 * and "unread" costs a left join rather than a fan-out.
 *
 * The trade that buys is that a member's list is computed rather than stored,
 * which is why `visibleTo` carries every rule about who may see what: the offers
 * consent, and the date they joined.
 */


/**
 * Which notices this member is allowed to see, in SQL.
 *
 * Studio and timetable notices go to everyone. Offers only exist for members who
 * ticked offers — and that has to be enforced here, on the read, not only at the
 * moment of sending. Otherwise a member who declines offers today would still
 * find yesterday's offer sitting in their account, and turning offers off would
 * mean nothing retrospectively.
 */
function visibleTo(userId: string) {
  return sql`(
    /* Somebody else's booking confirmation is not theirs to read. */
    (${notices.userId} is null or ${notices.userId} = ${userId})
    and (
      ${notices.audience} <> 'OFFERS'
      or exists (
        select 1 from users u
        where u.id = ${userId} and u.marketing_opt_in = 1
      )
    )
    /* And nothing from before they joined. Somebody who signs up today has not
       missed last month's closure — they were not a member — and handing a new
       account thirty unread messages, with thirty on their photograph, is a
       worse welcome than an empty list. */
    and ${notices.createdAt} >= (
      select u2.created_at from users u2 where u2.id = ${userId}
    )
    /* A test account sees a studio announcement only if that announcement
       deliberately included test accounts. Its own booking confirmations are
       unaffected — those have a user_id and belong to it.

       Without this, "excluded from the campaign" meant excluded from email and
       SMS but not from the list, so the desk's read count included accounts it
       had just been told were left out. Found by a test, not by reasoning. */
    and (
      ${notices.userId} is not null
      or ${notices.includedTest} = 1
      or not exists (
        select 1 from users u3 where u3.id = ${userId} and u3.is_test = 1
      )
    )
  )`;
}

export type NoticeView = {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  important: boolean;
  read: boolean;
};

export function createNotice(args: {
  titleEn: string;
  bodyEn: string;
  titleEl?: string;
  bodyEl?: string;
  important?: boolean;
  /** ALL for studio and timetable notices, OFFERS for the opt-in audience. */
  audience?: "ALL" | "OFFERS";
  /** Which channels it was sent on, recorded so the history says what happened. */
  channels?: string[];
  /** Whether accounts marked as tests were deliberately included. */
  includedTest?: boolean;
  /** Who it went to, in words. See notices.segment. */
  segment?: string;
  /** Set for a message about one member's own booking; omitted for the studio's. */
  userId?: string | null;
  staffId?: string | null;
}) {
  return db
    .insert(notices)
    .values({
      titleEn: args.titleEn,
      bodyEn: args.bodyEn,
      titleEl: args.titleEl ?? "",
      bodyEl: args.bodyEl ?? "",
      important: args.important ?? false,
      audience: args.audience ?? "ALL",
      channels: (args.channels ?? []).join(","),
      includedTest: args.includedTest ?? false,
      segment: args.segment ?? "",
      userId: args.userId ?? null,
      createdBy: args.staffId ?? null,
    })
    .returning()
    .get();
}

export function deleteNotice(id: string) {
  return db.delete(notices).where(eq(notices.id, id)).run().changes > 0;
}

/** What one member sees, newest first, with their own read state. */
export type NoticePage = {
  rows: NoticeView[];
  /** How many match the current filter, so a page count can be worked out. */
  total: number;
  page: number;
  pages: number;
  /** All three counts, so the filter pills can be labelled without three calls. */
  counts: { all: number; unread: number; read: number };
};

export const NOTICES_PER_PAGE = 5;

/**
 * One page of the member's notices.
 *
 * Paged rather than "the most recent thirty", which is what it used to be, and
 * the difference is not cosmetic: a member two years into their membership has
 * several hundred of these — one for every class they booked and every one they
 * cancelled — and the thirty-first was simply unreachable. Now every message the
 * studio ever sent them can be got back to, five at a time.
 *
 * Filtering and counting happen in SQL rather than in the browser for the same
 * reason. Filtering an array the server had already truncated gave answers that
 * looked right and were wrong: "3 unread" meant three unread *in the last
 * thirty*, and a member with forty unread was told three.
 */
export function noticesFor(
  userId: string,
  locale: string = "en",
  opts: { filter?: "all" | "unread" | "read"; page?: number; perPage?: number } = {},
): NoticePage {
  const filter = opts.filter ?? "all";
  const perPage = Math.min(Math.max(opts.perPage ?? NOTICES_PER_PAGE, 1), 50);

  const mine = sql`${noticeReads.noticeId} = ${notices.id} and ${noticeReads.userId} = ${userId}`;
  const unreadOnly = sql`${noticeReads.readAt} is null`;
  const readOnly = sql`${noticeReads.readAt} is not null`;

  const where =
    filter === "unread"
      ? sql`${visibleTo(userId)} and ${unreadOnly}`
      : filter === "read"
        ? sql`${visibleTo(userId)} and ${readOnly}`
        : visibleTo(userId);

  const countOf = (rule: ReturnType<typeof sql>) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(notices)
      .leftJoin(noticeReads, mine)
      .where(rule)
      .get()?.n ?? 0;

  const counts = {
    all: countOf(visibleTo(userId)),
    unread: countOf(sql`${visibleTo(userId)} and ${unreadOnly}`),
    read: countOf(sql`${visibleTo(userId)} and ${readOnly}`),
  };

  const total = filter === "all" ? counts.all : filter === "unread" ? counts.unread : counts.read;
  const pages = Math.max(1, Math.ceil(total / perPage));
  /* A member on page 4 who marks everything read would otherwise land on a page
     that no longer exists and see nothing at all. */
  const page = Math.min(Math.max(opts.page ?? 1, 1), pages);

  const rows = db
    .select({
      id: notices.id,
      titleEn: notices.titleEn,
      titleEl: notices.titleEl,
      bodyEn: notices.bodyEn,
      bodyEl: notices.bodyEl,
      important: notices.important,
      createdAt: notices.createdAt,
      readAt: noticeReads.readAt,
    })
    .from(notices)
    .leftJoin(noticeReads, mine)
    .where(where)
    /* Timestamps are whole seconds, so two notices written in the same second
       tie — and the tie-break decided which of "Booking confirmed" and "Booking
       cancelled" appeared on top. rowid is the insertion order, so the later one
       is genuinely later. */
    .orderBy(desc(notices.createdAt), sql`${notices}.rowid desc`)
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all();

  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: (locale === "el" && r.titleEl) || r.titleEn,
      body: (locale === "el" && r.bodyEl) || r.bodyEn,
      createdAt: r.createdAt,
      important: r.important,
      read: r.readAt !== null,
    })),
    total,
    page,
    pages,
    counts,
  };
}

/** The number next to the member's face in the corner. */
export function unreadCount(userId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(notices)
    .leftJoin(
      noticeReads,
      sql`${noticeReads.noticeId} = ${notices.id} and ${noticeReads.userId} = ${userId}`,
    )
    .where(sql`${noticeReads.readAt} is null and ${visibleTo(userId)}`)
    .get();
  return row?.n ?? 0;
}

/** Mark one notice read, or every notice the member can see. */
export function markRead(userId: string, noticeId?: string) {
  const now = new Date();
  const ids = noticeId
    ? [noticeId]
    : db
        .select({ id: notices.id })
        .from(notices)
        .where(visibleTo(userId))
        .all()
        .map((r) => r.id);

  for (const id of ids) {
    /* Reading twice is not an error, and the first time is the one that
       counts — so the timestamp is left alone on a repeat. */
    db.insert(noticeReads)
      .values({ noticeId: id, userId, readAt: now })
      .onConflictDoNothing()
      .run();
  }
  return ids.length;
}

export const HISTORY_PER_PAGE = 5;

/**
 * For the desk: what has been sent, and how many people have read each one.
 *
 * Filtered by channel and paged, because "what did we send by SMS" is a real
 * question with a real cost attached to it, and scrolling a single list of two
 * hundred announcements looking for the ones that cost money is not an answer.
 *
 * The channel filter reads the `channels` column — what was chosen when the
 * notice went out — which is exactly what the chips on each row show, so the
 * filter and the display can never disagree.
 */
export function noticeHistory(
  opts: { channel?: "push" | "email" | "sms" | null; page?: number; perPage?: number } = {},
) {
  const perPage = Math.min(Math.max(opts.perPage ?? HISTORY_PER_PAGE, 1), 50);
  const channel = opts.channel ?? null;

  /* The studio's own announcements. Personal booking confirmations live in the
     same table and are the member's business, not a list for the desk to scroll
     through — there are hundreds of them and none is news. */
  const base = isNull(notices.userId);
  const where = channel
    ? sql`${base} and (',' || ${notices.channels} || ',') like ${"%," + channel + ",%"}`
    : base;

  const countFor = (c: "push" | "email" | "sms" | null) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(notices)
      .where(
        c
          ? sql`${base} and (',' || ${notices.channels} || ',') like ${"%," + c + ",%"}`
          : base,
      )
      .get()?.n ?? 0;

  const counts = {
    all: countFor(null),
    push: countFor("push"),
    email: countFor("email"),
    sms: countFor("sms"),
  };

  const total = channel ? counts[channel] : counts.all;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(opts.page ?? 1, 1), pages);

  const rows = db
    .select({
      id: notices.id,
      titleEn: notices.titleEn,
      bodyEn: notices.bodyEn,
      titleEl: notices.titleEl,
      bodyEl: notices.bodyEl,
      important: notices.important,
      audience: notices.audience,
      channels: notices.channels,
      segment: notices.segment,
      createdAt: notices.createdAt,
      author: users.name,
    })
    .from(notices)
    .leftJoin(users, eq(notices.createdBy, users.id))
    .where(where)
    .orderBy(desc(notices.createdAt), sql`${notices}.rowid desc`)
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all();

  /* "3 of 40 read" has to be out of the members who could read it, so test
     accounts are not in the denominator. */
  const members =
    db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(sql`${users.role} = 'MEMBER' and ${users.isTest} = 0`)
      .get()?.n ?? 0;

  return {
    rows: rows.map((r) => ({
      ...r,
      members,
      /* What each channel did with it, so "sent" is a fact rather than a hope. */
      deliveries: db
        .select()
        .from(noticeDeliveries)
        .where(eq(noticeDeliveries.noticeId, r.id))
        .all()
        .map((d) => ({
          channel: d.channel,
          sent: d.sent,
          failed: d.failed,
          skipped: d.skipped,
          detail: d.detail,
        })),
      reads:
        db
          .select({ n: sql<number>`count(*)` })
          .from(noticeReads)
          .where(eq(noticeReads.noticeId, r.id))
          .get()?.n ?? 0,
    })),
    total,
    page,
    pages,
    counts,
  };
}
