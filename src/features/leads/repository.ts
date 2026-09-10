import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordLeadEvent } from "@/db/audit";
import { doNotContact, leads, type Lead } from "@/db/schema";
import type { BusinessConfig } from "@/lib/config";
import { DomainError } from "@/lib/errors";
import { newId, normalizeHandle } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import {
  canTransitionChannel,
  canTransitionPipeline,
  initialChannelState,
  initialPipelineState,
  type ChannelOwner,
  type ChannelState,
  type Funnel,
  type PipelineState,
} from "@/lib/states";
import { nowIso } from "@/lib/time";
import { priorityForScore, scoreLead, type ProfileSignals } from "./scoring";

export interface DiscoverLeadInput {
  handle: string;
  displayHandle?: string;
  funnel: Funnel;
  source?: string;
  keyword?: string;
  niche?: string;
  signals: ProfileSignals;
}

// ── do-not-contact list ───────────────────────────────────────────────────────
export function isOnDoNotContact(db: Db, handle: string): boolean {
  const h = normalizeHandle(handle);
  return Boolean(db.select().from(doNotContact).where(eq(doNotContact.handle, h)).get());
}

export function addToDoNotContact(
  db: Db,
  handle: string,
  reason: string,
  source: string,
  clock: () => Date = () => new Date(),
): void {
  const h = normalizeHandle(handle);
  db.insert(doNotContact)
    .values({ id: newId("dnc"), handle: h, reason, source, createdAt: nowIso(clock) })
    .onConflictDoNothing({ target: doNotContact.handle })
    .run();
}

// ── lookups ───────────────────────────────────────────────────────────────────
export function findLeadByHandle(db: Db, handle: string): Lead | undefined {
  return db.select().from(leads).where(eq(leads.handle, normalizeHandle(handle))).get();
}

export function findLeadById(db: Db, id: string): Lead | undefined {
  return db.select().from(leads).where(eq(leads.id, id)).get();
}

export function findLeadByMetaUserId(db: Db, metaUserId: string): Lead | undefined {
  return db.select().from(leads).where(eq(leads.metaUserId, metaUserId)).get();
}

// ── discovery + dedupe ─────────────────────────────────────────────────────────
export function discoverLead(
  db: Db,
  input: DiscoverLeadInput,
  config: BusinessConfig,
  clock: () => Date = () => new Date(),
): Result<Lead, DomainError> {
  const handle = normalizeHandle(input.handle);
  if (!handle) return err(new DomainError("validation_failed", "Handle vazio"));

  if (isOnDoNotContact(db, handle)) {
    return err(new DomainError("on_do_not_contact_list", `@${handle} está na lista de não contato`));
  }

  const existing = findLeadByHandle(db, handle);
  if (existing) {
    return err(new DomainError("duplicate_lead", `Lead @${handle} já existe`, { id: existing.id }));
  }

  const scored = scoreLead(input.signals, config);
  const now = nowIso(clock);
  const lead: Lead = {
    id: newId("lead"),
    handle,
    displayHandle: input.displayHandle ?? `@${handle}`,
    fullName: input.signals.fullName ?? null,
    funnel: input.funnel,
    pipelineState: initialPipelineState(),
    channelState: initialChannelState(),
    channelOwner: "browser",
    actorType: scored.actorType,
    isDecisionMaker: scored.isDecisionMaker,
    niche: input.niche ?? scored.matchedSegments[0] ?? null,
    category: input.signals.category ?? null,
    score: scored.score,
    priority: priorityForScore(scored.score),
    source: input.source ?? null,
    keyword: input.keyword ?? null,
    profile: input.signals as unknown as Record<string, unknown>,
    metaUserId: null,
    lastContactedAt: null,
    nextActionAt: now,
    notes: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    db.transaction((tx) => {
      tx.insert(leads).values(lead).run();
      recordLeadEvent(tx, lead.id, "discovered", { source: input.source, keyword: input.keyword }, clock);
      recordLeadEvent(
        tx,
        lead.id,
        "scored",
        {
          score: scored.score,
          actorType: scored.actorType,
          matchedKeywords: scored.matchedKeywords,
        },
        clock,
      );
    });
  } catch (e) {
    // Unique constraint => concurrent discovery of the same handle.
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return err(new DomainError("duplicate_lead", `Lead @${handle} já existe`));
    }
    throw e;
  }

  return ok(lead);
}

// ── transitions (atomic + audited) ─────────────────────────────────────────────
export function transitionPipeline(
  db: Db,
  leadId: string,
  to: PipelineState,
  clock: () => Date = () => new Date(),
): Result<Lead, DomainError> {
  const lead = findLeadById(db, leadId);
  if (!lead) return err(new DomainError("not_found", `Lead ${leadId} não encontrado`));

  const from = lead.pipelineState as PipelineState;
  if (!canTransitionPipeline(lead.funnel as Funnel, from, to)) {
    return err(
      new DomainError("invalid_pipeline_transition", `Transição de pipeline inválida: ${from} → ${to}`),
    );
  }

  const now = nowIso(clock);
  db.transaction((tx) => {
    tx.update(leads).set({ pipelineState: to, updatedAt: now }).where(eq(leads.id, leadId)).run();
    recordLeadEvent(tx, leadId, "pipeline_changed", { from, to }, clock);
  });
  return ok({ ...lead, pipelineState: to, updatedAt: now });
}

export interface ChannelTransitionOptions {
  channelOwner?: ChannelOwner;
  metaUserId?: string;
}

export function transitionChannel(
  db: Db,
  leadId: string,
  to: ChannelState,
  options: ChannelTransitionOptions = {},
  clock: () => Date = () => new Date(),
): Result<Lead, DomainError> {
  const lead = findLeadById(db, leadId);
  if (!lead) return err(new DomainError("not_found", `Lead ${leadId} não encontrado`));

  const from = lead.channelState as ChannelState;
  if (!canTransitionChannel(from, to)) {
    return err(
      new DomainError("invalid_channel_transition", `Transição de canal inválida: ${from} → ${to}`),
    );
  }

  const now = nowIso(clock);
  const patch: Partial<Lead> = { channelState: to, updatedAt: now };
  if (options.channelOwner) patch.channelOwner = options.channelOwner;
  if (options.metaUserId) patch.metaUserId = options.metaUserId;

  db.transaction((tx) => {
    tx.update(leads).set(patch).where(eq(leads.id, leadId)).run();
    recordLeadEvent(tx, leadId, "channel_changed", { from, to, ...options }, clock);
  });
  return ok({ ...lead, ...patch });
}

export function markContacted(
  db: Db,
  leadId: string,
  clock: () => Date = () => new Date(),
): void {
  db.update(leads).set({ lastContactedAt: nowIso(clock), updatedAt: nowIso(clock) }).where(eq(leads.id, leadId)).run();
}

/**
 * Honour an opt-out immediately and permanently: add the handle to the
 * do-not-contact list, move the channel to do_not_contact, close the pipeline,
 * and log it. No follow-up, no re-entry through any campaign or channel.
 */
export function optOutLead(
  db: Db,
  leadId: string,
  source: string,
  clock: () => Date = () => new Date(),
): Result<Lead, DomainError> {
  const lead = findLeadById(db, leadId);
  if (!lead) return err(new DomainError("not_found", `Lead ${leadId} não encontrado`));

  const now = nowIso(clock);
  db.transaction((tx) => {
    tx.insert(doNotContact)
      .values({ id: newId("dnc"), handle: lead.handle, reason: "opt_out", source, createdAt: now })
      .onConflictDoNothing({ target: doNotContact.handle })
      .run();
    tx.update(leads)
      .set({ channelState: "do_not_contact", channelOwner: "none", pipelineState: "closed", updatedAt: now })
      .where(eq(leads.id, leadId))
      .run();
    recordLeadEvent(tx, leadId, "opt_out", { source }, clock);
  });

  return ok({ ...lead, channelState: "do_not_contact", channelOwner: "none", pipelineState: "closed" });
}
