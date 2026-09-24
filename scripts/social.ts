/**
 * The studio's Instagram and Facebook cards, built from the app's own data.
 *
 *   npm run social
 *
 * Into `docs/social/`, in both shapes a studio actually posts:
 *
 *   1080 x 1350   the feed, on Instagram and Facebook. The tallest an Instagram
 *                 post may be, so the one that takes the most of the screen
 *   1080 x 1920   an Instagram or Facebook story, full screen on a phone
 *
 * `--post` or `--story` for one of them.
 *
 * ---
 *
 * **Why a script and not a design file.**
 *
 * Because the prices on the poster and the prices at the checkout have to be the
 * same number, and the only way to guarantee that is to read them from the same
 * place. `PACKS` is the price list for the website, the desk and now the artwork;
 * the timetable comes out of `class_templates`, which is what actually generates
 * the classes. Change a price, run this, post the new card. Nobody has to
 * remember to edit a second copy, which is the mistake that puts last month's
 * price in front of four thousand people.
 *
 * The same reasoning applies to what is deliberately *not* on these cards. The
 * studio's phone number, email and domain are still placeholders in
 * `lib/studio.ts`, and a placeholder on a public poster is worse than no
 * placeholder. So the footer carries the Instagram handle and the street address,
 * both of which are real. When the studio confirms the rest, add them here.
 *
 * ---
 *
 * **What it needs installed.** Playwright to render, and two font families from
 * npm, because the brand's own faces have no Greek:
 *
 *   npm i -D playwright-core @fontsource/eb-garamond @fontsource/open-sans
 *
 * Cormorant Garamond and Jost, which the website uses, ship no Greek subset at
 * all. EB Garamond is the same Garamond revival with a proper Greek, so the two
 * language versions of a card are identical apart from the words. That is worth
 * more on a bilingual island than an exact match with the website's Latin.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../src/db";
import { PACKS } from "../src/lib/packs";
import { STUDIO } from "../src/lib/studio";

const OUT = "docs/social";
const W = 1080;

/**
 * The two shapes, and why a story is not simply a taller post.
 *
 * A feed post is looked at in a scrolling column with the whole image visible.
 * A story is full screen on a phone with Instagram's own furniture on top of it:
 * the profile row and the close button eat roughly the top 250 pixels, and the
 * reply bar, link sticker and "send message" eat about 300 at the bottom.
 * Anything put there is either covered or tapped by accident.
 *
 * So the story keeps the same type at the same size, which is already large on a
 * 1080 canvas, and spends its extra 570 pixels on those two margins and on air
 * between the blocks. Stretching a post to 9:16 would put the price list under
 * the reply bar, which is the one part somebody actually wants to read.
 */
const FORMATS = {
  /* `fs` scales every type size at once. A story is looked at full screen and
     scrolled past in two seconds, so it earns bigger type; the same numbers at
     the same size on a taller canvas just read as timid. */
  post: { h: 1350, padTop: 74, padBottom: 70, gap: 0, photo: 430, fs: 1, maxFs: 1.3 },
  /**
   * The story fills the screen, and that is the studio's call rather than the
   * cautious one.
   *
   * Instagram's own furniture covers roughly the top 250px of a story (progress
   * bar, profile photo, username, close button) and the bottom 250px (reply bar,
   * send, stickers), which is the received wisdom for keeping everything clear of
   * it. Obeying that left a card floating in the middle of the frame with a
   * hand's width of cream above and below: correct, and it read as a photo of a
   * poster rather than as the screen.
   *
   * So these margins are typographic instead: the wordmark sits at the top of the
   * screen and the handle at the bottom, and the type grows until the card fills
   * the 1920. The wordmark and the handle do end up under Instagram's bars, and
   * that is an acceptable trade because neither is what the reader came for. The
   * prices, which are, occupy the middle where nothing covers them.
   *
   * If a version fully inside the safe zone is ever wanted, put these back to
   * 250 and 340 (340 rather than 250 because a paid Story ad adds a
   * call-to-action button) and the fitter below will size the type to suit.
   */
  story: { h: 1920, padTop: 96, padBottom: 96, gap: 30, photo: 720, fs: 1.14, maxFs: 1.9 },
} as const;

type Fmt = keyof typeof FORMATS;
type Lang = "en" | "el";

/* ------------------------------------------------------------------- assets */

function dataUrl(path: string, mime: string) {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

/** A woff2 from @fontsource, or nothing if the package is not installed. */
function face(pkg: string, file: string) {
  const p = join("node_modules", "@fontsource", pkg, "files", file);
  return existsSync(p) ? dataUrl(p, "font/woff2") : null;
}

function fontCss() {
  const rules: string[] = [];
  const add = (
    family: string,
    pkg: string,
    weight: number,
    subsets: string[],
  ) => {
    for (const subset of subsets) {
      const url = face(pkg, `${pkg}-${subset}-${weight}-normal.woff2`);
      if (!url) continue;
      /* No unicode-range: the browser is given one family per subset file and
         picks whichever has the glyph. Simpler than reproducing Google's ranges,
         and there are only two scripts in play. */
      rules.push(
        `@font-face{font-family:'${family}';font-style:normal;` +
          `font-weight:${weight};src:url(${url}) format('woff2')}`,
      );
    }
  };
  for (const w of [400, 500, 600]) {
    add("Garamond", "eb-garamond", w, ["latin", "greek"]);
  }
  for (const w of [300, 400, 600]) {
    add("Grotesk", "open-sans", w, ["latin", "greek"]);
  }
  if (rules.length === 0) {
    console.warn(
      "  ! no @fontsource files found, falling back to system fonts.\n" +
        "    npm i -D @fontsource/eb-garamond @fontsource/open-sans",
    );
  }
  return rules.join("");
}

/* --------------------------------------------------------------------- data */

const money = (cents: number) => `€${Math.round(cents / 100)}`;

/** Per class, to two decimals, which is the number people actually compare. */
type Pack = (typeof PACKS)[number];
const perClass = (p: Pack) =>
  `€${(p.priceCents / p.credits / 100).toFixed(2).replace(/\.00$/, "")}`;

const bySlug = (prefix: string) =>
  PACKS.filter((p) => p.slug.startsWith(prefix)).sort(
    (a, b) => a.credits - b.credits,
  );

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_EL = ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"];
const SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_EL = ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"];

type Slot = { day: number; minutes: number; en: string; el: string };

function timetable(): Slot[] {
  return (
    sqlite
      .prepare(
        `select ct.name_en as en, ct.name_el as el, t.day_of_week as day,
                t.start_minutes as minutes
           from class_templates t
           join class_types ct on ct.id = t.class_type_id
          where t.active = 1
            and ct.kind = 'GROUP'
          order by t.day_of_week, t.start_minutes`,
      )
      .all() as Slot[]
  ).map((s) => ({ ...s, el: s.el || s.en }));
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The week, said the way a person would say it.
 *
 * Monday to Friday are the same eleven classes except for one slot, so printing
 * five identical columns would waste the whole card and make the one difference
 * invisible. This finds the shared weekday pattern and reports the exceptions
 * separately, rather than assuming a pattern that a change to the rota would
 * silently break.
 */
function weekdayPattern(slots: Slot[], lang: Lang) {
  const weekdays = [1, 2, 3, 4, 5];
  const times = [
    ...new Set(slots.filter((s) => weekdays.includes(s.day)).map((s) => s.minutes)),
  ].sort((a, b) => a - b);

  const rows: { time: string; name: string; note: string | null }[] = [];
  for (const minutes of times) {
    /* Only the days that actually have a class at this time get a vote. A day
       with nothing here used to contribute a dash, which would have printed a
       stray em dash onto a public poster the first time the rota lost a slot. */
    const counts = new Map<string, number[]>();
    for (const d of weekdays) {
      const slot = slots.find((s) => s.day === d && s.minutes === minutes);
      if (!slot) continue;
      const name = slot[lang];
      const list = counts.get(name) ?? [];
      list.push(d);
      counts.set(name, list);
    }
    if (counts.size === 0) continue;
    const ranked = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
    const [main, mainDays] = ranked[0];
    const short = lang === "el" ? SHORT_EL : SHORT_EN;
    const note =
      ranked.length > 1
        ? ranked
            .slice(1)
            .map(([n, ds]) => `${ds.map((d) => short[d]).join(" & ")} ${n}`)
            .join(" · ")
        : null;
    void mainDays;
    rows.push({ time: hhmm(minutes), name: main, note });
  }
  return rows;
}

function saturday(slots: Slot[], lang: Lang) {
  return slots
    .filter((s) => s.day === 6)
    .map((s) => ({ time: hhmm(s.minutes), name: s[lang] }));
}

const dayName = (d: number, lang: Lang) =>
  (lang === "el" ? DAYS_EL : DAYS_EN)[d];

/* ---------------------------------------------------------------- the words */

const T = {
  en: {
    eyebrow: "Reformer Pilates · Larnaca",
    monthly: "Monthly",
    monthlySub: "Sessions valid for 30 days",
    quarter: "Three months",
    quarterSub: "Sessions valid for 90 days",
    week: "a week",
    sessions: "sessions",
    session: "session",
    perClass: "per class",
    popular: "Most popular",
    bestValue: "Best value",
    single: "Just trying it?",
    singleLine: (p: string) => `A single class is ${p}.`,
    timetable: "The week",
    timetableSub: "Every class 60 minutes · small groups · book online",
    monFri: "Monday to Friday",
    sat: "Saturday",
    sun: "Sunday: closed",
    infoTitle: "Five reformers.\nOne hour.\nRoom to be seen.",
    infoLead:
      "Reformer Pilates on new reformers, in a small, calm room. Your instructor sets your springs, watches how you move, and changes it as you go.",
    factsHead: "What to expect",
    facts: [
      ["Five places", "Never a class you disappear into"],
      ["60 minutes", "Every class, six days a week"],
      ["All levels", "One class, built around the five people in it"],
      ["Bring", "A towel, water, and gripped socks"],
    ],
    classesHead: "What we run",
    /* Named here rather than read off the price list, because these two are a
       shape of session and not a class type: they have no row in the timetable
       to take a name from. */
    offerChips: ["Reformer Flow", "Personal 1 to 1", "Duet, for two"],
    bookLine: "Book online, any class, up to a minute before it starts.",
  },
  el: {
    eyebrow: "Reformer Pilates · Λάρνακα",
    monthly: "Μηνιαία",
    monthlySub: "Οι συνεδρίες ισχύουν 30 ημέρες",
    quarter: "Τρεις μήνες",
    quarterSub: "Οι συνεδρίες ισχύουν 90 ημέρες",
    week: "την εβδομάδα",
    sessions: "συνεδρίες",
    session: "συνεδρία",
    perClass: "το μάθημα",
    popular: "Πιο δημοφιλές",
    bestValue: "Καλύτερη τιμή",
    single: "Θέλεις να το δοκιμάσεις;",
    singleLine: (p: string) => `Ένα μεμονωμένο μάθημα είναι ${p}.`,
    timetable: "Η εβδομάδα",
    timetableSub: "Κάθε μάθημα 60 λεπτά · πέντε reformer · κρατήσεις online",
    monFri: "Δευτέρα έως Παρασκευή",
    sat: "Σάββατο",
    sun: "Κυριακή: κλειστά",
    infoTitle: "Πέντε reformer.\nΜία ώρα.\nΧώρος για σένα.",
    infoLead:
      "Reformer Pilates σε καινούργιους reformers, σε μια μικρή, ήρεμη αίθουσα. Ο εκπαιδευτής ρυθμίζει τα ελατήριά σου, βλέπει πώς κινείσαι και το αλλάζει στην πορεία.",
    factsHead: "Τι να περιμένεις",
    facts: [
      ["Πέντε θέσεις", "Ποτέ μάθημα μέσα στο οποίο χάνεσαι"],
      ["60 λεπτά", "Κάθε μάθημα, έξι ημέρες την εβδομάδα"],
      ["Όλα τα επίπεδα", "Ένα μάθημα, φτιαγμένο γύρω από τα πέντε άτομα μέσα"],
      ["Φέρε", "Πετσέτα, νερό και αντιολισθητικές κάλτσες"],
    ],
    classesHead: "Τι κάνουμε",
    offerChips: ["Reformer Flow", "Ατομική 1 προς 1", "Duet, για δύο"],
    bookLine: "Κρατήσεις online, για κάθε μάθημα, μέχρι ένα λεπτό πριν αρχίσει.",
  },
} as const;

/* ----------------------------------------------------------------- the look */

const wordmarkBrown = dataUrl("public/brand/wordmark-brown.png", "image/png");
const wordmarkCream = dataUrl("public/brand/wordmark-cream.png", "image/png");
/* The reformer itself rather than a class in progress.
   The class photograph crops, at this band height, to a tight shot of two
   people's thighs, which is not what a studio wants at the top of its brand
   card. The product shot is the machine, on the studio's own near-white ground,
   and it fades into the card's cream without a seam. */
const photoStudio = dataUrl("public/media/reformer.jpg", "image/jpeg");

function shell(
  body: string,
  opts: { dark?: boolean; lang?: Lang; fmt?: Fmt } = {},
) {
  const { h: H, fs } = FORMATS[opts.fmt ?? "post"];
  /* `lang` is not decoration. Chromium uppercases Greek correctly only when it
     knows the text is Greek: with it, `text-transform: uppercase` drops the tonos
     as Greek typography requires, and without it a card reads "ΛΆΡΝΑΚΑ", which is
     wrong in the way a Greek reader notices before they read anything else. */
  return `<!doctype html><html lang="${opts.lang ?? "en"}"><head><meta charset="utf-8"><style>
${fontCss()}
:root{--fs:${fs}}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;
  font-family:'Grotesk','DejaVu Sans',sans-serif;
  background:${opts.dark ? "#2C2826" : "#F6F3F0"};
  color:${opts.dark ? "#EDE8E4" : "#2C2826"};
  -webkit-font-smoothing:antialiased}
.card{width:${W}px;height:${H}px;position:relative;display:flex;flex-direction:column}
.pad{padding:0 92px}
.wordmark{width:calc(212px * var(--fs));display:block;margin:0 auto}
.eyebrow{font-size:calc(17px * var(--fs));letter-spacing:.30em;text-transform:uppercase;
  color:${opts.dark ? "#C6BDB6" : "#8F857D"};font-weight:600;text-align:center}
.rule{width:calc(64px * var(--fs));height:calc(2px * var(--fs));
  background:#C9A227;margin:0 auto}
h1{font-family:'Garamond','DejaVu Serif',serif;font-weight:400;
  font-size:calc(96px * var(--fs));line-height:1.02;letter-spacing:-.01em;
  color:${opts.dark ? "#F6F3F0" : "#2C2826"}}
h2{font-family:'Garamond','DejaVu Serif',serif;font-weight:400;font-size:calc(44px * var(--fs));
  line-height:1.1;color:${opts.dark ? "#F6F3F0" : "#2C2826"}}
.sub{font-size:calc(23px * var(--fs));line-height:1.5;font-weight:300;
  color:${opts.dark ? "#C6BDB6" : "#7E736A"}}
.lead{font-size:calc(26px * var(--fs));line-height:1.55;font-weight:300;color:#3A3532}
.foot{display:flex;justify-content:space-between;align-items:flex-end;
  font-size:calc(19px * var(--fs));letter-spacing:.14em;text-transform:uppercase;font-weight:600;
  color:${opts.dark ? "#C6BDB6" : "#8F857D"}}
.foot .right{text-align:right;font-weight:300;letter-spacing:.05em;
  text-transform:none;font-size:calc(18px * var(--fs));line-height:1.45}
/* ------------------------------------------------------------ a price row */
.rows{display:flex;flex-direction:column;gap:0}
.row{display:flex;align-items:center;gap:22px;
  padding:calc(34px * var(--fs)) 30px;
  border-bottom:1px solid #DFD8D2}
.row:first-child{border-top:1px solid #DFD8D2}
.row .n{font-family:'Garamond',serif;font-size:calc(40px * var(--fs));width:calc(74px * var(--fs));flex:none;
  color:#2C2826;line-height:1}
.row .what{flex:1;min-width:0}
.row .what b{display:block;font-size:calc(26px * var(--fs));font-weight:400;color:#2C2826;
  letter-spacing:.005em}
.row .what span{display:block;font-size:calc(18px * var(--fs));font-weight:300;color:#8F857D;
  margin-top:3px}
.row .price{font-family:'Garamond',serif;font-size:calc(52px * var(--fs));line-height:1;
  color:#2C2826;text-align:right;flex:none;min-width:calc(118px * var(--fs))}
.row .per{font-size:calc(17px * var(--fs));font-weight:300;color:#8F857D;text-align:right;
  flex:none;width:calc(112px * var(--fs));line-height:1.3}
.row.mark{background:#EDE8E4;border-radius:16px;border-bottom-color:transparent;
  padding-left:30px}
.tag{position:absolute;right:30px;top:-14px;background:#C9A227;color:#2C2826;
  font-size:calc(14px * var(--fs));letter-spacing:.16em;text-transform:uppercase;font-weight:600;
  padding:6px 14px;border-radius:20px}
.rowwrap{position:relative}
/* -------------------------------------------------------------- timetable */
.tt{display:flex;gap:56px}
.tt .col{flex:1}
.tt h3{font-size:calc(19px * var(--fs));letter-spacing:.22em;text-transform:uppercase;
  font-weight:600;color:#8F857D;margin-bottom:18px}
.slot{display:flex;gap:18px;align-items:baseline;padding:calc(12px * var(--fs)) 0;
  border-bottom:1px solid #F0ECE9}
.slot .t{font-family:'Garamond',serif;font-size:calc(30px * var(--fs));color:#2C2826;
  width:calc(88px * var(--fs));flex:none;line-height:1}
.slot .c{font-size:calc(21px * var(--fs));font-weight:300;color:#3A3532;line-height:1.25}
.slot .c i{display:block;font-style:normal;font-size:calc(16px * var(--fs));color:#8F857D;
  margin-top:2px}
/* ------------------------------------------------------------------ facts */
.facts{display:flex;flex-direction:column;gap:0}
.fact{display:flex;gap:26px;padding:calc(22px * var(--fs)) 0;border-bottom:1px solid #DFD8D2}
.fact b{font-size:22px;font-weight:600;color:#2C2826;width:220px;flex:none;
  letter-spacing:.01em}
.fact span{font-size:21px;font-weight:300;color:#3A3532;line-height:1.35;flex:1}
.chips{display:flex;flex-wrap:wrap;gap:12px}
.chip{border:1px solid #DFD8D3;border-radius:26px;padding:11px 22px;
  font-size:calc(19px * var(--fs));font-weight:300;color:#3A3532}
</style></head><body>${body}</body></html>`;
}

/* ---------------------------------------------------------------- the cards */

function header(lang: Lang, fmt: Fmt, dark = false) {
  return `<div class="pad" style="padding-top:${FORMATS[fmt].padTop}px">
    <img class="wordmark" src="${dark ? wordmarkCream : wordmarkBrown}">
    <p class="eyebrow" style="margin-top:26px">${T[lang].eyebrow}</p>
  </div>`;
}

/**
 * The street, in the reader's own language.
 *
 * `STUDIO.addressLines` is English only, which is right for a schema.org address
 * and wrong on a Greek poster: a Larnaca reader should not have to read their own
 * street transliterated. Kept here rather than pushed into `lib/studio.ts`
 * because the website's address block has the same gap and fixing it there is a
 * change to the site, not to the artwork.
 */
const ADDRESS = {
  en: [STUDIO.addressLines[1], STUDIO.addressLines[2]],
  el: ["Γρηγόρη Αυξεντίου 9", "Λιβάδια, Λάρνακα 7060"],
};

function footer(lang: Lang, fmt: Fmt) {
  const [street, town] = ADDRESS[lang];
  /* `margin-top` as well as the flex spacer above it. When the content grows
     enough to eat the spacer, `auto` becomes nothing and the gold rule lands on
     top of the last line of text; this is the floor under that. */
  return `<div class="pad" style="margin-top:56px;
    padding-bottom:${FORMATS[fmt].padBottom}px">
    <div class="rule" style="margin-bottom:34px"></div>
    <div class="foot">
      <span>${STUDIO.instagramHandle}</span>
      <span class="right">${street}<br>${town}</span>
    </div>
  </div>`;
}

function priceCard(lang: Lang, fmt: Fmt, group: "month" | "quarter") {
  const f = FORMATS[fmt];
  const t = T[lang];
  const packs = bySlug(group === "month" ? "month-" : "quarter-");
  const single = PACKS.find((p) => p.slug === "single")!;

  const rows = packs
    .map((p) => {
      const perWeek = p.credits / (group === "month" ? 4 : 12);
      const badge =
        p.badge === "POPULAR"
          ? t.popular
          : p.badge === "BEST_VALUE"
            ? t.bestValue
            : null;
      return `<div class="rowwrap">
        ${badge ? `<span class="tag">${badge}</span>` : ""}
        <div class="row${badge ? " mark" : ""}">
          <span class="n">${perWeek}×</span>
          <span class="what">
            <b>${perWeek} ${perWeek === 1 ? (lang === "el" ? "μάθημα" : "class") : lang === "el" ? "μαθήματα" : "classes"} ${t.week}</b>
            <span>${p.credits} ${p.credits === 1 ? t.session : t.sessions}</span>
          </span>
          <span class="price">${money(p.priceCents)}</span>
          <span class="per">${perClass(p)}<br>${t.perClass}</span>
        </div>
      </div>`;
    })
    .join("");

  return shell(`<div class="card">
    ${header(lang, fmt)}
    <div class="pad" style="margin-top:${60 + f.gap * 2}px">
      <h1>${group === "month" ? t.monthly : t.quarter}</h1>
      <p class="sub" style="margin-top:14px">${group === "month" ? t.monthlySub : t.quarterSub}</p>
    </div>
    <div class="pad rows" style="margin-top:${52 + f.gap}px">${rows}</div>
    <div class="pad" style="margin-top:${52 + f.gap}px">
      <p class="sub" style="font-size:calc(22px * var(--fs))">
        <b style="font-weight:600;color:#3A3532">${t.single}</b>
        ${t.singleLine(money(single.priceCents))}
      </p>
      <p class="sub" style="margin-top:14px;font-size:calc(22px * var(--fs))">${t.bookLine}</p>
    </div>
    <div style="margin-top:auto"></div>
    ${footer(lang, fmt)}
  </div>`, { lang, fmt });
}

function timetableCard(lang: Lang, fmt: Fmt) {
  const f = FORMATS[fmt];
  const t = T[lang];
  const slots = timetable();
  const week = weekdayPattern(slots, lang);
  const sat = saturday(slots, lang);

  const slotHtml = (s: { time: string; name: string; note?: string | null }) =>
    `<div class="slot"><span class="t">${s.time}</span>
      <span class="c">${s.name}${s.note ? `<i>${s.note}</i>` : ""}</span></div>`;

  return shell(`<div class="card">
    ${header(lang, fmt)}
    <div class="pad" style="margin-top:${40 + f.gap * 2}px">
      <h1 style="font-size:calc(84px * var(--fs))">${t.timetable}</h1>
      <p class="sub" style="margin-top:12px">${t.timetableSub}</p>
    </div>
    <div class="pad tt" style="margin-top:${40 + f.gap}px">
      <div class="col">
        <h3>${t.monFri}</h3>
        ${week.map(slotHtml).join("")}
      </div>
      <div class="col">
        <h3>${t.sat}</h3>
        ${sat.map(slotHtml).join("")}
        <p class="sub" style="margin-top:26px;font-size:calc(20px * var(--fs))">${t.sun}</p>
      </div>
    </div>
    <div class="pad" style="margin-top:auto;padding-bottom:14px">
      <p class="sub" style="font-size:calc(21px * var(--fs))">${t.bookLine}</p>
    </div>
    ${footer(lang, fmt)}
  </div>`, { lang, fmt });
}

function infoCard(lang: Lang, fmt: Fmt) {
  const f = FORMATS[fmt];
  const t = T[lang];
  /* The one card with a photograph, so the one card whose height has to be
     watched: the frame is a fixed 1350 with overflow hidden, and anything that
     runs past it is simply gone, footer included. Everything below is sized to
     leave the handle and the address on the page. */
  return shell(`<div class="card">
    <div style="height:${f.photo}px;overflow:hidden;position:relative;flex:none;
      background:#FBFAF9">
      <img src="${photoStudio}" style="width:112%;position:absolute;
        top:${fmt === "story" ? -232 : -372}px;left:-6%">
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,
        rgba(246,243,240,.42) 0%,rgba(246,243,240,0) 26%,
        rgba(246,243,240,0) 58%,#F6F3F0 100%)"></div>
      <!-- below Instagram's own furniture on a story, not under it -->
      <img class="wordmark" src="${wordmarkBrown}"
        style="position:absolute;left:0;right:0;
        top:${fmt === "story" ? f.padTop + 14 : 54}px;
        width:calc(206px * var(--fs))">
    </div>
    <div class="pad" style="margin-top:-6px">
      <h2 style="font-size:calc(52px * var(--fs));white-space:pre-line">${t.infoTitle}</h2>
      <p class="lead" style="margin-top:18px;font-size:calc(24px * var(--fs))">${t.infoLead}</p>
    </div>
    <div class="pad" style="margin-top:26px">
      <h3 style="font-size:calc(18px * var(--fs));letter-spacing:.22em;text-transform:uppercase;
        font-weight:600;color:#8F857D;margin-bottom:4px">${t.factsHead}</h3>
      <div class="facts">
        ${t.facts.map(([k, v]) => `<div class="fact" style="padding:calc(16px * var(--fs)) 0"><b style="font-size:calc(21px * var(--fs));width:calc(206px * var(--fs))">${k}</b><span style="font-size:calc(20px * var(--fs))">${v}</span></div>`).join("")}
      </div>
    </div>
    <div class="pad" style="margin-top:24px">
      <h3 style="font-size:calc(18px * var(--fs));letter-spacing:.22em;text-transform:uppercase;
        font-weight:600;color:#8F857D;margin-bottom:14px">${t.classesHead}</h3>
      <div class="chips">
        ${t.offerChips.map((c) => `<span class="chip" style="font-size:calc(18px * var(--fs));padding:9px 19px">${c}</span>`).join("")}
      </div>
    </div>
    <div style="margin-top:auto"></div>
    ${footer(lang, fmt)}
  </div>`, { lang, fmt });
}

/* ---------------------------------------------------------------------- run */

/**
 * The set, and the one that is not in it by default.
 *
 * The price cards carry the **list price and nothing else**: no offer, no
 * discount, no struck-through number, even when the desk has a pricing rule
 * running. That is deliberate rather than an oversight. A post lives on a feed
 * for years, and an offer price on it outlives the offer by exactly that long,
 * which leaves the studio arguing with somebody holding a screenshot. Offers
 * belong on the website, where they can be switched off.
 */
const CARDS: { name: string; html: (l: Lang, f: Fmt) => string }[] = [
  { name: "pricing-monthly", html: (l, f) => priceCard(l, f, "month") },
  { name: "pricing-3-months", html: (l, f) => priceCard(l, f, "quarter") },
  { name: "timetable", html: timetableCard },
  { name: "studio", html: infoCard },
];

/**
 * Which shapes to render.
 *
 * Both by default, because a studio posts the same thing twice: once to the feed,
 * where it stays, and once to a story, where it does not. `--post` or `--story`
 * narrows it when only one has changed.
 */
const FMTS: Fmt[] = process.argv.includes("--story")
  ? ["story"]
  : process.argv.includes("--post")
    ? ["post"]
    : ["post", "story"];

/** `--only=timetable` for one card, `--lang=en` for one language. */
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;

const ONLY = arg("only");
const LANGS: Lang[] = arg("lang") === "el" ? ["el"] : arg("lang") === "en" ? ["en"] : ["en", "el"];
const WANTED = ONLY ? CARDS.filter((c) => c.name === ONLY) : CARDS;
if (ONLY && WANTED.length === 0) {
  console.error(
    `\n  no card called "${ONLY}". There is: ${CARDS.map((c) => c.name).join(", ")}\n`,
  );
  process.exit(1);
}

async function main() {
  let chromium;
  try {
    /* The specifier goes through a variable deliberately.
       `playwright-core` is not a dependency of the website — it is installed by
       hand when somebody wants to rebuild these cards — and a literal specifier
       makes `next build` type-check a module that is not installed. That failed
       a production deploy on a hosting provider for the sake of a script the
       website never runs. A variable keeps the runtime behaviour identical (the
       try/catch below still reports the missing module in plain words) while
       leaving the type checker nothing to resolve. */
    const spec = "playwright-core";
    ({ chromium } = await import(spec).then((m) => m.default ?? m));
  } catch {
    console.error(
      "\n  This needs Playwright:  npm i -D playwright-core\n",
    );
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: FORMATS.post.h },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  for (const card of WANTED) {
    for (const fmt of FMTS) {
      const { h } = FORMATS[fmt];
      await page.setViewportSize({ width: W, height: h });
      for (const lang of LANGS) {
        /* The suffix is on the story only, so the feed files keep the names the
           studio already has in a folder somewhere. */
        const stem = `${card.name}-${lang}${fmt === "story" ? "-story" : ""}`;
        const file = join(OUT, `${stem}.png`);
        const tmp = join(OUT, `.${stem}.html`);
        writeFileSync(tmp, card.html(lang, fmt), "utf8");
        await page.goto(`file://${process.cwd()}/${tmp}`, {
          waitUntil: "networkidle",
        });
        await page.evaluate(() => document.fonts.ready);

        /**
         * Size the type so the card fills its frame exactly.
         *
         * Every size on the card is a multiple of `--fs`, so one number controls
         * the whole composition. This walks that number until the content is as
         * tall as the frame will take and no taller.
         *
         * It grows as well as shrinks, which it did not before. Shrinking alone
         * kept the card from being cropped and left it sitting in the middle of a
         * story like a photograph of a poster, with a hand's width of empty cream
         * top and bottom. Growing is what makes the wordmark sit at the top of
         * the screen and the handle at the bottom.
         *
         * A hundredth at a time, and it stops at the format's ceiling: past a
         * point the price rows would start wrapping, and a wrapped row is worse
         * than a slightly smaller one.
         *
         * Passed as a string rather than a function, deliberately. tsx compiles
         * this file with esbuild, which rewrites named inner functions and injects
         * its own `__name` helper; that helper does not exist inside the page, so
         * a closure carrying one dies with "__name is not defined".
         */
        const fitted = (await page.evaluate(
          `((startFs, maxFs) => {
            var el = document.querySelector('.card');
            if (!el) return { fs: startFs, over: 0, fill: 0 };
            var root = document.documentElement;
            var fs = startFs;
            root.style.setProperty('--fs', String(fs));
            var over = function () {
              return Math.max(0, el.scrollHeight - el.clientHeight);
            };
            var round = function (v) { return Math.round(v * 1000) / 1000; };

            /* Too big for the frame: come down until it fits. */
            var guard = 0;
            while (over() > 0 && fs > 0.5 && guard++ < 200) {
              fs = round(fs - 0.01);
              root.style.setProperty('--fs', String(fs));
            }
            /* Then up, one step at a time, stopping the step before it spills. */
            guard = 0;
            while (fs < maxFs && guard++ < 300) {
              var next = round(fs + 0.01);
              root.style.setProperty('--fs', String(next));
              if (over() > 0) {
                root.style.setProperty('--fs', String(fs));
                break;
              }
              fs = next;
            }
            return {
              fs: fs,
              over: over(),
              fill: Math.round((el.scrollHeight / el.clientHeight) * 100),
            };
          })(${FORMATS[fmt].fs}, ${FORMATS[fmt].maxFs})`,
        )) as { fs: number; over: number; fill: number };

        if (fitted.over > 0) {
          console.warn(
            `  ! ${stem} overflows by ${fitted.over}px at --fs ${fitted.fs}`,
          );
        } else {
          console.log(
            `    ${stem}: --fs ${fitted.fs}, fills ${fitted.fill}% of the frame`,
          );
        }

        await page.screenshot({ path: file });
        rmSync(tmp, { force: true });
        console.log(`  ${file}`);
      }
    }
  }

  await browser.close();
  const shapes = FMTS.map((f) => `${W}x${FORMATS[f].h}`).join(" and ");
  console.log(
    `\n  ${WANTED.length * FMTS.length * LANGS.length} images, ${shapes}, in ${OUT}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
