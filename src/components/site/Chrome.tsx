"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Which shell the page gets.
 *
 * Everywhere on the website that is for members and visitors, that is the
 * public bar and the footer. The reception desk gets neither: somebody standing
 * at the counter with a queue in front of them has no use for HOME, STUDIO,
 * CLASSES, TIMETABLE, PRICING, CONTACT or a BOOK A CLASS button, and every one
 * of those is a way to lose the screen they were working on. The desk brings its
 * own bar, carrying the only navigation it needs — its five tabs.
 *
 * The header and footer arrive as props rather than being imported, so they stay
 * server-rendered with the signed-in member's name and balance already in them;
 * this component only decides whether to show them.
 */
export function Chrome({
  header,
  footer,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const desk = pathname?.startsWith("/admin") ?? false;
  /**
   * The share card gets no shell either, for a related reason.
   *
   * `/link` is what sits behind one shared address — an Instagram bio, a QR
   * code on the counter — and its whole job is five buttons. Putting the site's
   * navigation above them adds five more things to press instead of the one
   * thing the link was sent for, and it is the only page here that is designed
   * to be seen out of context.
   */
  const bare = desk || (pathname?.startsWith("/link") ?? false);

  if (bare) return <main>{children}</main>;

  return (
    <>
      {header}
      {/* Clears the fixed bar. */}
      <main className="pt-24">{children}</main>
      {footer}
    </>
  );
}
