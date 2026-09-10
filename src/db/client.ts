import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
/** The object passed to a `db.transaction(tx => ...)` callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything you can run queries on: the pooled db or an open transaction. */
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
}

/** Apply the reliability pragmas required by the spec. */
export function applyPragmas(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
}

/** Open a SQLite database at `url` (a filesystem path, or ":memory:"). */
export function createClient(url: string): DbHandle {
  if (url !== ":memory:") {
    const dir = dirname(url);
    if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(url);
  applyPragmas(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

let singleton: DbHandle | null = null;

/** Process-wide database handle, opened from DATABASE_URL. */
export function getDb(): Db {
  if (!singleton) {
    const url = process.env.DATABASE_URL ?? "data/instaleads.db";
    singleton = createClient(url);
  }
  return singleton.db;
}

export function getSqlite(): Database.Database {
  if (!singleton) getDb();
  return singleton!.sqlite;
}

export function closeDb(): void {
  if (singleton) {
    singleton.sqlite.close();
    singleton = null;
  }
}

export { schema };
