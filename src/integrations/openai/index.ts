import type { Env } from "@/lib/env";
import { FakeConversationEngine } from "./fake";
import { OpenAiConversationEngine } from "./openai-engine";
import type { ConversationEngine } from "./types";

/**
 * Build the conversation engine from the environment. The fake engine is used
 * whenever USE_FAKE_ENGINE=1 (tests, offline simulation, dry-run) so the whole
 * system runs without spend or network.
 */
export function createConversationEngine(env: Env): ConversationEngine {
  if (process.env.USE_FAKE_ENGINE === "1") {
    return new FakeConversationEngine({ fastModel: env.OPENAI_MODEL_FAST, writeModel: env.OPENAI_MODEL });
  }
  return new OpenAiConversationEngine({
    apiKey: env.OPENAI_API_KEY,
    writeModel: env.OPENAI_MODEL,
    fastModel: env.OPENAI_MODEL_FAST,
  });
}

export { FakeConversationEngine } from "./fake";
export { OpenAiConversationEngine } from "./openai-engine";
export * from "./types";
export * from "./accounting";
export * from "./runner";
