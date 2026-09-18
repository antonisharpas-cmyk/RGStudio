"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { STUDIO } from "@/lib/studio";
import {
  DEFAULT_LOCALE,
  dictionaries,
  LOCALE_COOKIE,
  type Dictionary,
  type Locale,
} from "./dictionaries";

type Ctx = {
  locale: Locale;
  t: Dictionary;
  setLocale: (l: Locale) => void;
  /** 18:30 */
  fmtTime: (d: DateLike) => string;
  /** Mon 24 Aug */
  fmtShortDate: (d: DateLike) => string;
  /** Monday 24 August */
  fmtLongDate: (d: DateLike) => string;
  /** 24 Aug */
  fmtDayMonth: (d: DateLike) => string;
  /** 24 August 2026 */
  fmtFullDate: (d: DateLike) => string;
  /** Aug 2026 */
  fmtMonthYear: (d: DateLike) => string;
  /** Aug — the month on its own, for the timetable's day chips. */
  fmtMonthShort: (d: DateLike) => string;
  /** 24 */
  fmtDayNumber: (d: DateLike) => string;
  /** Mon */
  fmtWeekdayShort: (d: DateLike) => string;
  /** €200 / €22.50 */
  fmtMoney: (cents: number) => string;
  /**
   * "1 session" / "5 sessions", in either language.
   *
   * Exists because the plural was wrong in nine places and had been fixed by
   * hand in one. A balance of exactly one session is not a rare edge case here:
   * the Day pass *is* one session, appointments are bought singly, and a member
   * who has used all but their last is looking at "1 sessions" on the header of
   * every page. Greek needs the same treatment and gets it from the same
   * dictionary, so neither language can drift from the other.
   */
  fmtSessions: (n: number) => string;
  /**
   * "1 spot left" / "4 spots left", in either language.
   *
   * The timetable used to print the raw ratio, `4/5`, which reads as a score:
   * a member glancing at it has to work out which half is the one they care
   * about, and the capacity is not information they can act on. The same
   * singular problem as fmtSessions above, and the same fix.
   */
  fmtSpots: (n: number) => string;
};

type DateLike = Date | string | number;

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    /**
     * Written here, on the press, and nowhere else.
     *
     * That timing is the whole reason this site needs no consent banner. The
     * cookie is not set on arrival and not set by browsing: it appears only in
     * the instant somebody clicks EN or EL, so the click is the request, and an
     * interface preference the visitor asks for themselves is exempt from the
     * consent requirement. A visitor who never touches the switch never has it.
     *
     * The switch would work without the cookie: this page turns Greek from
     * React state, not from here. What the cookie buys is the *next* visit
     * opening in Greek. It holds "en", "el" or "ru" and nothing else. See /cookies,
     * which says so in both languages.
     */
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.lang = l;

    /**
     * And on the account, when there is one.
     *
     * The cookie makes this page Greek. It cannot make the *next notification*
     * Greek, because a reminder for a class in two hours is composed by a sweep
     * on the server with no browser and no cookie anywhere near it — which is
     * exactly how members reading the site in Greek ended up with a Greek notice
     * in their account and an English copy of it on their phone.
     *
     * Deliberately not awaited and deliberately swallowing its own failure. The
     * switch has already done the thing the member pressed it for by the time
     * this leaves; a slow network must not make the language take a moment to
     * change, and a failed write is a notification in the wrong language, not a
     * broken page. The route answers 200 for a signed-out visitor, for whom the
     * cookie above is the whole story.
     */
    void fetch("/api/me/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: l }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const value = useMemo<Ctx>(() => {
    const intlLocale =
      locale === "el" ? "el-GR" : locale === "ru" ? "ru-RU" : "en-GB";
    /* Russian has a third plural form for 2 to 4 ("2 занятия", "5 занятий").
       English and Greek report "other" for those and get the ordinary plural. */
    const plural = new Intl.PluralRules(intlLocale);
    const count = (n: number, one: string, few: string, many: string) => {
      const cat = plural.select(n);
      return `${n} ${cat === "one" ? one : cat === "few" ? few : many}`;
    };
    const tz = STUDIO.timezone;

    /**
     * Dates are composed from single Intl fields rather than asked of Intl as a
     * whole. Node and the browser ship different ICU versions, and they disagree
     * about the separators in multi-field patterns ("Mon 24 Aug" vs
     * "Mon, 24 Aug") — which shows up as a React hydration mismatch. Single
     * fields are stable everywhere, so we join them ourselves.
     *
     * Everything is rendered in the studio's timezone: a class at 18:00 in
     * Nicosia reads 18:00 to someone browsing from London.
     */
    const part = (opts: Intl.DateTimeFormatOptions) => {
      const f = new Intl.DateTimeFormat(intlLocale, { timeZone: tz, ...opts });
      return (d: DateLike) => f.format(toDate(d));
    };

    const weekdayShort = part({ weekday: "short" });
    const weekdayLong = part({ weekday: "long" });
    const monthShort = part({ month: "short" });
    const monthLong = part({ month: "long" });
    const dayNumber = part({ day: "numeric" });
    const year = part({ year: "numeric" });
    const time = part({ hour: "2-digit", minute: "2-digit", hour12: false });

    const clean = (s: string) => s.replace(/[.,]$/, "");

    /* Two decimals, then the whole ones are trimmed back off below.
       Asking Intl for a minimum of zero instead gave "€12.5" for a
       per-class price of twelve fifty — one decimal, which reads as an
       unfinished number on a price list. */
    const money = new Intl.NumberFormat(intlLocale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return {
      locale,
      t: dictionaries[locale],
      setLocale,
      fmtTime: (d) => time(d),
      fmtShortDate: (d) =>
        `${clean(weekdayShort(d))} ${dayNumber(d)} ${clean(monthShort(d))}`,
      fmtLongDate: (d) => `${weekdayLong(d)} ${dayNumber(d)} ${monthLong(d)}`,
      fmtDayMonth: (d) => `${dayNumber(d)} ${clean(monthShort(d))}`,
      fmtFullDate: (d) => `${dayNumber(d)} ${monthLong(d)} ${year(d)}`,
      fmtMonthYear: (d) => `${clean(monthShort(d))} ${year(d)}`,
      fmtMonthShort: (d) => clean(monthShort(d)),
      fmtDayNumber: (d) => dayNumber(d),
      fmtWeekdayShort: (d) => clean(weekdayShort(d)),
      /* "€15.00" becomes "€15", "€12.50" stays. Not anchored to the end of the
         string, because Greek puts the symbol last — "15,00 €" — and an
         anchored strip left the zeros on in Greek only. The lookahead keeps it
         off the thousands separator in "€1,000.00". */
      fmtMoney: (cents) =>
        money.format(cents / 100).replace(/([.,])00(?!\d)/, ""),
      fmtSessions: (n) => {
        const c = dictionaries[locale].common;
        return count(n, c.credit, c.creditsFew, c.credits);
      },
      fmtSpots: (n) => {
        const c = dictionaries[locale].common;
        return count(n, c.spotLeft, c.spotsLeftFew, c.spotsLeft);
      },
    };
  }, [locale, setLocale]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

function toDate(d: DateLike) {
  return d instanceof Date ? d : new Date(d);
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used inside <LanguageProvider>");
  return ctx;
}
