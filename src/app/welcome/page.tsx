import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IntakeForm } from "@/components/auth/IntakeForm";
import { currentUser, isVerified } from "@/lib/auth";
import { intakeRequired } from "@/lib/intake";
import {
  type PilatesExperience,
  type PilatesLevel,
  isPilatesExperience,
  isPilatesLevel,
} from "@/lib/intake";

export const metadata: Metadata = { title: "Before your first class" };
export const dynamic = "force-dynamic";

/**
 * The step between the emailed code and the timetable.
 *
 * Four ways to arrive and only one of them is on purpose, so most of this page
 * is redirects:
 *
 *   not signed in            the sign-in form, carrying this page as the
 *                            destination so they come back here
 *   email not confirmed      the code screen, because these questions come
 *                            after that and not before
 *   already answered         straight on to wherever they were heading. This is
 *                            the one that matters: a member who bookmarks this
 *                            page or presses back onto it a month later must
 *                            not be shown a form they have already filled in
 *   an older account         also straight on. The studio asked for this of new
 *                            sign-ups, so an account from before the question
 *                            existed is not stopped here. See lib/intake.ts
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?next=/welcome");

  /* Sensible destinations only: `next` comes off a URL, and an absolute address
     here would make this page an open redirect. */
  const to = next && /^\/[^/\\]/.test(next) ? next : "/timetable";

  if (!isVerified(user)) redirect(`/verify?next=${encodeURIComponent(to)}`);
  if (!intakeRequired(user)) redirect(to);

  const level: PilatesLevel | null = isPilatesLevel(user.pilatesLevel)
    ? user.pilatesLevel
    : null;
  const experience: PilatesExperience | null = isPilatesExperience(
    user.pilatesSince,
  )
    ? user.pilatesSince
    : null;

  return (
    <IntakeForm
      next={to}
      initial={{
        level,
        experience,
        condition: user.healthCondition ?? null,
        answered: user.intakeAt !== null,
      }}
    />
  );
}
