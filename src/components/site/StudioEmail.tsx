import { STUDIO } from "@/lib/studio";
import { cn } from "@/lib/utils";

/**
 * The studio's address, as a link, breaking where an address should break.
 *
 * ---
 *
 * **What was actually measured.** At 320 CSS pixels — an iPhone SE, and the
 * narrowest phone worth caring about — both places that print the address give
 * it a 272-pixel column:
 *
 *   hello@rgpilatesstudio.com                  160px / 170px   the old placeholder
 *   info@rgpilatesstudio.com          229px / 244px   what the studio uses
 *   info@rgpilatesfitnesscentrecy.com   279px / 298px   a wrong address, once
 *
 * (Contact page at 15px, footer at 14px.) So today's address fits on one line
 * everywhere, with 43 and 28 pixels to spare, and this component changes
 * nothing about how the site looks.
 *
 * **Which is the point, and why it is still here.** The middle line of that
 * table was briefly the third one — the studio's mailbox was given to us wrong
 * before it was given to us right — and at 320px the contact page's copy ran
 * straight off the edge of the box. Not clipped by an `overflow: hidden`, which
 * would at least look deliberate; it simply stuck out, because an email address
 * is one word with no spaces in it and the default is to let a word too long
 * for its line hang past the edge.
 *
 * Twenty-eight pixels of headroom is not much to hold that off. It is one
 * larger default font size in a member's browser settings, one different font
 * fallback on an Android that has never heard of ours, one address change. So
 * the wrap stays as insurance, and it costs nothing while it is not needed:
 * `<wbr>` is not a character, so on every screen where the address fits, this
 * renders exactly as a plain link would.
 *
 * **The break belongs after the `@`.** `break-words` on its own lets the
 * browser split wherever it runs out of room, which gives `info@rgpilatesst` /
 * `entrecy.com` — an address broken mid-domain reads as a typo, and a member
 * squinting at it cannot tell whether the studio's domain really is
 * "rgpilatesst". A `<wbr>` after the `@` offers the one seam a reader already
 * expects, so a wrap becomes `info@` / `rgpilatesstudio.com`.
 *
 * `break-words` stays as the floor beneath that: if the studio ever moves to an
 * address whose domain alone is too long for a phone, an ugly break still beats
 * text running off the screen.
 *
 * Copying and clicking are unaffected — the `href` and the selected text are
 * both the plain address.
 */
export function StudioEmail({ className }: { className?: string }) {
  const at = STUDIO.email.indexOf("@");
  const local = at < 0 ? STUDIO.email : STUDIO.email.slice(0, at + 1);
  const domain = at < 0 ? "" : STUDIO.email.slice(at + 1);

  return (
    <a
      href={`mailto:${STUDIO.email}`}
      className={cn("block break-words", className)}
    >
      {local}
      <wbr />
      {domain}
    </a>
  );
}
