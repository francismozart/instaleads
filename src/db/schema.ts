import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema (Drizzle). Internal values are English; the UI translates them.
 * Timestamps are UTC ISO-8601 strings written by the application layer so the
 * whole system shares one clock representation.
 *
 * Invariants enforced at the database level:
 *  - a lead handle is unique (dedupe)
 *  - a Meta message id is unique (inbound idempotency)
 *  - a logical outbound message dedupe_key is unique (no double send)
 *  - a webhook external event id is unique (webhook idempotency)
 *  - a job idempotency key is unique (job idempotency)
 */

// ── leads ────────────────────────────────────────────────────────────────────
export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(), // normalized, no leading @
    displayHandle: text("display_handle").notNull(),
    fullName: text("full_name"),
    funnel: text("funnel").notNull(), // 'customer' | 'affiliate'
    pipelineState: text("pipeline_state").notNull(),
    channelState: text("channel_state").notNull(),
    channelOwner: text("channel_owner").notNull().default("none"), // 'browser'|'api'|'none'
    actorType: text("actor_type").notNull().default("unknown"), // store|employee|owner|decision_maker|unknown
    isDecisionMaker: integer("is_decision_maker", { mode: "boolean" }).notNull().default(false),
    niche: text("niche"),
    category: text("category"),
    score: real("score").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    source: text("source"),
    keyword: text("keyword"),
    profile: text("profile", { mode: "json" }).$type<Record<string, unknown>>(),
    metaUserId: text("meta_user_id"), // Instagram-scoped id, set at handoff
    lastContactedAt: text("last_contacted_at"),
    nextActionAt: text("next_action_at"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("leads_handle_uq").on(t.handle),
    uniqueIndex("leads_meta_user_uq").on(t.metaUserId),
    index("leads_funnel_pipeline_idx").on(t.funnel, t.pipelineState),
    index("leads_next_action_idx").on(t.nextActionAt),
    index("leads_channel_state_idx").on(t.channelState),
  ],
);

// ── lead events / decision + audit log ────────────────────────────────────────
export const leadEvents = sqliteTable(
  "lead_events",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("lead_events_lead_idx").on(t.leadId),
    index("lead_events_type_idx").on(t.type),
    index("lead_events_created_idx").on(t.createdAt),
  ],
);

// ── messages ──────────────────────────────────────────────────────────────────
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id),
    channel: text("channel").notNull(), // 'browser' | 'api' | 'whatsapp'
    direction: text("direction").notNull(), // 'outbound' | 'inbound'
    body: text("body").notNull(),
    variantId: text("variant_id"),
    intent: text("intent"),
    status: text("status").notNull(), // queued|sent|delivered|received|failed
    externalId: text("external_id"), // Meta message id
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("messages_dedupe_uq").on(t.dedupeKey),
    uniqueIndex("messages_external_uq").on(t.externalId),
    index("messages_lead_idx").on(t.leadId),
    index("messages_channel_idx").on(t.channel),
  ],
);

// ── durable job queue ─────────────────────────────────────────────────────────
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"), // pending|running|succeeded|failed|dead
    priority: integer("priority").notNull().default(0),
    runAfter: text("run_after").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_uq").on(t.idempotencyKey),
    index("jobs_status_runafter_idx").on(t.status, t.runAfter),
    index("jobs_type_idx").on(t.type),
  ],
);

// ── OpenAI usage accounting ───────────────────────────────────────────────────
export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id"),
    purpose: text("purpose").notNull(), // classify|extract|compose|decide
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt), index("ai_calls_lead_idx").on(t.leadId)],
);

// ── experiments ───────────────────────────────────────────────────────────────
export const experiments = sqliteTable(
  "experiments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    variable: text("variable").notNull(),
    funnel: text("funnel").notNull().default("both"),
    status: text("status").notNull().default("running"), // running | stopped
    explorationRate: real("exploration_rate").notNull().default(0.1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("experiments_name_uq").on(t.name)],
);

export const experimentVariants = sqliteTable(
  "experiment_variants",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
    weight: real("weight").notNull().default(1),
    isControl: integer("is_control", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("experiment_variants_uq").on(t.experimentId, t.key)],
);

export const experimentAssignments = sqliteTable(
  "experiment_assignments",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => experimentVariants.id),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("experiment_assignments_uq").on(t.experimentId, t.leadId)],
);

export const experimentOutcomes = sqliteTable(
  "experiment_outcomes",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => experimentVariants.id),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id),
    metric: text("metric").notNull(), // reply|interested|handoff|active_customer|...
    value: real("value").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("experiment_outcomes_variant_metric_idx").on(t.variantId, t.metric),
    uniqueIndex("experiment_outcomes_uq").on(t.experimentId, t.leadId, t.metric),
  ],
);

// ── webhook idempotency ───────────────────────────────────────────────────────
export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status").notNull().default("received"),
    processedAt: text("processed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("webhook_events_external_uq").on(t.externalEventId)],
);

// ── do-not-contact (permanent, cross-campaign) ───────────────────────────────
export const doNotContact = sqliteTable(
  "do_not_contact",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    reason: text("reason"),
    source: text("source"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("do_not_contact_handle_uq").on(t.handle)],
);

// ── system state (pause switch, circuit breaker, warmup anchor, limits) ───────
export const systemState = sqliteTable("system_state", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── daily send counters (rate limit + warmup) ────────────────────────────────
export const dailyCounters = sqliteTable("daily_counters", {
  date: text("date").primaryKey(), // YYYY-MM-DD in operating timezone
  dmSent: integer("dm_sent").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

// ── exception queue + integration alerts ──────────────────────────────────────
export const exceptions = sqliteTable(
  "exceptions",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id"),
    jobId: text("job_id"),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    context: text("context", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status").notNull().default("open"), // open | resolved
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("exceptions_status_idx").on(t.status), index("exceptions_kind_idx").on(t.kind)],
);

// Convenience: keep a reference to `sql` used by migrations tooling.
export const _sql = sql;

// ── inferred types ────────────────────────────────────────────────────────────
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type AiCall = typeof aiCalls.$inferSelect;
export type Experiment = typeof experiments.$inferSelect;
export type ExperimentVariant = typeof experimentVariants.$inferSelect;
export type ExperimentAssignment = typeof experimentAssignments.$inferSelect;
export type ExperimentOutcome = typeof experimentOutcomes.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type Exception = typeof exceptions.$inferSelect;
