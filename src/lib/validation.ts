import { z } from "zod";
import {
  CONDITION_MAX_CHARS,
  PILATES_EXPERIENCE,
  PILATES_LEVELS,
} from "./intake";
import { isValidReminderMinutes } from "./profile";
import { TIMETABLE_WEEKS } from "./horizon";

export const PASSWORD_MIN = 8;

/* A phone number the studio can actually ring. Loose on formatting, strict on
   there being enough digits to be real. */
const phone = z
  .string({
    required_error: "PHONE_REQUIRED",
    invalid_type_error: "PHONE_REQUIRED",
  })
  .trim()
  .min(8, "PHONE_REQUIRED")
  .max(32, "PHONE_INVALID")
  /* Eight digits is a Cyprus number without its country code; fifteen is the
     most any number in the world has, because E.164 says so. Between those two
     it might be real; outside them it certainly is not. */
  .refine((v) => (v.match(/\d/g) ?? []).length >= 8, "PHONE_INVALID")
  .refine((v) => (v.match(/\d/g) ?? []).length <= 15, "PHONE_INVALID");

export const registerSchema = z.object({
  name: z
    .string({
      required_error: "NAME_REQUIRED",
      invalid_type_error: "NAME_REQUIRED",
    })
    .trim()
    .min(2, "NAME_REQUIRED")
    .max(80, "NAME_TOO_LONG"),
  email: z
    .string({
      required_error: "EMAIL_INVALID",
      invalid_type_error: "EMAIL_INVALID",
    })
    .trim()
    .toLowerCase()
    .email("EMAIL_INVALID"),
  /* Required now: the studio needs to reach a member when a class moves, and
     a booking reminder by SMS is impossible without it. */
  phone,
  password: z
    .string({
      required_error: "PASSWORD_SHORT",
      invalid_type_error: "PASSWORD_SHORT",
    })
    .min(PASSWORD_MIN, "PASSWORD_SHORT")
    .max(200, "PASSWORD_LONG"),
  /* Studio and timetable notices. Must be accepted to hold an account, so it
     is validated as literally true rather than merely present. */
  serviceOptIn: z.literal(true, {
    errorMap: () => ({ message: "SERVICE_CONSENT_REQUIRED" }),
  }),
  /**
   * The terms and the privacy notice.
   *
   * Validated as literally true rather than merely present, exactly like the
   * service consent above: a payload arriving with `termsAccepted: false` is a
   * member who has not accepted, and treating that as "the key was there" would
   * record a consent nobody gave.
   */
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "TERMS_REQUIRED" }),
  }),
  /* Offers and news. Never required. */
  marketingOptIn: z.boolean().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "CURRENT_PASSWORD_REQUIRED"),
    newPassword: z
      .string()
      .min(PASSWORD_MIN, "PASSWORD_SHORT")
      .max(200, "PASSWORD_LONG"),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "PASSWORD_UNCHANGED",
    path: ["newPassword"],
  });

/* Everything a member may change about themselves. Email and phone are absent
   on purpose: both are identity and contact of record, so they are changed by
   asking the studio, not by editing a field. */
export const profileSchema = z.object({
  name: z.string().trim().min(2, "NAME_REQUIRED").max(80, "NAME_TOO_LONG"),
  birthDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "BIRTHDATE_INVALID")
    .optional()
    .or(z.literal("")),
  /* No height or weight. Removed rather than left accepted-and-ignored: zod
     strips keys it does not know about, so a browser tab left open on the old
     form still saves the rest of the profile instead of failing on a field that
     no longer exists. */
  marketingOptIn: z.boolean(),
  /* Members who registered before this consent existed have none on record.
     They are asked for it in the profile, so it can arrive here — but it can
     only ever be granted, never revoked, because withdrawing it means closing
     the account. */
  serviceOptIn: z.boolean().optional(),
  notifyEmail: z.boolean(),
  notifySms: z.boolean(),
  notifyPush: z.boolean(),
  /** null switches reminders off */
  reminderMinutes: z
    .number()
    .int()
    .refine((n) => isValidReminderMinutes(n), "REMINDER_INVALID")
    .nullable(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const bookSchema = z.object({
  sessionId: z.string().min(1),
  /**
   * The second person on a duet, typed by the member booking it.
   *
   * Free text and capped, not looked up: the person coming with them is usually
   * not a member, and requiring them to be one would mean a friend has to sign
   * up before they can be brought along once. Only read when the class is an
   * appointment, and only kept when a duet session actually pays for it.
   */
  guestName: z.string().trim().min(2).max(80).optional(),
});

/**
 * Either identifier will do. The checkout page knows the pack by the slug in
 * its own URL, so making it look the id up first was a round trip for nothing.
 */
export const checkoutSchema = z
  .object({
    packageId: z.string().min(1).optional(),
    packSlug: z.string().min(1).optional(),
    /** A promo code typed at checkout. Optional, matched case insensitively. */
    code: z.string().trim().max(40).optional(),
    /** A monthly plan's first month: the term and the cadence. */
    plan: z.object({ months: z.number().int(), perWeek: z.number().int() }).optional(),
    /** Another month of an existing plan. */
    subscriptionId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.packageId || v.packSlug || v.plan || v.subscriptionId), {
    message: "packageId or packSlug is required",
  });

/**
 * A message short enough to be a mistyped word is not an enquiry, so the studio
 * gets a floor rather than a mailbox of "hi". The number is exported because
 * the form both states it up front and counts towards it.
 */
export const CONTACT_NAME_MIN = 2;
export const CONTACT_MESSAGE_MIN = 20;
export const CONTACT_MESSAGE_MAX = 4000;

/* Machine codes rather than prose: the form is bilingual, so the wording lives
   in the dictionaries and the server only says which rule failed. */
/* The required_error matters as much as the min(): a field that is absent
   entirely never reaches .min(), so without it a missing name comes back as
   Zod's own "Required" and the form has no code to translate. */
const required = (code: string) => ({
  required_error: code,
  invalid_type_error: code,
});

export const contactSchema = z.object({
  name: z
    .string(required("NAME_REQUIRED"))
    .trim()
    .min(CONTACT_NAME_MIN, "NAME_REQUIRED")
    .max(80, "NAME_TOO_LONG"),
  email: z
    .string(required("EMAIL_INVALID"))
    .trim()
    .toLowerCase()
    .email("EMAIL_INVALID"),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  message: z
    .string(required("MESSAGE_TOO_SHORT"))
    .trim()
    .min(CONTACT_MESSAGE_MIN, "MESSAGE_TOO_SHORT")
    .max(CONTACT_MESSAGE_MAX, "MESSAGE_TOO_LONG"),
});

export const grantSchema = z.object({
  userId: z.string().min(1),
  credits: z.number().int().min(-100).max(100),
  validityDays: z.number().int().min(0).max(1000).optional(),
  note: z.string().max(200).optional(),
});

export const attendanceSchema = z.object({
  bookingId: z.string().min(1),
  status: z.enum(["ATTENDED", "NO_SHOW", "CONFIRMED"]),
});

/**
 * How many weeks the desk may generate in one press.
 *
 * The ceiling was a hardcoded 26 and it went stale the moment the booking
 * horizon became a year: `rollTimetableForward` generates 53 weeks by itself,
 * so a human pressing Generate at the desk could reach only half of what the
 * app maintains automatically — and, because of the silent fallback this route
 * used to have, was told it had worked.
 *
 * Derived from `TIMETABLE_WEEKS` with room to overshoot on purpose. Overshooting
 * is a supported move, not an accident: generation returns the ids of everything
 * it created precisely so a run that went too far can be taken back, which is
 * what the Undo on the timetable tab does.
 */
export const MAX_GENERATE_WEEKS = TIMETABLE_WEEKS * 2;

export const generateSchema = z.object({
  weeks: z.number().int().min(1).max(MAX_GENERATE_WEEKS),
});

/**
 * The three questions asked after the emailed code, and again in the profile.
 *
 * `condition` carries two answers in one field, which needs saying out loud:
 * an empty string means "nothing to declare", and that is a real answer rather
 * than a blank. It is stored as null and read back as "they were asked and said
 * no", which is why the step records its own date: see lib/intake.ts.
 */
export const intakeSchema = z.object({
  level: z.enum(PILATES_LEVELS, {
    errorMap: () => ({ message: "LEVEL_REQUIRED" }),
  }),
  experience: z.enum(PILATES_EXPERIENCE, {
    errorMap: () => ({ message: "EXPERIENCE_REQUIRED" }),
  }),
  /**
   * Absent or empty is "nothing". Anything else is trimmed and kept as typed:
   * this is a member describing their own body and the studio does not get to
   * tidy it into categories.
   */
  condition: z
    .string()
    .trim()
    .max(CONDITION_MAX_CHARS, "CONDITION_TOO_LONG")
    .optional()
    .nullable(),
});
