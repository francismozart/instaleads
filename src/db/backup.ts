import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

/**
 * Online backup of the SQLite database using the native backup API (safe while
 * the app/worker are running). Writes a timestamped copy under ./backups.
 *
 * Restore procedure (documented + tested):
 *   1. Stop the app and worker.
 *   2. Copy the chosen backups/instaleads-<ts>.db over DATABASE_URL's path.
 *   3. Delete any stale -wal/-shm sidecars next to the target.
 *   4. Start again; migrations are idempotent.
 */
export async function backupDatabase(
  sourceUrl = process.env.DATABASE_URL ?? "data/instaleads.db",
  backupDir = "backups",
): Promise<string> {
  if (!existsSync(sourceUrl)) throw new Error(`Banco não encontrado em ${sourceUrl}`);
  const dir = resolve(backupDir);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = resolve(dir, `instaleads-${stamp}.db`);

  const db = new Database(sourceUrl, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  return dest;
}

if (process.argv[1] && process.argv[1].endsWith("backup.ts")) {
  backupDatabase()
    .then((dest) => {
      console.log(`Backup criado: ${dest}`);
    })
    .catch((e) => {
      console.error("Falha no backup:", e);
      process.exit(1);
    });
}
