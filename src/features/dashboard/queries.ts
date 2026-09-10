import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { exceptions, jobs, leadEvents, leads, messages, type Lead, type LeadEvent, type Message } from "@/db/schema";
import { costSummary } from "@/integrations/openai/accounting";
import { getPauseState } from "@/features/system/state";
import { getSentToday } from "@/features/system/counters";
import { dateKeyFor } from "@/features/system/counters";
import type { ChannelState, Funnel } from "@/lib/states";

export interface Overview {
  totalLeads: number;
  customers: number;
  affiliates: number;
  activeCustomers: number;
  activeAffiliates: number;
  openExceptions: number;
  paused: boolean;
  pauseReason: string | null;
  jobStats: Record<string, number>;
  costMonthUsd: number;
  costTotalUsd: number;
  aiCalls: number;
  costPerLeadUsd: number;
  costPerActiveCustomerUsd: number;
  dmsToday: number;
}

export function getOverview(db: Db, timezone = "America/Sao_Paulo"): Overview {
  const allLeads = db.select().from(leads).all();
  const customers = allLeads.filter((l) => l.funnel === "customer");
  const affiliates = allLeads.filter((l) => l.funnel === "affiliate");
  const activeCustomers = customers.filter((l) => l.pipelineState === "active_customer").length;
  const activeAffiliates = affiliates.filter((l) => l.pipelineState === "active_affiliate").length;

  const jobRows = db.select().from(jobs).all();
  const jobStats: Record<string, number> = {};
  for (const j of jobRows) jobStats[j.status] = (jobStats[j.status] ?? 0) + 1;

  const openExceptions = db.select().from(exceptions).where(eq(exceptions.status, "open")).all().length;

  const cost = costSummary(db);
  const pause = getPauseState(db);

  return {
    totalLeads: allLeads.length,
    customers: customers.length,
    affiliates: affiliates.length,
    activeCustomers,
    activeAffiliates,
    openExceptions,
    paused: pause.paused,
    pauseReason: pause.reason,
    jobStats,
    costMonthUsd: cost.monthUsd,
    costTotalUsd: cost.totalUsd,
    aiCalls: cost.calls,
    costPerLeadUsd: allLeads.length ? cost.totalUsd / allLeads.length : 0,
    costPerActiveCustomerUsd: activeCustomers ? cost.totalUsd / activeCustomers : 0,
    dmsToday: getSentToday(db, dateKeyFor(new Date(), timezone)),
  };
}

export function pipelineCounts(db: Db, funnel: Funnel): Record<string, number> {
  const rows = db.select().from(leads).where(eq(leads.funnel, funnel)).all();
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.pipelineState] = (counts[r.pipelineState] ?? 0) + 1;
  return counts;
}

export function channelCounts(db: Db): Record<ChannelState, number> {
  const rows = db.select().from(leads).all();
  const counts = {} as Record<ChannelState, number>;
  for (const r of rows) counts[r.channelState as ChannelState] = (counts[r.channelState as ChannelState] ?? 0) + 1;
  return counts;
}

export function leadsByFunnel(db: Db, funnel: Funnel): Lead[] {
  return db.select().from(leads).where(eq(leads.funnel, funnel)).orderBy(desc(leads.score)).all();
}

export function getLead(db: Db, id: string): Lead | undefined {
  return db.select().from(leads).where(eq(leads.id, id)).get();
}

export type TimelineEntry =
  | { kind: "event"; at: string; data: LeadEvent }
  | { kind: "message"; at: string; data: Message };

export function leadTimeline(db: Db, leadId: string): TimelineEntry[] {
  const evts = db.select().from(leadEvents).where(eq(leadEvents.leadId, leadId)).all();
  const msgs = db.select().from(messages).where(eq(messages.leadId, leadId)).all();
  const entries: TimelineEntry[] = [
    ...evts.map((e) => ({ kind: "event" as const, at: e.createdAt, data: e })),
    ...msgs.map((m) => ({ kind: "message" as const, at: m.createdAt, data: m })),
  ];
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export interface DecisionRow {
  leadId: string;
  handle: string;
  at: string;
  intent?: string;
  action?: string;
  note?: string;
}

export function recentDecisions(db: Db, limit = 25): DecisionRow[] {
  const evts = db
    .select()
    .from(leadEvents)
    .where(eq(leadEvents.type, "ai_decision"))
    .orderBy(desc(leadEvents.createdAt))
    .limit(limit)
    .all();
  return evts.map((e) => {
    const lead = db.select().from(leads).where(eq(leads.id, e.leadId)).get();
    const payload = (e.payload ?? {}) as { intent?: string; action?: string; note?: string };
    return {
      leadId: e.leadId,
      handle: lead?.displayHandle ?? e.leadId,
      at: e.createdAt,
      intent: payload.intent,
      action: payload.action,
      note: payload.note,
    };
  });
}

export function listJobs(db: Db, limit = 100): (typeof jobs.$inferSelect)[] {
  return db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(limit).all();
}
