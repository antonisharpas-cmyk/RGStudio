/**
 * Single place for the studio's real world details.
 * Replace the placeholders marked TODO with the studio's actual data.
 */
export const STUDIO = {
  name: "RG Pilates Studio",
  /** RG stands on its own: there is no parent gym. Kept as a field so the
   *  places that used to print a parent line still compile, and print nothing. */
  parent: "",
  addressLines: ["RG Pilates Studio", "Patron 30", "Larnaca 6051", "Cyprus"],
  city: "Larnaca",
  /**
   * The studio's published number, as shown on its online booking page.
   *
   * Written with the country code and spaced for reading. Every place that
   * dials it strips the spaces itself, `tel:` will not accept them, so this
   * stays the one human readable copy: the footer, the contact page, the share
   * card at /link and the printed QR sheet all read from here.
   */
  phone: "+357 99 379 832",
  /**
   * TODO: confirm the studio's mailbox with RG before going live.
   *
   * This is the address a member sees: the footer, the contact page and the
   * share card at /link all read it from here. It is also the mailbox the site
   * sends *from*, see `EMAIL_FROM` in .env.example, and the two being the same
   * address is the point. A member who replies to a confirmation should reach
   * the studio.
   */
  email: "info@rgpilatesstudio.com",
  instagram: "https://www.instagram.com/rgpilates_studio/",
  instagramHandle: "@rgpilates_studio",
  facebook: "https://www.facebook.com/p/RG-pilates-studio-61580648810956/",
  /** Paste the studio's Google Maps embed URL to switch the contact map on */
  mapsEmbedUrl: "",
  /* The plain query form of the studio's Maps pin. The link copied out of the
     Maps app carries a long tail of session and telemetry parameters that go
     stale; this resolves to the same place and keeps working. */
  mapsLink:
    "https://www.google.com/maps/search/?api=1&query=RG+pilates+studio%2C+Patron+30%2C+Larnaca+6051",
  /** All class times are shown in the studio's timezone, whoever is looking.
   *  "Asia/Nicosia" is the IANA zone for the whole of Cyprus, Larnaca included. */
  timezone: "Asia/Nicosia",
  /** RG runs sixty minute sessions, back to back on the hour, as its published
   *  schedule says. Every generated class, every template and every line of
   *  copy takes its length from here. */
  classLengthMinutes: 60,
  /** Reformers in the room, so the cap on every class.
   *  TODO: confirm the exact number of reformers with RG. */
  capacity: 5,
  /** Monday to Saturday; the studio is closed on Sunday */
  openDays: 6,
} as const;
