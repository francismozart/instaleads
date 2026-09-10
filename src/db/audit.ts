import type { DbOrTx } from "./client";
import { leadEvents } from "./schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export type LeadEventType =
  | "discovered"
  | "qualified"
  | "scored"
  | "pipeline_changed"
  | "channel_changed"
  | "message_queued"
  | "message_sent"
  | "message_received"
  | "ai_decision"
  | "handoff"
  | "experiment_assigned"
  | "experiment_outcome"
  | "opt_out"
  | "exception"
  | "note";

/** Append an immutable, auditable event to a lead's timeline. */
export function recordLeadEvent(
  db: DbOrTx,
  leadId: string,
  type: LeadEventType,
  payload?: Record<string, unknown>,
  clock: () => Date = () => new Date(),
): void {
  db.insert(leadEvents)
    .values({
      id: newId("evt"),
      leadId,
      type,
      payload: payload ?? {},
      createdAt: nowIso(clock),
    })
    .run();
}
