import { gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { aiCalls } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import { nowIso } from "@/lib/time";
import { estimateCostUsd } from "./pricing";
import type { Usage } from "./types";

/** Persist a single AI call with its estimated cost. */
export function recordAiCall(
  db: Db,
  params: { leadId?: string; purpose: "classify" | "extract" | "compose" | "decide"; usage: Usage },
  clock: () => Date = () => new Date(),
): number {
  const cost = estimateCostUsd(params.usage.model, params.usage.promptTokens, params.usage.completionTokens);
  db.insert(aiCalls)
    .values({
      id: newId("ai"),
      leadId: params.leadId ?? null,
      purpose: params.purpose,
      model: params.usage.model,
      promptTokens: params.usage.promptTokens,
      completionTokens: params.usage.completionTokens,
      totalTokens: params.usage.totalTokens,
      costUsd: cost,
      createdAt: nowIso(clock),
    })
    .run();
  return cost;
}

/** First day of the current month, as an ISO string, in UTC. */
export function monthStartIso(clock: () => Date = () => new Date()): string {
  const d = clock();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Sum of estimated AI cost for the current calendar month. */
export function monthlySpendUsd(db: Db, clock: () => Date = () => new Date()): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)` })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, monthStartIso(clock)))
    .get();
  return row?.total ?? 0;
}

/**
 * Budget guard. Consulted BEFORE each AI call: if the month's spend has reached
 * the ceiling, the call is refused (the worker then pauses the whole system).
 */
export function assertWithinBudget(
  db: Db,
  budgetUsd: number,
  clock: () => Date = () => new Date(),
): Result<{ spent: number; budget: number }, DomainError> {
  const spent = monthlySpendUsd(db, clock);
  if (spent >= budgetUsd) {
    return err(
      new DomainError("budget_exceeded", `Orçamento mensal da OpenAI atingido (US$ ${spent.toFixed(2)}/${budgetUsd})`, {
        spent,
        budget: budgetUsd,
      }),
    );
  }
  return ok({ spent, budget: budgetUsd });
}

export interface CostSummary {
  monthUsd: number;
  totalUsd: number;
  calls: number;
}

export function costSummary(db: Db, clock: () => Date = () => new Date()): CostSummary {
  const totals = db
    .select({
      total: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(aiCalls)
    .get();
  return {
    monthUsd: monthlySpendUsd(db, clock),
    totalUsd: totals?.total ?? 0,
    calls: totals?.calls ?? 0,
  };
}
