import Link from "next/link";
import { getAppDb } from "@/db/app";
import { leadsByFunnel } from "@/features/dashboard/queries";
import {
  CHANNEL_LABELS_PT,
  PIPELINE_LABELS_PT,
  pipelineStatesFor,
  type ChannelState,
  type Funnel,
  type PipelineState,
} from "@/lib/states";
import { PageTitle, Badge } from "../_components/ui";
import type { Lead } from "@/db/schema";

export const dynamic = "force-dynamic";

function channelTone(c: ChannelState): "ok" | "warn" | "danger" | "accent" | undefined {
  if (c === "do_not_contact" || c === "blocked") return "danger";
  if (c === "human_review_required" || c === "api_window_closed") return "warn";
  if (c === "api_active") return "ok";
  return "accent";
}

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <Link href={`/leads/${lead.id}`} className="card" style={{ display: "block", padding: 10, marginBottom: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{lead.displayHandle}</div>
      <div style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 6px" }}>
        {lead.niche ?? lead.actorType} · score {lead.score.toFixed(2)}
      </div>
      <Badge tone={channelTone(lead.channelState as ChannelState)}>
        {CHANNEL_LABELS_PT[lead.channelState as ChannelState]}
      </Badge>
    </Link>
  );
}

function Board({ funnel, title }: { funnel: Funnel; title: string }) {
  const db = getAppDb();
  const leads = leadsByFunnel(db, funnel);
  const states = pipelineStatesFor(funnel);
  const byState = new Map<PipelineState, Lead[]>();
  for (const s of states) byState.set(s, []);
  for (const l of leads) byState.get(l.pipelineState as PipelineState)?.push(l);

  return (
    <div style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 16 }}>{title} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({leads.length})</span></h2>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
        {states.map((s) => (
          <div key={s} style={{ minWidth: 190, flex: "0 0 190px" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {PIPELINE_LABELS_PT[s]} · {byState.get(s)?.length ?? 0}
            </div>
            {(byState.get(s) ?? []).map((l) => (
              <LeadCard key={l.id} lead={l} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LeadsPage() {
  return (
    <div>
      <PageTitle title="Leads — Kanban por funil" subtitle="Pipeline e canal são dimensões separadas. Prospecção separada das conversas pessoais." />
      <Board funnel="customer" title="Funil A — Clientes" />
      <Board funnel="affiliate" title="Funil B — Afiliados" />
    </div>
  );
}
