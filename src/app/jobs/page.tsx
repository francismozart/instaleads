import { getAppDb } from "@/db/app";
import { listJobs } from "@/features/dashboard/queries";
import { PageTitle, Card, Badge, fmtDateTime, EmptyState } from "../_components/ui";

export const dynamic = "force-dynamic";

function tone(status: string): "ok" | "warn" | "danger" | "accent" | undefined {
  if (status === "succeeded") return "ok";
  if (status === "dead" || status === "failed") return "danger";
  if (status === "running") return "warn";
  return "accent";
}

export default function JobsPage() {
  const jobs = listJobs(getAppDb(), 200);
  return (
    <div>
      <PageTitle title="Fila de jobs" subtitle="Jobs duráveis no SQLite · retry com backoff · dead-letter · recuperação após reinício." />
      <Card>
        {jobs.length === 0 ? (
          <EmptyState>Fila vazia.</EmptyState>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: 6 }}>Tipo</th>
                <th>Status</th>
                <th>Tentativas</th>
                <th>Executar após</th>
                <th>Atualizado</th>
                <th>Último erro</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: 6 }}>{j.type}</td>
                  <td><Badge tone={tone(j.status)}>{j.status}</Badge></td>
                  <td>{j.attempts}/{j.maxAttempts}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtDateTime(j.runAfter)}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtDateTime(j.updatedAt)}</td>
                  <td style={{ color: "var(--danger)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>{j.lastError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
