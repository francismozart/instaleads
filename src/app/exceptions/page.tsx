import Link from "next/link";
import { getAppDb } from "@/db/app";
import { listOpenExceptions } from "@/features/system/exceptions";
import { PageTitle, Card, Badge, fmtDateTime, EmptyState } from "../_components/ui";
import { resolveExceptionAction } from "../actions";

export const dynamic = "force-dynamic";

export default function ExceptionsPage() {
  const items = listOpenExceptions(getAppDb(), 200);
  return (
    <div>
      <PageTitle title="Fila de exceções" subtitle="Tudo que exige o operador: navegador indisponível, janela da API fechada, afirmação bloqueada, divergência, orçamento." />
      <Card>
        {items.length === 0 ? (
          <EmptyState>Nenhuma exceção aberta. 🎉</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((e) => (
              <div key={e.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <Badge tone="warn">{e.kind}</Badge>{" "}
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDateTime(e.createdAt)}</span>
                  <div style={{ marginTop: 4 }}>{e.message}</div>
                  {e.leadId && (
                    <Link href={`/leads/${e.leadId}`} style={{ color: "var(--accent)", fontSize: 13 }}>ver lead</Link>
                  )}
                </div>
                <form action={resolveExceptionAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <button className="btn btn-ok" type="submit">Resolver</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
