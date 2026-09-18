import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  /* Checked against the database, not just the cookie. A signed token whose
     account has since been deleted or erased — every account after a go-live
     reset, and anyone still holding a phone that was logged in before it —
     still decodes, so a cookie-only check sent them to /account, which reads the
     database, found nobody, and sent them back here: an endless bounce the
     browser reports as "too many redirects". currentUser() returns null for a
     gone account, so a stale cookie simply lands on the sign-in form. */
  if (await currentUser()) redirect("/account");
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
