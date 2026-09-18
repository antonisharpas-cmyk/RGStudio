import type { Metadata } from "next";
import { ContactBody } from "@/components/marketing/ContactBody";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with RG Pilates Studio about levels, injuries, credit packs or private sessions.",
};

export default function ContactPage() {
  return <ContactBody />;
}
