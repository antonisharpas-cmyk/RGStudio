import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userAvatars } from "@/db/schema";

/** Whether a member has a profile photograph, without reading the bytes. */
export async function hasAvatar(userId: string) {
  const row = db
    .select({ userId: userAvatars.userId })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .get();
  return Boolean(row);
}
