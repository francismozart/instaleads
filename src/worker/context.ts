import type { Db } from "@/db/client";
import type { BusinessConfig } from "@/lib/config";
import type { Env } from "@/lib/env";
import type { Job } from "@/db/schema";
import type { ConversationEngine } from "@/integrations/openai/types";
import type { BrowserClient } from "@/integrations/browser/types";
import type { InstagramApiClient } from "@/integrations/instagram/api";

export interface WorkerContext {
  db: Db;
  env: Env;
  config: BusinessConfig;
  engine: ConversationEngine;
  browser: BrowserClient;
  instagram: InstagramApiClient;
  clock: () => Date;
  rng: () => number;
  workerId: string;
}

/** What a handler asks the runner to do next. */
export type HandlerResult =
  | { status: "done" }
  | { status: "reschedule"; seconds: number; reason?: string }
  | { status: "pause"; reason: string; rescheduleSeconds?: number };

export type JobHandler = (ctx: WorkerContext, job: Job) => Promise<HandlerResult>;
