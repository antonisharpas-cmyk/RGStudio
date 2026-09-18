import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/auth/VerifyForm";
import { currentUser, isVerified } from "@/lib/auth";
import { intakePath, intakeRequired } from "@/lib/intake";
import { challengeState } from "@/lib/verify";

export const metadata: Metadata = { title: "Confirm your email" };
export const dynamic = "force-dynamic";

/**
 * The last screen of signing up.
 *
 * Nobody arrives here on purpose: they arrive because they have just registered,
 * or because they tried to book with an account that was never confirmed. Both
 * of those people want one thing, so the page holds one box.
 *
 * Two redirects, both of which are somebody arriving in the wrong state rather
 * than an error: not signed in at all goes to the sign-in form, and an account
 * that is already confirmed goes on to wherever it was heading. That second one
 * matters more than it looks — a member who bookmarks this page, or presses back
 * onto it a week later, should not be shown a box asking for a code that no
 * longer exists.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string }>;
}) {
  const { next, sent } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?next=/verify");

  /* Sensible destinations only. `next` comes off a URL, and a URL is whatever
     somebody typed: an absolute address here would turn this page into an open
     redirect, so anything that is not a path on this site is ignored. */
  const to = next && /^\/[^/\\]/.test(next) ? next : "/timetable";

  if (isVerified(user)) redirect(intakeRequired(user) ? intakePath(to) : to);

  /**
   * And where the code screen sends them once it succeeds.
   *
   * The three questions come next for a new account, so the destination handed
   * to the form is the welcome step carrying the real destination inside it.
   * Doing it here rather than in the form keeps the decision on the server,
   * where the account is: a client cannot decide it has answered.
   */
  const afterCode = intakeRequired(user) ? intakePath(to) : to;

  return (
    <Suspense>
      <VerifyForm
        email={user.email}
        next={afterCode}
        sendFailed={sent === "0"}
        state={(() => {
          const s = challengeState(user.id);
          return s
            ? {
                expired: s.expired,
                locked: s.locked,
                attemptsLeft: s.attemptsLeft,
                resendInSeconds: s.resendInSeconds,
              }
            : null;
        })()}
      />
    </Suspense>
  );
}
