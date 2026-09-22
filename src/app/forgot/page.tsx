import type { Metadata } from "next";
import { ForgotForm } from "@/components/auth/ForgotForm";

export const metadata: Metadata = { title: "Forgot your password" };
export const dynamic = "force-dynamic";

export default function ForgotPage() {
  return <ForgotForm />;
}
