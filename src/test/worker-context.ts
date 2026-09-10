import type { Db } from "@/db/client";
import { FakeBrowserClient } from "@/integrations/browser/fake";
import { FakeInstagramApiClient } from "@/integrations/instagram/api";
import { FakeConversationEngine } from "@/integrations/openai/fake";
import type { WorkerContext } from "@/worker/context";
import { makeBusinessConfig, makeEnv, fakeClock, seededRng } from "./fixtures";

export interface TestContext {
  ctx: WorkerContext;
  browser: FakeBrowserClient;
  instagram: FakeInstagramApiClient;
}

/** Build a WorkerContext wired entirely to deterministic fakes. */
export function makeWorkerContext(
  db: Db,
  opts: { browser?: FakeBrowserClient; clock?: () => Date; budgetUsd?: number } = {},
): TestContext {
  const browser = opts.browser ?? new FakeBrowserClient({ mode: "success" });
  const instagram = new FakeInstagramApiClient();
  const env = makeEnv(opts.budgetUsd !== undefined ? { OPENAI_MONTHLY_BUDGET_USD: opts.budgetUsd } : {});
  const ctx: WorkerContext = {
    db,
    env,
    config: makeBusinessConfig(),
    engine: new FakeConversationEngine({ fastModel: env.OPENAI_MODEL_FAST, writeModel: env.OPENAI_MODEL }),
    browser,
    instagram,
    clock: opts.clock ?? fakeClock(),
    rng: seededRng(7),
    workerId: "test-worker",
  };
  return { ctx, browser, instagram };
}
