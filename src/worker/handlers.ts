import type { Job } from "@/db/schema";
import { recordLeadEvent } from "@/db/audit";
import { checkClaims } from "@/lib/claims-guard";
import { daysBetween } from "@/integrations/browser/pacing";
import { canSendNow } from "@/integrations/browser/pacing";
import { browserMutex } from "@/integrations/browser/mutex";
import { isWithinMessagingWindow } from "@/integrations/instagram/api";
import { composeGuarded, classifyGuarded } from "@/integrations/openai/runner";
import { redirectFor } from "@/integrations/whatsapp";
import {
  discoverLead,
  findLeadById,
  markContacted,
  optOutLead,
  transitionChannel,
  walkPipelineTo,
  type DiscoverLeadInput,
} from "@/features/leads/repository";
import {
  cancelOutbound,
  lastBrowserSendAt,
  listMessages,
  markOutboundSent,
  reserveOutbound,
} from "@/features/conversations/messages";
import { decideAction } from "@/features/conversations/policy";
import { dateKeyFor, getSentToday, incrementSentToday } from "@/features/system/counters";
import { enqueueException } from "@/features/system/exceptions";
import { ensureWarmupStart, pauseSystem } from "@/features/system/state";
import { assignVariant, findRunningExperiment, recordOutcome } from "@/features/experiments/service";
import type { Funnel, PipelineState } from "@/lib/states";
import { enqueueJob } from "./queue";
import type { HandlerResult, JobHandler, WorkerContext } from "./context";

function history(ctx: WorkerContext, leadId: string) {
  return listMessages(ctx.db, leadId).map((m) => ({ direction: m.direction as "outbound" | "inbound", body: m.body }));
}

// ── discover: ingest candidate profiles into the funnel ───────────────────────
export const discoverHandler: JobHandler = async (ctx, job): Promise<HandlerResult> => {
  const payload = job.payload as { candidates: DiscoverLeadInput[]; qualifyThreshold?: number };
  const threshold = payload.qualifyThreshold ?? 0.3;
  for (const candidate of payload.candidates ?? []) {
    const res = discoverLead(ctx.db, candidate, ctx.config, ctx.clock);
    if (!res.ok) continue;
    const lead = res.value;
    if (lead.score >= threshold) {
      walkPipelineTo(ctx.db, lead.id, "qualified", ctx.clock);
      enqueueJob(
        ctx.db,
        { type: "first_contact", payload: { leadId: lead.id }, idempotencyKey: `first_contact:${lead.id}` },
        ctx.clock,
      );
    }
  }
  return { status: "done" };
};

// ── first_contact: browser first DM, paced ────────────────────────────────────
export const firstContactHandler: JobHandler = async (ctx, job): Promise<HandlerResult> => {
  const { leadId } = job.payload as { leadId: string };
  const lead = findLeadById(ctx.db, leadId);
  if (!lead) return { status: "done" };
  if (lead.channelOwner !== "browser" || lead.channelState !== "browser_contact_pending") {
    return { status: "done" }; // already progressed / not ours
  }

  // Pacing (account health).
  const now = ctx.clock();
  const warmupStart = ensureWarmupStart(ctx.db, ctx.clock);
  const dateKey = dateKeyFor(now, ctx.env.OPERATING_TIMEZONE);
  const decision = canSendNow({
    now,
    operatingHours: ctx.env.OPERATING_HOURS,
    operatingTimezone: ctx.env.OPERATING_TIMEZONE,
    configuredMaxPerDay: ctx.env.MAX_DMS_PER_DAY,
    daysSinceWarmupStart: daysBetween(new Date(warmupStart), now),
    sentToday: getSentToday(ctx.db, dateKey),
    lastSentAt: lastBrowserSendAt(ctx.db),
    minSecondsBetween: ctx.env.MIN_SECONDS_BETWEEN_DMS,
  });
  if (!decision.allowed) {
    const wait =
      decision.reason === "interval_not_elapsed"
        ? (decision.retryAfterSeconds ?? ctx.env.MIN_SECONDS_BETWEEN_DMS)
        : 900; // outside hours / cap → check again in 15 min
    return { status: "reschedule", seconds: wait, reason: decision.reason };
  }

  // Optional A/B on the opener copy.
  let variantId: string | undefined;
  let experimentId: string | undefined;
  const exp = findRunningExperiment(ctx.db, "opening_message", lead.funnel as Funnel);
  if (exp) {
    const assigned = assignVariant(ctx.db, exp.id, lead.id, ctx.rng, ctx.clock);
    if (assigned.ok) {
      variantId = assigned.value.id;
      experimentId = exp.id;
    }
  }

  // Compose a truthful, personal opener.
  const composed = await composeGuarded(
    ctx.db,
    ctx.engine,
    {
      lead: {
        handle: lead.handle,
        fullName: lead.fullName,
        funnel: lead.funnel as Funnel,
        actorType: lead.actorType,
        niche: lead.niche,
        profile: lead.profile ?? {},
      },
      history: history(ctx, lead.id),
      objective: "Abrir uma conversa curta e pessoal com base no conteúdo real do perfil.",
      config: ctx.config,
    },
    { budgetUsd: ctx.env.OPENAI_MONTHLY_BUDGET_USD, leadId: lead.id, clock: ctx.clock },
  );
  if (!composed.ok) {
    if (composed.error.code === "budget_exceeded") {
      pauseSystem(ctx.db, composed.error.message, ctx.clock);
      enqueueException(ctx.db, { kind: "budget_exceeded", message: composed.error.message, leadId: lead.id }, ctx.clock);
      return { status: "pause", reason: composed.error.message, rescheduleSeconds: 3600 };
    }
    throw new Error(composed.error.message);
  }

  // Reserve the send slot (claims gate + dedupe + ownership).
  const reserved = reserveOutbound(
    ctx.db,
    { leadId: lead.id, channel: "browser", body: composed.value.text, phase: "opener", variantId, intent: "opener" },
    ctx.config,
    ctx.clock,
  );
  if (!reserved.ok) {
    if (reserved.error.code === "claim_not_verified") {
      transitionChannel(ctx.db, lead.id, "human_review_required", {}, ctx.clock);
      enqueueException(ctx.db, {
        kind: "claim_blocked",
        message: "Abertura bloqueada pela regra de afirmações",
        leadId: lead.id,
        context: reserved.error.details,
      }, ctx.clock);
      return { status: "done" };
    }
    return { status: "done" }; // duplicate / ownership — nothing to do
  }

  // Send via the operator's Chrome, one browser job at a time.
  const sendResult = await browserMutex.run(() =>
    ctx.browser.sendInstagramDm({ handle: lead.handle, message: composed.value.text, jobId: job.id }),
  );

  if (!sendResult.ok && sendResult.reason === "browser_unavailable") {
    cancelOutbound(ctx.db, reserved.value.id); // allow re-reserve on retry
    pauseSystem(ctx.db, "browser_unavailable", ctx.clock);
    enqueueException(ctx.db, { kind: "browser_unavailable", message: sendResult.error ?? "CDP indisponível", leadId: lead.id, jobId: job.id }, ctx.clock);
    return { status: "pause", reason: "browser_unavailable", rescheduleSeconds: 300 };
  }
  if (!sendResult.ok && sendResult.reason === "dry_run") {
    cancelOutbound(ctx.db, reserved.value.id);
    recordLeadEvent(ctx.db, lead.id, "note", { dryRun: true, wouldSend: composed.value.text }, ctx.clock);
    return { status: "done" };
  }
  if (!sendResult.ok) {
    cancelOutbound(ctx.db, reserved.value.id);
    enqueueException(ctx.db, {
      kind: "needs_human",
      message: `Falha no envio pelo navegador: ${sendResult.error ?? "?"}`,
      leadId: lead.id,
      jobId: job.id,
      context: (sendResult.artifacts ?? {}) as Record<string, unknown>,
    }, ctx.clock);
    throw new Error(sendResult.error ?? "browser send_failed");
  }

  // Success: record, pace counters, advance states.
  markOutboundSent(ctx.db, reserved.value.id, {}, ctx.clock);
  markContacted(ctx.db, lead.id, ctx.clock);
  incrementSentToday(ctx.db, dateKey, ctx.clock);
  transitionChannel(ctx.db, lead.id, "browser_contact_sent", {}, ctx.clock);
  transitionChannel(ctx.db, lead.id, "waiting_inbound_reply", {}, ctx.clock);
  walkPipelineTo(ctx.db, lead.id, "contacted", ctx.clock);
  if (experimentId) recordOutcome(ctx.db, experimentId, lead.id, "contacted", 1, ctx.clock);
  return { status: "done" };
};

// ── api_reply: continue the conversation on the official API ──────────────────
export const apiReplyHandler: JobHandler = async (ctx, job): Promise<HandlerResult> => {
  const { leadId } = job.payload as { leadId: string };
  const lead = findLeadById(ctx.db, leadId);
  if (!lead || !lead.metaUserId) return { status: "done" };
  if (lead.channelOwner !== "api") return { status: "done" }; // ownership lock

  const msgs = listMessages(ctx.db, lead.id);
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound) return { status: "done" };

  // Messaging window: never work around a closed window via the browser.
  if (!isWithinMessagingWindow(new Date(lastInbound.createdAt), ctx.clock())) {
    transitionChannel(ctx.db, lead.id, "api_window_closed", {}, ctx.clock);
    enqueueException(ctx.db, { kind: "api_window_closed", message: "Janela de mensageria expirada", leadId: lead.id }, ctx.clock);
    return { status: "done" };
  }

  // Classify intent.
  const classified = await classifyGuarded(
    ctx.db,
    ctx.engine,
    {
      lead: { handle: lead.handle, fullName: lead.fullName, funnel: lead.funnel as Funnel, actorType: lead.actorType, niche: lead.niche, profile: lead.profile ?? {} },
      history: history(ctx, lead.id),
      latestInbound: lastInbound.body,
    },
    { budgetUsd: ctx.env.OPENAI_MONTHLY_BUDGET_USD, leadId: lead.id, clock: ctx.clock },
  );
  if (!classified.ok) {
    if (classified.error.code === "budget_exceeded") {
      pauseSystem(ctx.db, classified.error.message, ctx.clock);
      return { status: "pause", reason: classified.error.message, rescheduleSeconds: 3600 };
    }
    throw new Error(classified.error.message);
  }
  const intent = classified.value.intent;
  const ambiguousRetries = Number((lead.profile as Record<string, unknown> | undefined)?.ambiguousRetries ?? 0);
  const decision = decideAction(intent, lead.funnel as Funnel, ambiguousRetries);
  recordLeadEvent(ctx.db, lead.id, "ai_decision", { intent, action: decision.action, note: decision.note }, ctx.clock);

  const exp = findRunningExperiment(ctx.db, "opening_message", lead.funnel as Funnel);
  if (exp) recordOutcome(ctx.db, exp.id, lead.id, "reply", 1, ctx.clock);

  // Opt-out is honoured immediately and permanently.
  if (decision.optOut) {
    optOutLead(ctx.db, lead.id, "conversation", ctx.clock);
    return { status: "done" };
  }
  if (decision.escalate) {
    transitionChannel(ctx.db, lead.id, "human_review_required", {}, ctx.clock);
    enqueueException(ctx.db, { kind: "needs_human", message: `Escalado: ${decision.note}`, leadId: lead.id }, ctx.clock);
    return { status: "done" };
  }

  // Forwarding actions.
  if (decision.action === "forward_whatsapp" || decision.action === "forward_affiliate_group") {
    const target = redirectFor(ctx.config, lead.funnel as Funnel);
    if (!target.ok) {
      transitionChannel(ctx.db, lead.id, "human_review_required", {}, ctx.clock);
      enqueueException(ctx.db, { kind: "needs_human", message: target.error.message, leadId: lead.id }, ctx.clock);
      return { status: "done" };
    }
    const objective = `Encaminhar o lead para: ${target.value.url}. Seja breve e verdadeiro.`;
    const sent = await sendApiMessage(ctx, lead.id, objective, "forward", job);
    if (sent.status !== "done") return sent;
    if (decision.pipelineTarget) walkPipelineTo(ctx.db, lead.id, decision.pipelineTarget, ctx.clock);
    if (exp) recordOutcome(ctx.db, exp.id, lead.id, "handoff", 1, ctx.clock);
    return { status: "done" };
  }

  if (decision.action === "schedule_followup") {
    enqueueJob(
      ctx.db,
      {
        type: "follow_up",
        payload: { leadId: lead.id },
        runAfter: new Date(ctx.clock().getTime() + (decision.followupHours ?? 48) * 3600_000).toISOString(),
        idempotencyKey: `follow_up:${lead.id}:${msgs.length}`,
      },
      ctx.clock,
    );
    return { status: "done" };
  }

  if (decision.action === "close") {
    walkPipelineTo(ctx.db, lead.id, "closed", ctx.clock);
    transitionChannel(ctx.db, lead.id, "completed", {}, ctx.clock);
    return { status: "done" };
  }

  // reply / present / ask / handle_objection → compose + send on the API.
  const sent = await sendApiMessage(ctx, lead.id, decision.note, `turn-${msgs.length}`, job);
  if (sent.status !== "done") return sent;
  if (decision.pipelineTarget) walkPipelineTo(ctx.db, lead.id, decision.pipelineTarget as PipelineState, ctx.clock);
  return { status: "done" };
};

// ── follow_up: gentle nudge if still waiting ──────────────────────────────────
export const followUpHandler: JobHandler = async (ctx, job): Promise<HandlerResult> => {
  const { leadId } = job.payload as { leadId: string };
  const lead = findLeadById(ctx.db, leadId);
  if (!lead || lead.channelOwner !== "api" || lead.channelState === "do_not_contact") return { status: "done" };
  const msgs = listMessages(ctx.db, lead.id);
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound || !isWithinMessagingWindow(new Date(lastInbound.createdAt), ctx.clock())) {
    return { status: "done" };
  }
  return sendApiMessage(ctx, lead.id, "Fazer um follow-up leve e respeitoso.", `followup-${msgs.length}`, job);
};

// ── shared: compose + guard + send one API message ────────────────────────────
async function sendApiMessage(
  ctx: WorkerContext,
  leadId: string,
  objective: string,
  phase: string,
  job: Job,
): Promise<HandlerResult> {
  const lead = findLeadById(ctx.db, leadId);
  if (!lead || !lead.metaUserId) return { status: "done" };

  const composed = await composeGuarded(
    ctx.db,
    ctx.engine,
    {
      lead: { handle: lead.handle, fullName: lead.fullName, funnel: lead.funnel as Funnel, actorType: lead.actorType, niche: lead.niche, profile: lead.profile ?? {} },
      history: history(ctx, lead.id),
      objective,
      config: ctx.config,
    },
    { budgetUsd: ctx.env.OPENAI_MONTHLY_BUDGET_USD, leadId: lead.id, clock: ctx.clock },
  );
  if (!composed.ok) {
    if (composed.error.code === "budget_exceeded") {
      pauseSystem(ctx.db, composed.error.message, ctx.clock);
      return { status: "pause", reason: composed.error.message, rescheduleSeconds: 3600 };
    }
    throw new Error(composed.error.message);
  }

  // Extra defence: even if compose slipped, the guard blocks it here too.
  if (!checkClaims(composed.value.text, ctx.config).allowed) {
    transitionChannel(ctx.db, lead.id, "human_review_required", {}, ctx.clock);
    enqueueException(ctx.db, { kind: "claim_blocked", message: "Resposta bloqueada pela regra de afirmações", leadId: lead.id }, ctx.clock);
    return { status: "done" };
  }

  const reserved = reserveOutbound(
    ctx.db,
    { leadId: lead.id, channel: "api", body: composed.value.text, phase },
    ctx.config,
    ctx.clock,
  );
  if (!reserved.ok) return { status: "done" }; // dedupe / ownership / claim

  const apiRes = await ctx.instagram.sendTextMessage(lead.metaUserId, composed.value.text);
  if (!apiRes.ok) {
    cancelOutbound(ctx.db, reserved.value.id);
    enqueueException(ctx.db, { kind: "api_not_authorized", message: apiRes.error, leadId: lead.id, jobId: job.id }, ctx.clock);
    throw new Error(`API send falhou: ${apiRes.error}`);
  }
  markOutboundSent(ctx.db, reserved.value.id, { externalId: apiRes.messageId }, ctx.clock);
  return { status: "done" };
}

export const HANDLERS: Record<string, JobHandler> = {
  discover: discoverHandler,
  first_contact: firstContactHandler,
  api_reply: apiReplyHandler,
  follow_up: followUpHandler,
};
