import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { notVerified } from "@/lib/api-guard";
import { currentUser } from "@/lib/auth";
import { intakeSchema } from "@/lib/validation";

/**
 * The three questions, answered.
 *
 * Its own route rather than part of the profile PATCH, because it is a different
 * act at a different moment: the profile editor sends a whole profile and
 * expects a member who has one, while this is the last step of signing up and
 * has nothing but three answers. Folding it in would have meant a profile
 * schema where every field is optional, and that schema cannot tell a member
 * clearing their name from a client that forgot to send it.
 *
 * `notVerified` still guards it. The step comes *after* the emailed code on
 * purpose: answering questions about your body is not something to ask of an
 * address nobody has proved they own.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const stop = notVerified(user);
  if (stop) return stop;

  const parsed = intakeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "INVALID" },
      { status: 400 },
    );
  }
  const { level, experience, condition } = parsed.data;

  /* Empty means they were asked and had nothing to say. Stored as null, which
     with `intakeAt` set reads as exactly that: see lib/intake.ts. */
  const declared = condition && condition.trim().length ? condition.trim() : null;

  db.update(users)
    .set({
      pilatesLevel: level,
      pilatesSince: experience,
      healthCondition: declared,
      /**
       * The date the step was completed, and it is only ever set here and in the
       * desk's own edit. Never cleared: a member who later says they have
       * nothing wrong has still answered, and clearing it would put them back
       * through the gate on their next visit.
       */
      intakeAt: user.intakeAt ?? new Date(),
    })
    .where(eq(users.id, user.id))
    .run();

  return NextResponse.json({ ok: true });
}
