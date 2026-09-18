import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { notVerified } from "@/lib/api-guard";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validation";

/**
 * Change your own password.
 *
 * The current password is required even though the caller is already signed
 * in: a session left open on a shared machine should not be enough to lock the
 * real owner out of their account.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const stop = notVerified(user);
  if (stop) return stop;

  const parsed = changePasswordSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "INVALID" },
      { status: 400 },
    );
  }

  const ok = await verifyPassword(
    parsed.data.currentPassword,
    user.passwordHash,
  );
  if (!ok) {
    return NextResponse.json(
      { error: "CURRENT_PASSWORD_WRONG" },
      { status: 400 },
    );
  }

  db.update(users)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword) })
    .where(eq(users.id, user.id))
    .run();

  return NextResponse.json({ ok: true });
}
