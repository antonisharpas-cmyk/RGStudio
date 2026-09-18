import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  /* Database-backed, not cookie-only: a token whose account was deleted or
     erased still decodes, and a cookie-only check bounced it to /account and
     back here forever ("too many redirects"). See the note in login/page.tsx.
     currentUser() is null for a gone account, so a stale cookie just shows the
     form. */
  if (await currentUser()) redirect("/account");
  return (
    <Suspense>
      <AuthForm mode="register" />
    </Suspense>
  );
}
