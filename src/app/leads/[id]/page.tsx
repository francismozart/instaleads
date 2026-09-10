import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppDb } from "@/db/app";
import { getLead, leadTimeline } from "@/features/dashboard/queries";
import { CHANNEL_LABELS_PT, PIPELINE_LABELS_PT, type ChannelState, type PipelineState } from "@/lib/states";
import { PageTitle, Card, Badge, fmtDateTime, EmptyState } from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getAppDb();
  const lead = getLead(db, id);
  if (!lead) notFound();
  const timeline = leadTimeline(db, id);

  return (
    <div>
      <PageTitle title={lead.displayHandle} subtitle={`${lead.funnel === "customer" ? "Cliente" : "Afiliado"} · ${lead.actorType} · score ${lead.score.toFixed(2)}`} />
      <Link href="/leads" style={{ color: "var(--accent)", fontSize: 14 }}>← voltar ao Kanban</Link>

      <Card title="Estado">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge tone="accent">Pipeline: {PIPELINE_LABELS_PT[lead.pipelineState as PipelineState]}</Badge>
          <Badge>Canal: {CHANNEL_LABELS_PT[lead.channelState as ChannelState]}</Badge>
          <Badge>Dono do canal: {lead.channelOwner}</Badge>
          {lead.niche && <Badge>Nicho: {lead.niche}</Badge>}
          {lead.keyword && <Badge>Palavra-chave: {lead.keyword}</Badge>}
          {lead.source && <Badge>Origem: {lead.source}</Badge>}
        </div>
      </Card>

      <Card title="Timeline">
        {timeline.length === 0 ? (
          <EmptyState>Sem eventos.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {timeline.map((t, i) => (
              <div key={i} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 14 }}>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDateTime(t.at)}</div>
                {t.kind === "message" ? (
                  <div>
                    <Badge tone={t.data.direction === "inbound" ? "ok" : "accent"}>
                      {t.data.direction === "inbound" ? "recebida" : "enviada"} · {t.data.channel} · {t.data.status}
                    </Badge>
                    <div style={{ marginTop: 4 }}>{t.data.body}</div>
                  </div>
                ) : (
                  <div>
                    <Badge>{t.data.type}</Badge>
                    {t.data.payload && (
                      <pre style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(t.data.payload)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
