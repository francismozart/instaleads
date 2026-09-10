import type { Db } from "@/db/client";
import { DomainError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import { assertWithinBudget, recordAiCall } from "./accounting";
import type { ClassifyInput, ClassifyResult, ComposeInput, ComposeResult, ConversationEngine } from "./types";

/**
 * Budget-guarded wrappers. Every AI call first checks the monthly ceiling, then
 * runs, then records tokens + estimated cost in `ai_calls`. When the budget is
 * hit the call is refused and the caller (the worker) pauses the whole system.
 */
export async function classifyGuarded(
  db: Db,
  engine: ConversationEngine,
  input: ClassifyInput,
  opts: { budgetUsd: number; leadId?: string; clock?: () => Date },
): Promise<Result<ClassifyResult, DomainError>> {
  const budget = assertWithinBudget(db, opts.budgetUsd, opts.clock);
  if (!budget.ok) return err(budget.error);
  const result = await engine.classify(input);
  recordAiCall(db, { leadId: opts.leadId, purpose: "classify", usage: result.usage }, opts.clock);
  return ok(result);
}

export async function composeGuarded(
  db: Db,
  engine: ConversationEngine,
  input: ComposeInput,
  opts: { budgetUsd: number; leadId?: string; clock?: () => Date },
): Promise<Result<ComposeResult, DomainError>> {
  const budget = assertWithinBudget(db, opts.budgetUsd, opts.clock);
  if (!budget.ok) return err(budget.error);
  const result = await engine.compose(input);
  recordAiCall(db, { leadId: opts.leadId, purpose: "compose", usage: result.usage }, opts.clock);
  return ok(result);
}
