/**
 * Signing out, and landing on the home page.
 *
 * This is a full page load rather than `router.push("/")`, which is what it used
 * to be, and the difference matters. Client-side navigation and
 * `router.refresh()` race each other: the refresh re-renders the page the member
 * is standing on, and if that page is `/account` — which it usually is, because
 * that is where the sign-out button lives — the server now sees a request with
 * no session and answers with a redirect to the sign-in screen. The member asked
 * to leave and arrived at a login form.
 *
 * A document load has none of that. The cookie is already gone, the browser asks
 * for `/` and gets `/`, and every scrap of member data still held in memory goes
 * with the old page — which is the right way to end a session on a shared
 * computer, at the studio's own front desk especially.
 *
 * The navigation happens even if the request fails. A member pressing sign out
 * on a bad connection must not be left looking at their own account: the cookie
 * may well be gone already, and if it is not, the next page will ask them to
 * sign in anyway.
 */
export async function signOutAndGoHome() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* Nothing to report — leaving is the point, not the request. */
  } finally {
    window.location.assign("/");
  }
}
