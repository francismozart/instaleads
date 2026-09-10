import type { Intent } from "@/features/conversations/policy";
import type { BusinessConfig } from "@/lib/config";

/** Token usage returned by every model call, for cost accounting. */
export interface Usage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LeadContext {
  handle: string;
  fullName?: string | null;
  funnel: "customer" | "affiliate";
  actorType: string;
  niche?: string | null;
  /** Public profile signals gathered at discovery. */
  profile: Record<string, unknown>;
}

export interface ClassifyInput {
  lead: LeadContext;
  history: { direction: "outbound" | "inbound"; body: string }[];
  latestInbound: string;
}

export interface ClassifyResult {
  intent: Intent;
  confidence: number;
  usage: Usage;
}

export interface ComposeInput {
  lead: LeadContext;
  history: { direction: "outbound" | "inbound"; body: string }[];
  /** What the message should accomplish (from the deterministic policy). */
  objective: string;
  config: BusinessConfig;
}

export interface ComposeResult {
  text: string;
  usage: Usage;
}

/**
 * The conversation engine boundary. Both the OpenAI-backed implementation and
 * the deterministic fake satisfy this, so the worker and tests are decoupled
 * from the provider. `classify`/`extract` use the fast model; `compose` uses
 * the writing model.
 */
export interface ConversationEngine {
  classify(input: ClassifyInput): Promise<ClassifyResult>;
  compose(input: ComposeInput): Promise<ComposeResult>;
}
