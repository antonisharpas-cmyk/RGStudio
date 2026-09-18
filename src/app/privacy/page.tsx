import type { Metadata } from "next";
import { LegalBody } from "@/components/marketing/LegalBody";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return <LegalBody kind="privacy" />;
}
