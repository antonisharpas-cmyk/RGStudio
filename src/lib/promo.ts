/**
 * The spend window on a batch of sessions.
 *
 * A batch may carry `usableFrom` and `usableTo`: the class it pays for has to
 * start inside that range. Ordinary packs set `usableTo` to their own expiry, so
 * a pack cannot book classes after it has run out. This file once also held the
 * opening week free session offer; that offer has been removed, and only the
 * window rule, which every pack still uses, remains.
 */

/** Whether a batch with this window may be spent on a class at this time. */
export function windowAllows(
  batch: { usableFrom: Date | null; usableTo: Date | null },
  classStartsAt: Date,
) {
  if (batch.usableFrom && classStartsAt < batch.usableFrom) return false;
  if (batch.usableTo && classStartsAt > batch.usableTo) return false;
  return true;
}
