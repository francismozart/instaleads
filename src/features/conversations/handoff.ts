import type { Db } from "@/db/client";
import { recordLeadEvent } from "@/db/audit";
import type { Lead } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { normalizeHandle } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import type { Funnel, PipelineState } from "@/lib/states";
import {
  findLeadByHandle,
  findLeadById,
  findLeadByMetaUserId,
  transitionChannel,
  transitionPipeline,
} from "@/features/leads/repository";
import { recordInbound } from "./messages";

export interface InboundEnvelope {
  metaUserId: string;
  username?: string;
  body: string;
  externalId: string; // Meta message id
}

/**
 * Match an inbound Meta message to a lead. First by the stored Meta user id,
 * then (first reply) by the username we DMed while it still awaits a reply.
 * Returns `needs_human` when it cannot be matched confidently.
 */
export function matchLeadForInbound(db: Db, env: InboundEnvelope): Result<Lead, DomainError> {
  const byMeta = findLeadByMetaUserId(db, env.metaUserId);
  if (byMeta) return ok(byMeta);

  if (env.username) {
    const byHandle = findLeadByHandle(db, normalizeHandle(env.username));
    if (byHandle && byHandle.channelState !== "do_not_contact") return ok(byHandle);
  }

  return err(
    new DomainError("not_found", "Não foi possível casar a mensagem recebida com um lead", {
      metaUserId: env.metaUserId,
    }),
  );
}

/**
 * Handle the first inbound reply: bind the Meta id, transfer channel ownership
 * to the API, record the message, and advance the pipeline to "replied".
 * After this the browser never touches this thread again.
 */
export function handoffToApi(
  db: Db,
  env: InboundEnvelope,
  clock: () => Date = () => new Date(),
): Result<Lead, DomainError> {
  const matched = matchLeadForInbound(db, env);
  if (!matched.ok) return matched;
  const lead = matched.value;

  // Record inbound first (idempotent on externalId).
  const inbound = recordInbound(
    db,
    { leadId: lead.id, body: env.body, externalId: env.externalId, channel: "api" },
    clock,
  );
  if (!inbound.ok && inbound.error.code === "webhook_duplicate") {
    // Already processed this exact message; ownership may already be API.
    return ok(findLeadById(db, lead.id) ?? lead);
  }
  if (!inbound.ok) return err(inbound.error);

  // Transfer ownership to the API and open the API-active channel state.
  if (lead.channelOwner !== "api") {
    const channelRes = transitionChannel(
      db,
      lead.id,
      "api_active",
      { channelOwner: "api", metaUserId: env.metaUserId },
      clock,
    );
    if (!channelRes.ok) {
      // From a fresh state we may need to go via waiting_inbound_reply first.
      transitionChannel(db, lead.id, "waiting_inbound_reply", {}, clock);
      transitionChannel(db, lead.id, "api_active", { channelOwner: "api", metaUserId: env.metaUserId }, clock);
    }
  }

  // Advance pipeline to "replied" when still upstream of it.
  const fresh = findLeadById(db, lead.id)!;
  const replyStates: PipelineState[] = ["discovered", "qualified", "contacted"];
  if (replyStates.includes(fresh.pipelineState as PipelineState)) {
    // Walk forward to "replied".
    let cursor = fresh.pipelineState as PipelineState;
    const ladder: PipelineState[] = ["discovered", "qualified", "contacted", "replied"];
    const targetIdx = ladder.indexOf("replied");
    let idx = ladder.indexOf(cursor);
    while (idx >= 0 && idx < targetIdx) {
      const next = ladder[idx + 1]!;
      const res = transitionPipeline(db, lead.id, next, clock);
      if (!res.ok) break;
      cursor = next;
      idx = ladder.indexOf(cursor);
    }
  }

  recordLeadEvent(db, lead.id, "handoff", { from: "browser", to: "api", metaUserId: env.metaUserId }, clock);
  return ok(findLeadById(db, lead.id) ?? lead);
}

export type { Funnel };
