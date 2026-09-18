import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureSchema } from "./migrate";
import * as schema from "./schema";

/**
 * Single shared connection. Next.js hot-reloads modules in dev, so the handle
 * is cached on globalThis to avoid opening a new SQLite handle on every reload.
 */
const configured = (process.env.DATABASE_URL ?? "file:./dev.db").replace(
  /^file:/,
  "",
);

/**
 * Where the file actually goes, which is not always where it was configured.
 *
 * This module opens the database as it is imported, and `next build` imports
 * every route module while it collects page data. On a hosting provider that is
 * a problem the moment the database lives on a mounted disk: the disk is a
 * runtime thing, so during the build `/var/data` does not exist and the build
 * dies on "Cannot open database because the directory does not exist" — pointing
 * at a route that is perfectly fine.
 *
 * So: make the directory if it is missing, which is right on a first run
 * anywhere. If it cannot be made, the answer depends entirely on when we are:
 *
 *   during `next build` — nothing is being stored. Point at a throwaway file in
 *     the temp directory so the build can finish. Nothing reads it, nothing
 *     writes anything meaningful to it, and it dies with the build container.
 *
 *   while serving — this is the studio's data and there is no acceptable
 *     substitute. Throwing is correct: a site that quietly serves from a
 *     temporary file looks like it works and loses every booking on the next
 *     deploy. `scripts/boot.mjs` refuses earlier and more clearly, and this is
 *     the backstop for anything that gets past it.
 */
const building = process.env.NEXT_PHASE === "phase-production-build";

function usable(target: string) {
  const dir = dirname(target);
  if (!dir || dir === "." || existsSync(dir)) return true;
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

let file = configured;
if (!usable(file)) {
  if (!building) {
    throw new Error(
      `[db] cannot open ${file}: the directory does not exist and could not be created. ` +
        "If this is a hosted service, the persistent disk is not mounted at that path.",
    );
  }
  file = join(tmpdir(), "rg-build.db");
  console.log(
    `[db] ${configured} is not reachable during the build, using ${file} instead. Nothing is stored in it.`,
  );
}

const globalForDb = globalThis as unknown as {
  __rgSqlite?: Database.Database;
};

const sqlite =
  globalForDb.__rgSqlite ??
  (() => {
    const conn = new Database(file);
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    return conn;
  })();

if (process.env.NODE_ENV !== "production") globalForDb.__rgSqlite = sqlite;

/**
 * Bring the file up to the schema this build expects.
 *
 * Deliberately outside the connection-creation branch above. It used to live
 * inside it, which meant it only ran when a *new* handle was opened — and in
 * development the handle is cached on globalThis across hot reloads. So pulling
 * new code into an already-running dev server re-evaluated this module, reused
 * the old connection, and never migrated: every query touching the changed
 * table then failed, which looked like "I cannot log in or create an account".
 *
 * Running it on every module evaluation is the correct place. It is idempotent
 * and costs a handful of pragma reads, which is nothing next to the failure it
 * prevents. See migrate.ts.
 */
try {
  const applied = ensureSchema(sqlite);
  if (applied.length) {
    console.log(`[db] schema brought up to date: ${applied.join(", ")}`);
  }
} catch (e) {
  /* Never stop the app from opening the database over this: a thrown error
     here is far more confusing than the missing column it was fixing. */
  console.error("[db] could not apply schema updates", e);
}

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };
export type Db = typeof db;
