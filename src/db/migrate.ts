import { resolve } from "node:path";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { createClient, type Db } from "./client";

const MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle");

/** Apply all pending migrations to an already-open database. */
export function runMigrations(db: Db, folder: string = MIGRATIONS_FOLDER): void {
  drizzleMigrate(db, { migrationsFolder: folder });
}

/** CLI entrypoint: `tsx src/db/migrate.ts`. */
function main(): void {
  const url = process.env.DATABASE_URL ?? "data/instaleads.db";
  const { db, sqlite } = createClient(url);
  try {
    runMigrations(db);
    console.log(`Migrações aplicadas em ${url}`);
  } finally {
    sqlite.close();
  }
}

// Run only when invoked directly.
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  main();
}
