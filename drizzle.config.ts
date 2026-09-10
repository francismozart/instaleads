import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * The database file location is read from DATABASE_URL (a plain filesystem
 * path for SQLite, e.g. `data/instaleads.db`). Migrations are versioned SQL
 * files under ./drizzle and applied by src/db/migrate.ts.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "data/instaleads.db",
  },
  strict: true,
  verbose: true,
});
