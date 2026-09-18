import type { Metadata } from "next";
import { StudioBody } from "@/components/marketing/StudioBody";
import { getInstructors } from "@/lib/catalogue";

export const metadata: Metadata = {
  title: "Studio",
  description:
    "Inside RG Pilates Studio: new reformers, small classes, sixty minute sessions, personal and duet sessions at midday, and the people who teach them. Part of RG Pilates Studio.",
};

/* The instructors come out of the database, so this page reads on request like
   the rest of the authenticated site rather than being baked at build time. */
export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const team = await getInstructors();
  return <StudioBody team={team} />;
}
