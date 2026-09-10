import { createClient, type Db } from "./client";
import { runMigrations } from "./migrate";

export interface TestDb {
  db: Db;
  close: () => void;
}

/**
 * Create an isolated, migrated in-memory database for a single test. Every test
 * gets a fresh schema so cases never leak state into each other.
 */
export function createTestDb(): TestDb {
  const { db, sqlite } = createClient(":memory:");
  runMigrations(db);
  return { db, close: () => sqlite.close() };
}
