import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordLeadEvent } from "@/db/audit";
import {
  experimentAssignments,
  experimentOutcomes,
  experimentVariants,
  experiments,
  type Experiment,
  type ExperimentVariant,
} from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import { nowIso } from "@/lib/time";

export interface VariantSpec {
  key: string;
  label: string;
  config?: Record<string, unknown>;
  weight?: number;
  isControl?: boolean;
}

export interface CreateExperimentInput {
  name: string;
  variable: string;
  funnel?: "customer" | "affiliate" | "both";
  explorationRate?: number;
  variants: VariantSpec[];
}

export function createExperiment(
  db: Db,
  input: CreateExperimentInput,
  clock: () => Date = () => new Date(),
): Result<{ experiment: Experiment; variants: ExperimentVariant[] }, DomainError> {
  if (input.variants.length < 2) {
    return err(new DomainError("validation_failed", "Um experimento precisa de ao menos 2 variantes"));
  }
  if (input.variants.filter((v) => v.isControl).length !== 1) {
    return err(new DomainError("validation_failed", "Defina exatamente um grupo de controle"));
  }

  const now = nowIso(clock);
  const experiment: Experiment = {
    id: newId("exp"),
    name: input.name,
    variable: input.variable,
    funnel: input.funnel ?? "both",
    status: "running",
    explorationRate: input.explorationRate ?? 0.1,
    createdAt: now,
    updatedAt: now,
  };
  const variants: ExperimentVariant[] = input.variants.map((v) => ({
    id: newId("var"),
    experimentId: experiment.id,
    key: v.key,
    label: v.label,
    config: v.config ?? {},
    weight: v.weight ?? 1,
    isControl: v.isControl ?? false,
    createdAt: now,
  }));

  try {
    db.transaction((tx) => {
      tx.insert(experiments).values(experiment).run();
      for (const v of variants) tx.insert(experimentVariants).values(v).run();
    });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return err(new DomainError("validation_failed", `Experimento "${input.name}" já existe`));
    }
    throw e;
  }

  return ok({ experiment, variants });
}

/** Find a running experiment for a given variable, applicable to `funnel`. */
export function findRunningExperiment(
  db: Db,
  variable: string,
  funnel: "customer" | "affiliate",
): Experiment | undefined {
  return db
    .select()
    .from(experiments)
    .where(and(eq(experiments.status, "running"), eq(experiments.variable, variable)))
    .all()
    .find((e) => e.funnel === "both" || e.funnel === funnel);
}

function pickVariant(
  variants: ExperimentVariant[],
  explorationRate: number,
  rng: () => number,
): ExperimentVariant {
  const nonControl = variants.filter((v) => !v.isControl);
  // Exploration slice: always keep testing new hypotheses on a fraction.
  if (nonControl.length > 0 && rng() < explorationRate) {
    return nonControl[Math.floor(rng() * nonControl.length)]!;
  }
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  let r = rng() * totalWeight;
  for (const v of variants) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return variants[variants.length - 1]!;
}

/**
 * Assign a lead to a variant. Idempotent: a lead keeps its first assignment
 * (unique on experiment+lead), so the experiment stays comparable and reversible.
 */
export function assignVariant(
  db: Db,
  experimentId: string,
  leadId: string,
  rng: () => number = Math.random,
  clock: () => Date = () => new Date(),
): Result<ExperimentVariant, DomainError> {
  const experiment = db.select().from(experiments).where(eq(experiments.id, experimentId)).get();
  if (!experiment) return err(new DomainError("not_found", "Experimento não encontrado"));

  const existing = db
    .select()
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.leadId, leadId)))
    .get();
  if (existing) {
    const v = db.select().from(experimentVariants).where(eq(experimentVariants.id, existing.variantId)).get();
    if (v) return ok(v);
  }

  const variants = db
    .select()
    .from(experimentVariants)
    .where(eq(experimentVariants.experimentId, experimentId))
    .all();
  if (variants.length === 0) return err(new DomainError("validation_failed", "Experimento sem variantes"));

  const chosen = pickVariant(variants, experiment.explorationRate, rng);
  try {
    db.transaction((tx) => {
      tx.insert(experimentAssignments)
        .values({
          id: newId("asg"),
          experimentId,
          variantId: chosen.id,
          leadId,
          createdAt: nowIso(clock),
        })
        .run();
      recordLeadEvent(tx, leadId, "experiment_assigned", { experimentId, variant: chosen.key }, clock);
    });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      // Lost a race; return the now-existing assignment.
      const a = db
        .select()
        .from(experimentAssignments)
        .where(and(eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.leadId, leadId)))
        .get();
      const v = a && db.select().from(experimentVariants).where(eq(experimentVariants.id, a.variantId)).get();
      if (v) return ok(v);
    }
    throw e;
  }
  return ok(chosen);
}

export function recordOutcome(
  db: Db,
  experimentId: string,
  leadId: string,
  metric: string,
  value = 1,
  clock: () => Date = () => new Date(),
): Result<void, DomainError> {
  const assignment = db
    .select()
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.leadId, leadId)))
    .get();
  if (!assignment) return err(new DomainError("not_found", "Lead não está no experimento"));

  db.insert(experimentOutcomes)
    .values({
      id: newId("out"),
      experimentId,
      variantId: assignment.variantId,
      leadId,
      metric,
      value,
      createdAt: nowIso(clock),
    })
    .onConflictDoNothing({
      target: [experimentOutcomes.experimentId, experimentOutcomes.leadId, experimentOutcomes.metric],
    })
    .run();
  return ok(undefined);
}

export interface VariantAnalysis {
  variantId: string;
  key: string;
  label: string;
  isControl: boolean;
  assigned: number;
  outcomes: Record<string, number>;
  conversionByMetric: Record<string, number>;
}

/**
 * Report per-variant assignment counts and conversion rates. It reports; it
 * never declares a winner — that decision stays with the operator / the
 * gradual-rollout logic, and requires a registered sample size.
 */
export function analyzeExperiment(db: Db, experimentId: string): VariantAnalysis[] {
  const variants = db
    .select()
    .from(experimentVariants)
    .where(eq(experimentVariants.experimentId, experimentId))
    .all();

  return variants.map((v) => {
    const assigned = db
      .select()
      .from(experimentAssignments)
      .where(eq(experimentAssignments.variantId, v.id))
      .all().length;

    const outs = db.select().from(experimentOutcomes).where(eq(experimentOutcomes.variantId, v.id)).all();
    const outcomes: Record<string, number> = {};
    for (const o of outs) outcomes[o.metric] = (outcomes[o.metric] ?? 0) + o.value;

    const conversionByMetric: Record<string, number> = {};
    for (const [metric, count] of Object.entries(outcomes)) {
      conversionByMetric[metric] = assigned > 0 ? count / assigned : 0;
    }

    return {
      variantId: v.id,
      key: v.key,
      label: v.label,
      isControl: v.isControl,
      assigned,
      outcomes,
      conversionByMetric,
    };
  });
}

/** A minimum sample per variant before any winner may be considered. */
export function hasSufficientSample(analysis: VariantAnalysis[], minPerVariant = 30): boolean {
  return analysis.every((a) => a.assigned >= minPerVariant);
}
