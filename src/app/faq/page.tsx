import type { Metadata } from "next";
import { FaqPageBody } from "@/components/marketing/FaqPageBody";

export const metadata: Metadata = {
  title: "Questions",
  description:
    "Reformer Pilates at RG Pilates Studio, Larnaca: what to bring, how early to arrive, how sessions and cancellations work.",
};

/**
 * The questions, on a page of their own.
 *
 * They already appear at the bottom of the home page and the pricing page, which
 * is where somebody reading top to bottom meets them. This is for the other
 * arrival: a member who wants one specific answer and needs a link they can be
 * sent — "it's on the FAQ page" is only useful if there is one.
 *
 * The content is the same list, from the same place in the dictionary. Two copies
 * of a cancellation policy is how a studio ends up quoting two different ones.
 */
export default function FaqPage() {
  return <FaqPageBody />;
}
