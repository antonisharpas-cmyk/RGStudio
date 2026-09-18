import type { Metadata } from "next";
import {
  ScheduleClient,
  type ScheduleClassType,
  type ScheduleSession,
} from "@/components/booking/ScheduleClient";
import { TimetableIntro } from "@/components/booking/TimetableIntro";
import { readSession } from "@/lib/auth";
import { closedDayReasons } from "@/lib/closures";
import { listSessions } from "@/lib/booking";
import { getAvailableCredits, getCreditSummary } from "@/lib/credits";
import {
  studioAddDays,
  studioDateKey,
  studioDayKeys,
  studioStartOfDay,
} from "@/lib/time";
import { pushPublicKey } from "@/lib/messaging/push";
import { isPersonalBookable } from "@/lib/personal";
import {
  BOOKING_HORIZON_DAYS,
  nudgeTimetable,
  TIMETABLE_DAYS,
} from "@/lib/schedule";
import { STUDIO } from "@/lib/studio";
import { isBookable } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Timetable",
  description:
    "Live Reformer Pilates timetable at RG Pilates Studio, with personal and duet sessions at midday. Book with sessions, free cancellation up to 12 hours before a class.",
};

export const dynamic = "force-dynamic";

/* How many days the strip shows at once. The horizon a member may *book*
   within is a year — see BOOKING_HORIZON_DAYS — and this window slides across
   it. Rendering the whole year came to 1.3 MB of HTML for no benefit. */
const DAYS_SHOWN = TIMETABLE_DAYS;

/**
 * Where the window starts, from `?date=`.
 *
 * The calendar picker hands a date here rather than fetching one, so moving to
 * March is an ordinary page load: server-rendered, shareable as a link, and
 * back works. Clamped to today at the near end and to the booking horizon at
 * the far end, because the address bar is not a promise — a hand-typed
 * `?date=2035-01-01` should land somewhere sensible rather than on an empty
 * strip. Anything unparseable is simply today.
 */
function windowStart(raw: string | undefined) {
  const today = studioStartOfDay(new Date());
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return today;
  const asked = studioStartOfDay(new Date(`${raw}T12:00:00`));
  if (Number.isNaN(asked.getTime()) || asked < today) return today;
  /* Leave a full window's worth in front of the last bookable day, so the far
     end of the year is reachable without the strip running off the horizon. */
  const latest = studioAddDays(today, BOOKING_HORIZON_DAYS - DAYS_SHOWN);
  return asked > latest ? latest : asked;
}

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  /* Keep the far end of the strip stocked. Once per studio day at most, and the
     page renders whether or not it did anything — see nudgeTimetable. The cron
     sweep is the proper home for this; the timetable is the page that would show
     the shortfall, and it is opened dozens of times a day. */
  nudgeTimetable();

  const session = await readSession();
  const { date } = await searchParams;
  const from = windowStart(date);
  const to = studioAddDays(from, DAYS_SHOWN);

  const [rows, credits, summary] = await Promise.all([
    listSessions({ from, to, userId: session?.sub ?? null }),
    session ? getAvailableCredits(session.sub) : Promise.resolve(0),
    session ? getCreditSummary(session.sub) : Promise.resolve(null),
  ]);

  const now = new Date();
  const sessions: ScheduleSession[] = rows
    .filter((s) => s.status === "SCHEDULED")
    .map((s) => ({
      id: s.id,
      day: studioDateKey(s.startsAt),
      startsAt: s.startsAt.toISOString(),
      capacity: s.capacity,
      booked: s.booked,
      spotsLeft: s.spotsLeft,
      status: s.status,
      /* Two cutoffs, one field. An appointment closes at the end of the
         previous day and a class closes a minute before it starts, and the chip
         on screen has to reflect whichever rule the Book button will apply. */
      bookable:
        s.classType.kind === "PERSONAL"
          ? isPersonalBookable(s.startsAt, now)
          : isBookable(s.startsAt, now),
      type: s.classType.slug,
      /* This class's own level, so one Thursday can read Beginners while the
         rest of the same class type stays All levels. */
      level: s.level,
      instructor: s.instructor?.name ?? null,
      myBookingId: s.myBookingId ?? null,
    }));

  /* Sent once, keyed by slug, instead of repeated on all ~230 classes. */
  const types: Record<string, ScheduleClassType> = {};
  for (const s of rows) {
    types[s.classType.slug] ??= {
      slug: s.classType.slug,
      nameEn: s.classType.nameEn,
      nameEl: s.classType.nameEl,
      level: s.classType.level,
      intensity: s.classType.intensity,
      kind: s.classType.kind,
      /* Class length is a studio fact, not something to infer from a row. It
         used to be measured off the first session of each type, and because
         the window starts at midnight that first session is often one that has
         already finished today — so a single class left over from an older
         rota made every class of that type read 50 minutes. */
      durationMin: STUDIO.classLengthMinutes,
    };
  }

  /* Keep Sundays and any manually closed days visible so the timetable makes the
     studio's closure status explicit instead of silently dropping the date. */
  const closed = closedDayReasons();
  const days = studioDayKeys(from, DAYS_SHOWN);

  return (
    <TimetableIntro>
      <ScheduleClient
        /**
         * Remount when the window moves, and only then.
         *
         * Picking a date outside the strip, or pressing the "next 30 days"
         * arrow, is a soft navigation to `/timetable?date=...`: the server
         * re-renders this page with a fresh `days` window and its `sessions`,
         * but React keeps the same client instance in place and reconciles it.
         * The strip chips update because they read `days` straight from props —
         * but the slot list reads `sessions`, which the client holds in state
         * seeded once on mount, so it kept showing the old window's classes (or
         * nothing) until a hard refresh remounted the component. Keying on the
         * window's first day makes a window move a genuine remount, so the
         * client always re-seeds from the server data for the days it is
         * showing. Within a window — booking, cancelling, stepping a day — the
         * key is unchanged and all transient state is preserved as before.
         */
        key={days[0]}
        sessions={sessions}
        types={types}
        signedIn={Boolean(session)}
        credits={credits}
        /* Both halves separately, because the two are not interchangeable: the
           panel offers "two of us" only to somebody holding a Duet session, and
           insists on it when a Duet is the only thing they hold. Letting them
           fill in a name and then be refused by the server is the version of
           this that reads as a fault. */
        duetCredits={summary?.duetCredits ?? 0}
        soloCredits={summary?.soloCredits ?? 0}
        personalCredits={summary?.personalCredits ?? 0}
        days={days}
        /* The picker's bounds: the first and last day anybody may book, which
           is a year wide even though `days` above is ninety. Passed as keys
           rather than as a count so the client never does the arithmetic
           twice. */
        firstBookableDay={studioDateKey(studioStartOfDay(new Date()))}
        lastBookableDay={studioDateKey(
          studioAddDays(studioStartOfDay(new Date()), BOOKING_HORIZON_DAYS - 1),
        )}
        closedDays={closed}
        /* For the notification offer made after a booking. Empty when the
           server has no usable VAPID pair, and the panel then never appears. */
        pushPublicKey={pushPublicKey()}
      />
    </TimetableIntro>
  );
}
