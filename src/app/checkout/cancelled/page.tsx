import type { Metadata } from "next";
import { CheckoutResult } from "@/components/marketing/CheckoutResult";

export const metadata: Metadata = { title: "Payment cancelled" };

export default function CheckoutCancelledPage() {
  return <CheckoutResult kind="cancelled" credits={0} />;
}
