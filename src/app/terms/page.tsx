import type { Metadata } from "next";
import { LegalBody } from "@/components/marketing/LegalBody";

export const metadata: Metadata = { title: "Terms & studio policy" };

export default function TermsPage() {
  return <LegalBody kind="terms" />;
}
