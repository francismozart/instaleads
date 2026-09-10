import { getAppDb } from "@/db/app";
import { experiments } from "@/db/schema";
import { analyzeExperiment, hasSufficientSample } from "@/features/experiments/service";
import { PageTitle, Card, Badge, EmptyState } from "../_components/ui";

export const dynamic = "force-dynamic";

export default function ExperimentsPage() {
  const db = getAppDb();
  const exps = db.select().from(experiments).all();

  return (
    <div>
      <PageTitle title="Experimentos (A/B)" subtitle="Uma variável por vez · grupo de controle · sem declarar vencedor cedo · fatia sempre explorando." />
      {exps.length === 0 ? (
        <EmptyState>Nenhum experimento. O worker cria/atribui automaticamente quando configurado.</EmptyState>
      ) : (
        exps.map((exp) => {
          const analysis = analyzeExperiment(db, exp.id);
          const enough = hasSufficientSample(analysis, 30);
          return (
            <Card key={exp.id} title={`${exp.name} — variável: ${exp.variable}`}>
              <div style={{ marginBottom: 10, display: "flex", gap: 8 }}>
                <Badge tone={exp.status === "running" ? "ok" : undefined}>{exp.status}</Badge>
                <Badge>funil: {exp.funnel}</Badge>
                <Badge>exploração: {(exp.explorationRate * 100).toFixed(0)}%</Badge>
                <Badge tone={enough ? "ok" : "warn"}>{enough ? "amostra suficiente" : "amostra insuficiente"}</Badge>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Variante</th>
                    <th>Amostra</th>
                    <th>Conversões</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.map((a) => (
                    <tr key={a.variantId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: 6 }}>
                        {a.label} {a.isControl && <Badge>controle</Badge>}
                      </td>
                      <td>{a.assigned}</td>
                      <td style={{ color: "var(--muted)" }}>
                        {Object.entries(a.conversionByMetric)
                          .map(([m, v]) => `${m}: ${(v * 100).toFixed(0)}%`)
                          .join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })
      )}
    </div>
  );
}
