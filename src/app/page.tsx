import Link from "next/link";
import { getAppDb } from "@/db/app";
import { getOverview, recentDecisions } from "@/features/dashboard/queries";
import { PageTitle, Stat, Row, Card, Badge, EmptyState, fmtDateTime } from "./_components/ui";
import { pauseAction, resumeAction, seedDemoAction } from "./actions";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const db = getAppDb();
  const o = getOverview(db);
  const decisions = recentDecisions(db, 12);
  const budgetHint = `mês: US$ ${o.costMonthUsd.toFixed(4)}`;

  return (
    <div>
      <PageTitle title="Painel geral" subtitle="Prospecção autônoma no Instagram — Observar → Decidir → Agir → Medir → Aprender → Adaptar" />

      <Row>
        <Stat label="Leads totais" value={o.totalLeads} hint={`${o.customers} clientes · ${o.affiliates} afiliados`} />
        <Stat label="Clientes ativos" value={o.activeCustomers} tone="ok" />
        <Stat label="Afiliados ativos" value={o.activeAffiliates} tone="ok" />
        <Stat label="DMs hoje" value={o.dmsToday} hint="ritmo humano por saúde da conta" />
        <Stat label="Exceções abertas" value={o.openExceptions} tone={o.openExceptions > 0 ? "warn" : undefined} />
        <Stat label="Estado" value={o.paused ? "Pausado" : "Ativo"} tone={o.paused ? "danger" : "ok"} />
      </Row>

      <Row>
        <Stat label="Custo de IA (total)" value={`US$ ${o.costTotalUsd.toFixed(4)}`} hint={budgetHint} />
        <Stat label="Chamadas de IA" value={o.aiCalls} />
        <Stat label="Custo por lead" value={`US$ ${o.costPerLeadUsd.toFixed(4)}`} />
        <Stat label="Custo por cliente ativo" value={o.activeCustomers ? `US$ ${o.costPerActiveCustomerUsd.toFixed(4)}` : "—"} />
      </Row>

      <Card title="Controles">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {o.paused ? (
            <form action={resumeAction}>
              <button className="btn btn-ok" type="submit">Retomar sistema</button>
            </form>
          ) : (
            <form action={pauseAction} style={{ display: "flex", gap: 8 }}>
              <input name="reason" placeholder="Motivo da pausa" className="btn" style={{ minWidth: 220 }} />
              <button className="btn btn-danger" type="submit">Pausa geral</button>
            </form>
          )}
          <form action={seedDemoAction}>
            <button className="btn" type="submit">Semear leads de exemplo</button>
          </form>
          <Link className="btn" href="https://www.instagram.com/mozart_hq/" target="_blank">Instagram</Link>
          <Link className="btn" href="https://wa.me/5527981434479" target="_blank">WhatsApp</Link>
        </div>
      </Card>

      <Card title="Fila de jobs">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["pending", "running", "succeeded", "failed", "dead"].map((s) => (
            <Badge key={s} tone={s === "dead" || s === "failed" ? "danger" : s === "succeeded" ? "ok" : "accent"}>
              {s}: {o.jobStats[s] ?? 0}
            </Badge>
          ))}
          <Link className="btn" href="/jobs" style={{ padding: "2px 10px" }}>ver fila</Link>
        </div>
      </Card>

      <Card title="Log de decisões da IA (recentes)">
        {decisions.length === 0 ? (
          <EmptyState>Nenhuma decisão registrada ainda. Semeie leads de exemplo para ver o fluxo.</EmptyState>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: 6 }}>Quando</th>
                <th>Lead</th>
                <th>Intenção</th>
                <th>Ação</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: 6, color: "var(--muted)" }}>{fmtDateTime(d.at)}</td>
                  <td>
                    <Link href={`/leads/${d.leadId}`} style={{ color: "var(--accent)" }}>{d.handle}</Link>
                  </td>
                  <td><Badge tone="accent">{d.intent}</Badge></td>
                  <td>{d.action}</td>
                  <td style={{ color: "var(--muted)" }}>{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
