import type { Metadata } from "next";
import { ResetForm } from "@/components/auth/ResetForm";
import { RESET_TTL_MINUTES, lookupReset } from "@/lib/password-reset";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

/**
 * The page behind the emailed link.
 *
 * The token is checked on the server before the form is drawn, so a dead link
 * says so at once instead of after two passwords have been typed. The check is
 * read only; the link is only spent when the new password is saved.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const found = lookupReset(token);
  return (
    <ResetForm
      token={token}
      initialState={found.ok ? "ready" : found.code}
      minutes={RESET_TTL_MINUTES}
    />
  );
}
