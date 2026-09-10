import "server-only";
import { getDb, type Db } from "./client";
import { runMigrations } from "./migrate";

let migrated = false;

/**
 * Database handle for the Next.js app (server components + server actions).
 * Ensures the schema exists on first use so a fresh checkout renders without a
 * separate migrate step. `server-only` keeps this off the client bundle.
 */
export function getAppDb(): Db {
  const db = getDb();
  if (!migrated) {
    runMigrations(db);
    migrated = true;
  }
  return db;
}
