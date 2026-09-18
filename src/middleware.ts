import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * The whole site, closed until the code is typed.
 *
 * The API guards alone were not enough. They stopped an unverified account
 * *doing* anything — booking, paying, editing — and left it free to wander the
 * site, which meant somebody who had not finished signing up could browse the
 * timetable, press Book, and only then be told about a step nobody had mentioned
 * since the moment they registered. The studio's instruction was plainer than
 * that: until the code comes back, there is nothing else to do.
 *
 * So this runs before every request. A signed-in member whose cookie says the
 * address is unconfirmed is sent to /verify, whatever they asked for.
 *
 * ---
 *
 * **Why the cookie and not the database.**
 *
 * Middleware runs on the edge runtime, where `better-sqlite3` does not exist. It
 * could not read the row if it wanted to. So the stamp travels in the signed
 * session token, which the cookie already is, and `createSession` re-issues it
 * the instant the code is accepted.
 *
 * That makes this a *routing* decision and nothing more. The database is still
 * the authority: every route that acts on a member's behalf re-reads the row and
 * refuses it there. The worst a stale cookie can do is let somebody look at a
 * page they should have been redirected away from — never act on one.
 *
 * ---
 *
 * **What stays open, and why each one has to.**
 *
 * The code box itself, obviously. The two routes behind it, or the box cannot
 * work. Signing out — which is the only way out for the commonest real mistake,
 * a typo in your own address, and a person locked in a room with no door is a
 * worse bug than the one this fixes. And the sign-in and registration routes, so
 * a cookie in this state is not a trap that survives clearing it.
 */

const OPEN_PATHS = new Set([
  "/verify",
  "/api/auth/verify",
  "/api/auth/verify/resend",
  "/api/auth/logout",
  "/api/auth/login",
  "/api/auth/register",
  /* The service worker. Registered from the account page, but a browser may ask
     for it at any moment, and answering a script request with a redirect to an
     HTML page is how you get an unregistered worker and a console full of
     mime-type errors. */
  "/sw.js",
  /**
   * Apple's proof that this domain belongs to the studio.
   *
   * Normally nothing serves this and nothing needs to: registering the domain
   * on Stripe's Payment method domains page makes Stripe do the whole Apple
   * merchant validation, certificate and all, and no file is hosted here. Their
   * documentation is blunt about it — do not follow Apple's own validation
   * process.
   *
   * Left open anyway, for one reason. If the studio ever moves to a host or a
   * setup where Stripe cannot verify on its own, the fix is to drop Stripe's
   * association file into public/.well-known/ — and that file deliberately has
   * no extension, so the static-file rule below would not match it and Apple's
   * fetch, which carries no cookie, could be answered with a redirect instead
   * of the file. That failure is invisible until the button silently stops
   * appearing. One line here costs nothing and removes the trap in advance.
   */
  "/.well-known/apple-developer-merchantid-domain-association",
]);

/** Static files by extension, in case the matcher below ever widens. */
const STATIC = /\.(?:ico|png|jpe?g|svg|webp|avif|gif|css|js|map|woff2?|ttf|txt|xml|webmanifest)$/i;

async function unverifiedMember(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) return false;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    /* Staff are exempt: their accounts are made at a keyboard by somebody
       already standing there, and there is no inbox in that story. */
    const role = String(payload.role ?? "MEMBER");
    if (role === "STAFF" || role === "ADMIN") return false;
    /* Absent on a cookie issued before this claim existed, and absent means
       verified — otherwise everybody signed in when this shipped is locked out
       of a site they have been using for weeks. */
    if (payload.v === undefined) return false;
    return payload.v !== true;
  } catch {
    /* An unreadable or expired token is not a signed-in member. Whatever they
       asked for will deal with them itself. */
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (OPEN_PATHS.has(pathname) || STATIC.test(pathname)) {
    return NextResponse.next();
  }
  if (!(await unverifiedMember(req))) return NextResponse.next();

  /**
   * An API call gets an answer, not a redirect.
   *
   * `fetch` follows a 307 by default, so redirecting one of these would hand the
   * caller a page of HTML where it expected JSON — and the failure would surface
   * as a parse error somewhere unrelated. The same code every route uses, so the
   * screens already know how to say it.
   */
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "EMAIL_UNVERIFIED" }, { status: 403 });
  }

  /* Carrying where they were going, so typing the code puts them back there
     rather than on the timetable. */
  const to = req.nextUrl.clone();
  to.pathname = "/verify";
  to.search = "";
  const asked = pathname + (req.nextUrl.search || "");
  if (asked !== "/") to.searchParams.set("next", asked);
  return NextResponse.redirect(to);
}

/**
 * Everything except Next's own plumbing.
 *
 * `_next/static` and `_next/image` are excluded because they are served from a
 * build and cannot belong to a member, and running a JWT verification on every
 * chunk of JavaScript on the page would be a needless cost on every page load.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
