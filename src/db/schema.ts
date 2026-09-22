/**
 * RG Pilates Studio — database schema (Drizzle ORM / SQLite)
 *
 * SQLite keeps local development at zero setup. To move to Postgres later,
 * swap the `drizzle-orm/sqlite-core` imports for `pg-core` and change
 * src/db/index.ts — the shape of the data does not change.
 *
 * Credit model: credits live in dated *batches*. A purchase creates one batch
 * with an expiry date; a booking spends one credit from the batch that expires
 * soonest. That makes expiry exact and refunds traceable to the batch they came
 * from. Every movement is also written to creditLedger as an audit trail.
 */
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const now = () => integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date());

/* ------------------------------------------------------------------ People */

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    /** MEMBER | STAFF | ADMIN */
    role: text("role").notNull().default("MEMBER"),
    /* ---- consents -------------------------------------------------------
       Two deliberately separate things. serviceOptIn covers the messages a
       member cannot sensibly opt out of and still use the studio: a class
       moved, an instructor swapped, the room closed. It is required to hold an
       account, so it is recorded with the date it was given rather than as a
       flag that can drift. marketingOptIn covers offers and news, is never
       required, and can be withdrawn at any time. */
    serviceOptInAt: integer("service_opt_in_at", { mode: "timestamp" }),
    marketingOptIn: integer("marketing_opt_in", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * When they accepted the terms and the privacy notice.
     *
     * A date rather than a flag, and for the same reason as the consent above:
     * "did they agree" is not the useful question a year later. "When, and
     * therefore to which version" is. Null on accounts that predate the ask.
     */
    termsAcceptedAt: integer("terms_accepted_at", { mode: "timestamp" }),

    /* ---- what the studio needs to know before teaching somebody ---------
       Asked once, after the email code, and editable by the member and by the
       desk from then on. `intakeAt` is what marks the step as done: without it
       a null level cannot be told apart from a member who has not been asked
       yet, and the two need different treatment. */
    intakeAt: integer("intake_at", { mode: "timestamp" }),
    /** BEGINNER | INTERMEDIATE | ADVANCED */
    pilatesLevel: text("pilates_level"),
    /** NONE | UNDER_6M | UNDER_1Y | ONE_TO_TWO | OVER_TWO */
    pilatesSince: text("pilates_since"),
    /**
     * Whatever they told us to be careful of, in their own words.
     *
     * Null with `intakeAt` set means they answered and had nothing to declare,
     * which is a real answer and not a missing one. Kept apart from `notes`:
     * that is what an instructor wrote about them, this is what they said about
     * themselves, and merging the two would let one overwrite the other.
     */
    healthCondition: text("health_condition"),

    /* ---- how we are allowed to reach them ---- */
    /**
     * Which language to write to them in. "en" | "el", null on accounts that
     * have never chosen.
     *
     * The site has always known this — the language switch sets a cookie, and
     * every page is rendered from it. What the *server* did not know was which
     * language to use when nobody is looking at a page, which is the only time
     * a notification is ever sent. So push and SMS went out in English to
     * members reading the site in Greek, while the in-app copy of the same
     * message sat in their account in Greek. A cookie could not have fixed it:
     * a reminder for a class in two hours is composed by a cron sweep with no
     * browser attached to it.
     *
     * Null rather than a default of "en" on purpose. It distinguishes "reads it
     * in English" from "has never touched the switch", and only the first of
     * those is a preference. Both are written to in English, so nothing behaves
     * differently today — but the day the studio wants to ask its Greek members
     * something, "who never chose" is a question this column can answer and a
     * NOT NULL default could not.
     */
    locale: text("locale"),
    notifyEmail: integer("notify_email", { mode: "boolean" })
      .notNull()
      .default(true),
    notifySms: integer("notify_sms", { mode: "boolean" })
      .notNull()
      .default(false),
    /* Not a preference: the studio keeps push on, and the member's browser or
       phone is the only thing that can silence it. Kept as a column so the
       delivery code reads consent the same way for all three channels. */
    notifyPush: integer("notify_push", { mode: "boolean" })
      .notNull()
      .default(true),

    /* Minutes before a class starts to send its reminder. Null means the
       member does not want one. See REMINDER_STEP_MINUTES in lib/profile.ts. */
    reminderMinutes: integer("reminder_minutes"),

    /**
     * A dummy account, kept for testing the site rather than a real member.
     *
     * It exists because the alternative is worse: a studio that cannot try a
     * campaign without sending it to a fake member, or worse, deletes the fake
     * member and loses the only account it can safely experiment with. Marked
     * accounts are left out of anything the desk sends unless somebody
     * deliberately includes them.
     *
     * Deliberately not a role. A test account still books classes, buys packs
     * and holds a balance — it behaves as a member in every way, and treating it
     * as staff would hide it from the very screens it exists to exercise.
     */
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),

    /**
     * When this address was proved to belong to whoever registered it.
     *
     * Null means the account exists and cannot yet be used: a code was emailed
     * and has not come back. Stored as the moment rather than a flag so the
     * studio can answer "when did they confirm" — which is the question that
     * matters if somebody later disputes that they ever signed up.
     *
     * The studio's own accounts are stamped when they are created, because the
     * person creating them is standing at the machine.
     */
    emailVerifiedAt: integer("email_verified_at", { mode: "timestamp" }),

    /**
     * When this member's personal details were erased, and by whom.
     *
     * A right-to-erasure request does not delete the row: the payments attached
     * to it are accounting records the studio has to keep for seven years and
     * then archive for a further seven, and cascading them away would rewrite
     * the studio's own takings. So the person
     * is removed from the row and everything financial stays — see
     * lib/erasure.ts for exactly which columns are overwritten.
     *
     * Kept as a pair of columns rather than a log table because this is the only
     * audited action on a member, and one row explaining itself beats a table
     * nobody remembers to read.
     */
    erasedAt: integer("erased_at", { mode: "timestamp" }),
    erasedBy: text("erased_by"),

    /* ---- optional profile ----
       Date of birth rather than an age: an age written down is wrong within a
       year, and the studio needs it for screening, not for a birthday card. */
    birthDate: text("birth_date"),
    heightCm: integer("height_cm"),
    weightGrams: integer("weight_grams"),

    /** Studio notes: injuries, goals, spring preferences */
    notes: text("notes"),
    createdAt: now().notNull(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    /**
     * One number, one member — enforced here as well as in the two code paths
     * that check it.
     *
     * Registration and the desk's contact edit both compare numbers in
     * normalised form, which catches "+357 99 123456" against "99123456" the way
     * a database never could. What they cannot catch is two registrations in the
     * same instant: both read an empty table, both insert, and neither is wrong
     * until it is too late. This is the backstop for that, and the code above it
     * is what makes the rule mean what a person means by it.
     *
     * SQLite treats NULLs as distinct, so accounts with no number on record do
     * not collide with each other.
     */
    uniqueIndex("users_phone_idx").on(t.phone),
  ],
);

/**
 * A code emailed to prove an address belongs to whoever typed it.
 *
 * One live challenge per account, replaced rather than added to: a member who
 * presses "send it again" four times should be typing the newest code, and a
 * mailbox holding four codes that all still work is four chances for the wrong
 * one to be lifted out of the wrong email.
 *
 * The code itself is never stored. Only a keyed hash of it is, for the same
 * reason a password is not stored: this is a credential, and a credential in
 * plain text in a file that gets backed up is a credential you have given away.
 * Six digits is a small space, so the real defence is the attempt counter and
 * the expiry rather than the hash — see lib/verify.ts.
 */
export const emailVerifications = sqliteTable(
  "email_verifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** HMAC of the code, keyed with AUTH_SECRET. Never the code. */
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    /** Wrong codes typed against the current code. Locks it at the limit. */
    attempts: integer("attempts").notNull().default(0),
    /** Codes sent inside the current window, for the resend limit. */
    sends: integer("sends").notNull().default(1),
    windowStartedAt: integer("window_started_at", { mode: "timestamp" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
    createdAt: now().notNull(),
  },
  (t) => [uniqueIndex("email_verifications_user_idx").on(t.userId)],
);

/**
 * A forgotten password, and the one-time link that fixes it.
 *
 * A link here rather than a code, unlike email verification. Somebody who has
 * forgotten their password is not sitting in a half-finished registration
 * with a box waiting for six digits; they are locked out, most often on their
 * phone, reading their email in the same place they will type the new
 * password. One tap, two boxes, done.
 *
 * The token itself is never stored, only a keyed hash of it, so a copy of the
 * database is not a set of working links. One live link per account: asking
 * again replaces the previous one, so the newest email is always the one that
 * works. Used once and then dead, and dead after an hour whether used or not.
 */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** HMAC of the token, keyed with AUTH_SECRET. Never the token. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: now().notNull(),
  },
  (t) => [uniqueIndex("password_resets_user_idx").on(t.userId)],
);

/**
 * Profile photographs, kept out of the users row and out of the filesystem.
 *
 * A separate table because a blob on `users` would be read on every session
 * lookup for no reason. In the database rather than on disk because this app
 * ships as one SQLite file: a backup or a move then carries the photos with
 * it, and there is no upload directory to get lost, go read-only on a
 * serverless host, or fall out of sync with the rows pointing at it.
 * Images are resized in the browser first and capped again on the server.
 */
export const userAvatars = sqliteTable("user_avatars", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const instructors = sqliteTable("instructors", {
  id: id(),
  name: text("name").notNull(),
  bioEn: text("bio_en").notNull().default(""),
  bioEl: text("bio_el").notNull().default(""),
  bioRu: text("bio_ru").notNull().default(""),
  photoUrl: text("photo_url"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * Set once the desk has edited this row. Until then the code roster in
   * lib/roster.ts may still refresh the bios; afterwards the database is the
   * truth and the roster leaves the row alone. See reconcileRoster.
   */
  editedAt: integer("edited_at", { mode: "timestamp" }),
});

/* --------------------------------------------------------------- Catalogue */

export const classTypes = sqliteTable(
  "class_types",
  {
    id: id(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameEl: text("name_el").notNull(),
    descEn: text("desc_en").notNull(),
    descEl: text("desc_el").notNull(),
    /** ALL | BEGINNER | INTERMEDIATE | ADVANCED */
    level: text("level").notNull().default("ALL"),
    /** 1 = restorative, 2 = moderate, 3 = hard */
    intensity: integer("intensity").notNull().default(2),
    focusEn: text("focus_en").notNull().default(""),
    focusEl: text("focus_el").notNull().default(""),
    /**
     * GROUP or PERSONAL, and the difference is not cosmetic.
     *
     * A GROUP class is the timetable as it has always been: five reformers, five
     * places, booked with an ordinary session, bookable up to a minute before it
     * starts. A PERSONAL class is one reformer and one appointment, held in the
     * midday gap, paid for with a personal or duet session, and closed to new
     * bookings at the end of the previous day because somebody has to be asked
     * to come in and teach it.
     *
     * So it decides three separate rules — which sessions can pay for it, when
     * booking closes, and how many people the room holds — and every one of them
     * reads this column rather than guessing from the hour or the capacity.
     */
    kind: text("kind").notNull().default("GROUP"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("class_types_slug_idx").on(t.slug)],
);

export const creditPackages = sqliteTable(
  "credit_packages",
  {
    id: id(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameEl: text("name_el").notNull(),
    credits: integer("credits").notNull(),
    priceCents: integer("price_cents").notNull(),
    validityDays: integer("validity_days").notNull().default(90),
    /** POPULAR | BEST_VALUE | null */
    badge: text("badge"),
    /**
     * What the sessions in this pack can be spent on: CLASS, PERSONAL or DUET.
     *
     * Copied onto the batch when the pack is bought, because the pack can be
     * withdrawn or repriced afterwards and a member's balance must not change
     * meaning when it is. See credit_batches.kind.
     */
    kind: text("kind").notNull().default("CLASS"),
    /**
     * The most classes a day these sessions may be spent on. Null means no cap.
     *
     * Exists for one pack: the three-month Unlimited plan hands over enough
     * sessions to train every day the studio is open, and "unlimited" has to
     * mean one a day rather than seventy-eight in a fortnight. Kept as a number
     * rather than a flag so a future pack can say two.
     */
    perDayLimit: integer("per_day_limit"),
    /** How many people one session admits. 1 for everything except a duet. */
    seats: integer("seats").notNull().default(1),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * When the owner last set this pack's list price from the desk.
     *
     * `packs.ts` is synced into this table on boot, price included. Once the
     * desk has typed a price, that sync must stop overwriting it, and this is
     * the flag that says so. Null means the code list price still applies;
     * clearing it hands the price back to `packs.ts`. See catalogue-repair.
     */
    priceEditedAt: integer("price_edited_at", { mode: "timestamp" }),
    /**
     * Set once the desk has edited or created this pack. From then on the row
     * belongs to the desk: the boot sync from `packs.ts` neither rewrites nor
     * withdraws it. Null means the code list still owns the row.
     */
    editedAt: integer("edited_at", { mode: "timestamp" }),
    /**
     * Which heading the pack sits under on the pricing page, for packs the
     * desk created (a code pack takes its group from `packs.ts`).
     * single | month | quarter | personal
     */
    group: text("pack_group"),
  },
  (t) => [uniqueIndex("credit_packages_slug_idx").on(t.slug)],
);

/* ---------------------------------------------------------------- Schedule */

/** Weekly recurring blueprint. Bookable classes are generated from these. */
export const classTemplates = sqliteTable(
  "class_templates",
  {
    id: id(),
    classTypeId: text("class_type_id")
      .notNull()
      .references(() => classTypes.id),
    instructorId: text("instructor_id").references(() => instructors.id),
    /** 0 = Sunday … 6 = Saturday */
    dayOfWeek: integer("day_of_week").notNull(),
    /** Minutes from midnight — 06:00 = 360 */
    startMinutes: integer("start_minutes").notNull(),
    durationMin: integer("duration_min").notNull().default(50),
    capacity: integer("capacity").notNull().default(8),
    /**
     * The level this recurring slot is aimed at, and the durable home for it.
     *
     * ALL | BEGINNER | INTERMEDIATE | ADVANCED, or null which reads as ALL. It
     * lives on the template rather than the class type because every group class
     * shares one type (timetable-repair moves them all onto it), so a level on
     * the type would be the level of the whole timetable at once. Sessions
     * generated from this template inherit this value; the desk can override a
     * single class on the session itself. It is a label shown to members, not a
     * booking rule — nobody is refused a class by their level.
     */
    level: text("level"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("class_templates_day_idx").on(t.dayOfWeek)],
);

/** A single bookable class at a real date and time. */
export const classSessions = sqliteTable(
  "class_sessions",
  {
    id: id(),
    classTypeId: text("class_type_id")
      .notNull()
      .references(() => classTypes.id),
    instructorId: text("instructor_id").references(() => instructors.id),
    templateId: text("template_id").references(() => classTemplates.id),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    capacity: integer("capacity").notNull().default(8),
    /**
     * This one class's level, copied from its template when generated.
     *
     * Carried on the session so the desk can change a single class without
     * touching the recurring slot, and so a class reads its own level with no
     * join. Null reads as ALL. See class_templates.level for the why.
     */
    level: text("level"),
    /** SCHEDULED | CANCELLED */
    status: text("status").notNull().default("SCHEDULED"),
    note: text("note"),
    createdAt: now().notNull(),
  },
  (t) => [
    uniqueIndex("class_sessions_template_start_idx").on(t.templateId, t.startsAt),
    index("class_sessions_starts_idx").on(t.startsAt),
  ],
);

export const bookings = sqliteTable(
  "bookings",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    /** CONFIRMED | CANCELLED | ATTENDED | NO_SHOW */
    status: text("status").notNull().default("CONFIRMED"),
    /** Batch the credit was taken from, so a refund goes back to the same one */
    creditBatchId: text("credit_batch_id"),
    creditRefunded: integer("credit_refunded", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * The second person on a duet, named by the member who booked it.
     *
     * Null on every ordinary booking. Set only when a duet session paid for the
     * appointment, and it is not decoration: the instructor arriving at noon
     * needs to know whether one person or two are walking in, and the studio has
     * no other way of learning the second name. Kept as free text because the
     * partner is usually not a member and should not have to become one for
     * somebody to bring a friend.
     */
    guestName: text("guest_name"),
    createdAt: now().notNull(),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("bookings_user_session_idx").on(t.userId, t.sessionId),
    index("bookings_session_status_idx").on(t.sessionId, t.status),
  ],
);

/* -------------------------------------------------------- Money & credits */

export const purchases = sqliteTable(
  "purchases",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageId: text("package_id").references(() => creditPackages.id),
    credits: integer("credits").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("eur"),
    /** PENDING | PAID | FAILED | REFUNDED */
    status: text("status").notNull().default("PENDING"),
    /** stripe | hosted | test | manual */
    provider: text("provider").notNull().default("stripe"),
    /** The provider's own reference for this payment, whoever the provider is. */
    providerRef: text("provider_ref"),
    stripeSession: text("stripe_session"),
    stripeIntent: text("stripe_intent"),
    /**
     * The provider's own receipt for this payment, as a link.
     *
     * Stripe builds one of these for every successful charge and hosts it: the
     * amount, the date, the last four digits, the studio's name, printable and
     * saveable as a PDF by whoever opens it. It costs nothing to keep the
     * address and it is the only document in this system that a member can
     * hand to somebody else as proof of what they paid.
     *
     * Stored rather than fetched when needed, for two reasons. The confirmation
     * email is composed once and sent immediately, so the link has to be in
     * hand at that moment rather than a round trip away. And the account's
     * payment list would otherwise make one API call per row, on a page that
     * shows twenty.
     *
     * Null on a purchase taken in cash or at the desk, which have no provider
     * and therefore no receipt to link to, and on anything paid before this
     * column existed.
     */
    receiptUrl: text("receipt_url"),
    /**
     * The studio's own invoice number for this payment, once it has one.
     *
     * Three columns rather than one because they answer three different
     * questions. `invoiceNo` is the identifier printed on the document and
     * quoted back by an accountant, and it must never change even if the format
     * does — so it is stored, not derived. `invoiceYear` and `invoiceSeq` are
     * what the *next* number is worked out from, and a tax authority cares that
     * the sequence has no gaps in it, which is a question about integers and not
     * about strings.
     *
     * Null on anything that has not been invoiced: a payment still pending, a
     * cash sale handed a paper receipt at the counter, and every purchase made
     * before the studio started issuing invoices. Also null while the invoice
     * configuration is still placeholder, because a specimen must never consume
     * a number from the real sequence.
     */
    invoiceNo: text("invoice_no"),
    invoiceYear: integer("invoice_year"),
    invoiceSeq: integer("invoice_seq"),
    /** The promo code typed at checkout, if any, and what it took off. */
    promoCode: text("promo_code"),
    promoDiscountCents: integer("promo_discount_cents"),
    /** The monthly plan this payment is a month of, if it is one. */
    subscriptionId: text("subscription_id"),
    createdAt: now().notNull(),
    paidAt: integer("paid_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("purchases_stripe_session_idx").on(t.stripeSession),
    index("purchases_user_idx").on(t.userId),
    /**
     * One invoice number, once.
     *
     * The sequence is handed out by reading the highest one already used and
     * adding one, inside the same transaction that writes it — see
     * assignInvoiceNumber. This index is the backstop that makes a duplicate
     * impossible rather than merely unlikely, which for a document a tax
     * authority may audit is the difference that matters. SQLite treats NULLs as
     * distinct, so the many purchases with no invoice do not collide.
     */
    uniqueIndex("purchases_invoice_no_idx").on(t.invoiceNo),
  ],
);

export const creditBatches = sqliteTable(
  "credit_batches",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id").references(() => purchases.id),
    creditsTotal: integer("credits_total").notNull(),
    creditsRemaining: integer("credits_remaining").notNull(),
    /** PURCHASE | GRANT | COMPENSATION */
    source: text("source").notNull().default("PURCHASE"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),

    /**
     * What these sessions buy: CLASS, PERSONAL or DUET.
     *
     * The studio sells two things that are both counted in sessions and are not
     * interchangeable in either direction. A member holding five class sessions
     * and one personal cannot spend a class session on a noon appointment, and
     * cannot spend the personal one on the 18:00 Reformer Flow. A window would
     * only express half of that, which is why this is a kind and not a date
     * range: it says what the session is *for*, not when.
     *
     * DUET is a kind rather than a quantity of two. One duet session is one
     * appointment for two people, so it spends like a personal one and the
     * second person is a name on the booking. Making it two credits would let
     * somebody split it across two solo appointments, which is not what €45
     * bought.
     *
     * CLASS is the default, so every batch granted before any of this existed
     * keeps behaving exactly as it did.
     */
    kind: text("kind").notNull().default("CLASS"),

    /**
     * The most classes a day this batch may pay for. Null means no cap.
     *
     * The three-month Unlimited plan grants a session for every day the studio
     * opens in the quarter, and the cap is what makes "unlimited" mean what a
     * member reading the word expects: one a day, all quarter, rather than the
     * whole lot inside a fortnight. It sits on the batch rather than the pack
     * because the pack can be repriced or withdrawn while somebody is still
     * training on it.
     */
    perDayLimit: integer("per_day_limit"),

    /**
     * Which class dates this batch may be spent on. Null means any.
     *
     * Not the same as `expiresAt`, and the difference is the whole reason these
     * exist. `expiresAt` is the last moment the session can be *spent*;
     * these are the first and last class it can be spent *on*. A free
     * opening-week session expiring on the 19th could otherwise be spent on the
     * 6th to book a class in November — the offer would leak into the paid
     * schedule and the promo week would constrain nothing.
     *
     * Ordinary bought sessions leave both null and behave exactly as before.
     */
    usableFrom: integer("usable_from", { mode: "timestamp" }),
    usableTo: integer("usable_to", { mode: "timestamp" }),
    /**
     * The monthly plan these sessions belong to, and whether they are frozen.
     *
     * A plan hands over every session on day one and is paid month by month.
     * When a month goes unpaid past the grace period the batch is frozen: it
     * still exists, still shows on the account, but cannot pay for a booking
     * until the month is settled. See lib/subscriptions.ts.
     */
    subscriptionId: text("subscription_id"),
    frozenAt: integer("frozen_at", { mode: "timestamp" }),
    createdAt: now().notNull(),
  },
  (t) => [index("credit_batches_user_idx").on(t.userId, t.expiresAt)],
);

/** Human-readable audit trail of every credit movement. */
export const creditLedger = sqliteTable(
  "credit_ledger",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** +10 purchase, -1 booking, +1 refund */
    delta: integer("delta").notNull(),
    /** PURCHASE | BOOKING | CANCELLATION_REFUND | ADMIN_GRANT | EXPIRY */
    reason: text("reason").notNull(),
    note: text("note"),
    batchId: text("batch_id"),
    bookingId: text("booking_id"),
    purchaseId: text("purchase_id"),
    createdAt: now().notNull(),
  },
  (t) => [index("credit_ledger_user_idx").on(t.userId, t.createdAt)],
);

/* ------------------------------------------------------------------- Misc */

export const contactMessages = sqliteTable("contact_messages", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  message: text("message").notNull(),
  handled: integer("handled", { mode: "boolean" }).notNull().default(false),
  createdAt: now().notNull(),
});

/* --------------------------------------------------------------- Relations */

/**
 * One row per reminder owed to a member for a booked class.
 *
 * The queue is written when the class is booked and removed when it is
 * cancelled, so what is owed is always derivable from a single table rather
 * than recomputed by scanning bookings. `dueAt` is stamped at scheduling time
 * from the member's chosen lead time, which means changing that preference
 * later does not silently move reminders that were already promised.
 *
 * `sentAt` closes the row. Nothing here sends anything: delivery belongs to
 * whatever provider the studio picks, and /api/reminders/due hands it the
 * list. See lib/reminders.ts.
 */
export const bookingReminders = sqliteTable(
  "booking_reminders",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    /** email | sms | push, as chosen when the reminder was scheduled */
    channels: text("channels").notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: now().notNull(),
  },
  (t) => [
    index("booking_reminders_due_idx").on(t.dueAt),
    uniqueIndex("booking_reminders_booking_idx").on(t.bookingId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  bookings: many(bookings),
  creditBatches: many(creditBatches),
  purchases: many(purchases),
  ledger: many(creditLedger),
}));

export const classSessionsRelations = relations(classSessions, ({ one, many }) => ({
  classType: one(classTypes, {
    fields: [classSessions.classTypeId],
    references: [classTypes.id],
  }),
  instructor: one(instructors, {
    fields: [classSessions.instructorId],
    references: [instructors.id],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
  session: one(classSessions, {
    fields: [bookings.sessionId],
    references: [classSessions.id],
  }),
}));

export const classTemplatesRelations = relations(classTemplates, ({ one }) => ({
  classType: one(classTypes, {
    fields: [classTemplates.classTypeId],
    references: [classTypes.id],
  }),
  instructor: one(instructors, {
    fields: [classTemplates.instructorId],
    references: [instructors.id],
  }),
}));

export const purchasesRelations = relations(purchases, ({ one }) => ({
  user: one(users, { fields: [purchases.userId], references: [users.id] }),
  package: one(creditPackages, {
    fields: [purchases.packageId],
    references: [creditPackages.id],
  }),
}));

export const creditBatchesRelations = relations(creditBatches, ({ one }) => ({
  user: one(users, { fields: [creditBatches.userId], references: [users.id] }),
  purchase: one(purchases, {
    fields: [creditBatches.purchaseId],
    references: [purchases.id],
  }),
}));

/* -------------------------------------------------- The studio's own diary */

/**
 * A day the studio is shut: a public holiday, the summer break, a burst pipe.
 *
 * Stored as the studio's own calendar day (YYYY-MM-DD in Asia/Nicosia) rather
 * than a timestamp, because "closed on the 15th" is a statement about a day in
 * Larnaca, not about an instant. Closing a day cancels and refunds everything
 * booked on it, and the timetable stops offering it.
 */
export const studioClosures = sqliteTable(
  "studio_closures",
  {
    id: id(),
    /** YYYY-MM-DD in the studio's timezone. */
    day: text("day").notNull(),
    reasonEn: text("reason_en").notNull().default(""),
    reasonEl: text("reason_el").notNull().default(""),
    createdBy: text("created_by").references(() => users.id),
    createdAt: now().notNull(),
  },
  (t) => [uniqueIndex("studio_closures_day_idx").on(t.day)],
);

/* ------------------------------------------------------------ Studio notices */

/** A message from the studio to its members, written at the desk. */
export const notices = sqliteTable(
  "notices",
  {
    id: id(),
    titleEn: text("title_en").notNull(),
    bodyEn: text("body_en").notNull(),
    /** Optional Greek version. Falls back to the English one when empty. */
    titleEl: text("title_el").notNull().default(""),
    bodyEl: text("body_el").notNull().default(""),
    /**
     * Who it was for. ALL means every member — those are the studio and
     * timetable notices nobody can opt out of, because a class being cancelled
     * is not marketing. OFFERS means only members who ticked offers, news and
     * new class types.
     */
    audience: text("audience").notNull().default("ALL"),
    /** Which channels it went out on, e.g. "push,email". In-app is always. */
    channels: text("channels").notNull().default(""),
    /**
     * Whether accounts marked as tests were deliberately included.
     *
     * Recorded on the notice rather than worked out later, because it decides
     * who may *see* it as well as who was sent it. A campaign that excluded the
     * studio's dummy accounts must exclude them from the in-app copy too —
     * otherwise "excluded" means excluded from email and SMS but not from the
     * list, the read count includes people who were never meant to be counted,
     * and the desk's own figures quietly stop meaning what they say.
     */
    includedTest: integer("included_test", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * Who it went to, in words: "offers audience · never bought · away 90d+".
     *
     * Stored rather than reconstructed, because it cannot be reconstructed. The
     * audience for "members who have not been for three months" is different
     * today than it was when the message went out — people came back. Without
     * this, the history could say a notice reached 38 people and give no way of
     * ever knowing which 38 or why.
     */
    segment: text("segment").notNull().default(""),
    /**
     * Null for a studio announcement, set for a message about one person's own
     * booking — a confirmation, a cancellation, a reminder. Same table, because
     * it is the same inbox from the member's side: one unread count on their
     * photograph, one list, one read state.
     */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Marks the ones that matter: shown with the studio's gold accent. */
    important: integer("important", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").references(() => users.id),
    createdAt: now().notNull(),
  },
  (t) => [
    index("notices_created_idx").on(t.createdAt),
    index("notices_user_idx").on(t.userId),
  ],
);

/**
 * Who has read what. A row exists only once somebody has read a notice, so
 * "unread" is the absence of a row — nothing has to be written when a notice is
 * sent, however many members there are.
 */
export const noticeReads = sqliteTable(
  "notice_reads",
  {
    noticeId: text("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: integer("read_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("notice_reads_idx").on(t.noticeId, t.userId)],
);

/**
 * One browser, one device, one permission grant.
 *
 * A member can have several — phone, laptop, the studio's tablet — and each is
 * revoked independently by whoever owns the device, not by us. Dead endpoints
 * are pruned when the push service reports them gone (404/410), which is the
 * only reliable signal we get: a browser never tells us it was uninstalled.
 */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The push service URL. Unique: re-subscribing the same browser updates. */
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: now().notNull(),
    lastSentAt: integer("last_sent_at", { mode: "timestamp" }),
    /** Consecutive send failures. Used to retire a flaky endpoint. */
    failures: integer("failures").notNull().default(0),
  },
  (t) => [
    uniqueIndex("push_endpoint_idx").on(t.endpoint),
    index("push_user_idx").on(t.userId),
  ],
);

/**
 * What actually happened when a notice was sent, per channel.
 *
 * Counts rather than a row per recipient: the desk needs to know "did it go
 * out", and 400 rows per notice to answer that is a bad trade. The first few
 * error messages are kept in `detail`, which is what makes a failure
 * diagnosable without turning on logging in production.
 */
export const noticeDeliveries = sqliteTable(
  "notice_deliveries",
  {
    id: id(),
    noticeId: text("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    /** push | email | sms */
    channel: text("channel").notNull(),
    sent: integer("sent").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    /** Recipients the channel did not apply to: no consent, no phone, no device. */
    skipped: integer("skipped").notNull().default(0),
    detail: text("detail").notNull().default(""),
    createdAt: now().notNull(),
  },
  (t) => [index("notice_deliveries_idx").on(t.noticeId)],
);

/* ------------------------------------------------------------------ Pricing */

/**
 * A discount the studio is running.
 *
 * `packageId` null means the whole list; set, it overrides the list rule for
 * that one pack. Only rows with `active` count, so an offer is switched off
 * rather than deleted and the history of what was run stays.
 */
export const pricingRules = sqliteTable(
  "pricing_rules",
  {
    id: id(),
    /** null = every pack */
    packageId: text("package_id").references(() => creditPackages.id, {
      onDelete: "cascade",
    }),
    /** PERCENT | FLAT */
    kind: text("kind").notNull(),
    /** Percent (1-90) or cents off, depending on kind. */
    value: integer("value").notNull(),
    labelEn: text("label_en").notNull().default(""),
    labelEl: text("label_el").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => users.id),
    createdAt: now().notNull(),
  },
  (t) => [index("pricing_rules_active_idx").on(t.active)],
);

/**
 * Promo codes, typed by a member at checkout.
 *
 * Distinct from `pricing_rules`, which change the price everybody sees. A code
 * is a discount only for whoever has it, and it carries its own switch, its own
 * window and its own use count so the studio can run "WELCOME10 for October,
 * first fifty people" without touching the price list.
 */
export const promoCodes = sqliteTable(
  "promo_codes",
  {
    id: id(),
    /** Stored upper case; matched case insensitively. */
    code: text("code").notNull(),
    /** PERCENT | FLAT */
    kind: text("kind").notNull(),
    /** Percent (1-90) or cents off, depending on kind. */
    value: integer("value").notNull(),
    /** null = every pack */
    packageId: text("package_id").references(() => creditPackages.id, {
      onDelete: "set null",
    }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    validFrom: integer("valid_from", { mode: "timestamp" }),
    validUntil: integer("valid_until", { mode: "timestamp" }),
    /** null = unlimited */
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    createdBy: text("created_by").references(() => users.id),
    createdAt: now().notNull(),
  },
  (t) => [uniqueIndex("promo_codes_code_idx").on(t.code)],
);

/**
 * Monthly plans: a long commitment paid one month at a time.
 *
 * A member choosing "9 months, twice a week" is handed all 72 sessions on the
 * first day and pays the monthly price (the same as the one month pack for
 * that cadence) every month. `paidThrough` is the day the next month is due;
 * `graceDays` after it the plan lapses, its sessions freeze and its upcoming
 * bookings are released. A payment, from whichever till, moves `paidThrough`
 * on a month and unfreezes everything.
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    months: integer("months").notNull(),
    perWeek: integer("per_week").notNull(),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    totalCredits: integer("total_credits").notNull(),
    /** PENDING | ACTIVE | LAPSED | CANCELLED | COMPLETED */
    status: text("status").notNull().default("PENDING"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    endsAt: integer("ends_at", { mode: "timestamp" }),
    paidThrough: integer("paid_through", { mode: "timestamp" }),
    monthsPaid: integer("months_paid").notNull().default(0),
    graceDays: integer("grace_days").notNull().default(3),
    batchId: text("batch_id"),
    /** The `paidThrough` date the last reminder was sent for, so each month is nagged once. */
    remindedFor: integer("reminded_for", { mode: "timestamp" }),
    lapsedAt: integer("lapsed_at", { mode: "timestamp" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    createdBy: text("created_by"),
    createdAt: now().notNull(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId, t.status)],
);

/* ------------------------------------------------------------------- Types */

export type User = typeof users.$inferSelect;
export type Instructor = typeof instructors.$inferSelect;
export type ClassType = typeof classTypes.$inferSelect;
export type CreditPackage = typeof creditPackages.$inferSelect;
export type ClassTemplate = typeof classTemplates.$inferSelect;
export type ClassSession = typeof classSessions.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type CreditBatch = typeof creditBatches.$inferSelect;
export type CreditLedgerRow = typeof creditLedger.$inferSelect;
export type StudioClosure = typeof studioClosures.$inferSelect;
export type Notice = typeof notices.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type PromoCode = typeof promoCodes.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NoticeDelivery = typeof noticeDeliveries.$inferSelect;
export type EmailVerification = typeof emailVerifications.$inferSelect;
