/**
 * The session cookie's name, on its own, importable from anywhere.
 *
 * A one-line module because of where it has to be read from. `middleware.ts`
 * runs on the edge runtime, and importing this from `lib/auth.ts` would drag the
 * whole of it along — bcrypt, Drizzle, and `better-sqlite3`, which does not
 * exist there and fails the build rather than failing at runtime.
 *
 * So the name lives here and `lib/auth.ts` re-exports it, which keeps every
 * existing import working and keeps one string in one place. Two files agreeing
 * on a cookie name by coincidence is a bug that logs everybody out.
 */
export const SESSION_COOKIE = "rg_session";
