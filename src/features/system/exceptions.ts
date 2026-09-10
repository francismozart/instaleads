import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { exceptions, type Exception } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export type ExceptionKind =
  | "browser_unavailable"
  | "api_window_closed"
  | "api_not_authorized"
  | "webhook_down"
  | "claim_blocked"
  | "channel_divergence"
  | "unexpected_ai"
  | "budget_exceeded"
  | "instagram_restriction"
  | "session_lost"
  | "duplicate_send"
  | "job_dead"
  | "needs_human";

export interface EnqueueExceptionInput {
  kind: ExceptionKind;
  message: string;
  leadId?: string;
  jobId?: string;
  context?: Record<string, unknown>;
}

/** Push an item onto the exception queue for operator review. */
export function enqueueException(
  db: Db,
  input: EnqueueExceptionInput,
  clock: () => Date = () => new Date(),
): Exception {
  const row = {
    id: newId("exc"),
    leadId: input.leadId ?? null,
    jobId: input.jobId ?? null,
    kind: input.kind,
    message: input.message,
    context: input.context ?? {},
    status: "open" as const,
    createdAt: nowIso(clock),
    resolvedAt: null,
  };
  db.insert(exceptions).values(row).run();
  return row as Exception;
}

export function listOpenExceptions(db: Db, limit = 100): Exception[] {
  return db
    .select()
    .from(exceptions)
    .where(eq(exceptions.status, "open"))
    .orderBy(desc(exceptions.createdAt))
    .limit(limit)
    .all();
}

export function resolveException(db: Db, id: string, clock: () => Date = () => new Date()): void {
  db.update(exceptions)
    .set({ status: "resolved", resolvedAt: nowIso(clock) })
    .where(and(eq(exceptions.id, id), eq(exceptions.status, "open")))
    .run();
}
