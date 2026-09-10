import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { loadBusinessConfig } from "@/lib/config";
import { loadEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createBrowserClient } from "@/integrations/browser";
import { createInstagramApiClient } from "@/integrations/instagram";
import { createConversationEngine } from "@/integrations/openai";
import type { WorkerContext } from "./context";
import { recoverStuckJobs } from "./queue";
import { runLoop } from "./runner";

/** Worker entrypoint: `tsx src/worker/main.ts`. */
async function main(): Promise<void> {
  const env = loadEnv();
  const config = loadBusinessConfig();
  const db = getDb();

  // Ensure schema is present, then recover any job left mid-flight by a crash.
  runMigrations(db);
  const recovered = recoverStuckJobs(db);
  if (recovered > 0) logger.info({ recovered }, "restart recovery: requeued in-flight jobs");

  const ctx: WorkerContext = {
    db,
    env,
    config,
    engine: createConversationEngine(env),
    browser: createBrowserClient(env),
    instagram: createInstagramApiClient(env),
    clock: () => new Date(),
    rng: Math.random,
    workerId: `worker-${randomUUID().slice(0, 8)}`,
  };

  logger.info({ workerId: ctx.workerId }, "instaleads worker iniciado");
  const loop = runLoop(ctx, { idleMs: 1000 });

  const shutdown = () => {
    logger.info("desligando worker...");
    loop.stop();
    void ctx.browser.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, "worker fatal");
  process.exit(1);
});
