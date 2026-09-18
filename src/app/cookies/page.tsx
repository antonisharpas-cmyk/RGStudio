import type { Metadata } from "next";
import { LegalBody } from "@/components/marketing/LegalBody";

export const metadata: Metadata = { title: "Cookies" };

/**
 * The third legal page, and the one the notice at the bottom of the screen
 * points at.
 *
 * Its own page rather than a section of the privacy notice, because the notice
 * has to link somewhere short. Somebody deciding whether to accept a cookie
 * should not have to read eleven sections about health data first.
 */
export default function CookiesPage() {
  return <LegalBody kind="cookies" />;
}
