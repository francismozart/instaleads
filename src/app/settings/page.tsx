import { getAppDb } from "@/db/app";
import { getLimitOverrides } from "@/features/system/state";
import { PageTitle, Card } from "../_components/ui";
import { updateLimitsAction } from "../actions";

export const dynamic = "force-dynamic";

function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? Number(v) : fallback;
}

export default function SettingsPage() {
  const overrides = getLimitOverrides(getAppDb());
  const maxDms = overrides.maxDmsPerDay ?? envNumber("MAX_DMS_PER_DAY", 30);
  const minS = overrides.minSecondsBetweenDms ?? envNumber("MIN_SECONDS_BETWEEN_DMS", 90);
  const maxS = overrides.maxSecondsBetweenDms ?? envNumber("MAX_SECONDS_BETWEEN_DMS", 240);
  const hours = overrides.operatingHours ?? process.env.OPERATING_HOURS ?? "09:00-20:00";

  const field = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 13, color: "var(--muted)" };
  const input = { padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)" };

  return (
    <div>
      <PageTitle title="Configuração dos limites" subtitle="Ritmo humano por saúde da conta (não para burlar detecção). Aplicados pelo worker." />
      <Card title="Limites operacionais">
        <form action={updateLimitsAction} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 16, maxWidth: 560 }}>
          <label style={field}>
            DMs por dia (máx.)
            <input style={input} type="number" name="maxDmsPerDay" defaultValue={maxDms} min={1} />
          </label>
          <label style={field}>
            Janela de operação (HH:MM-HH:MM)
            <input style={input} type="text" name="operatingHours" defaultValue={hours} />
          </label>
          <label style={field}>
            Intervalo mínimo entre DMs (s)
            <input style={input} type="number" name="minSecondsBetweenDms" defaultValue={minS} min={1} />
          </label>
          <label style={field}>
            Intervalo máximo entre DMs (s)
            <input style={input} type="number" name="maxSecondsBetweenDms" defaultValue={maxS} min={1} />
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <button className="btn btn-primary" type="submit">Salvar limites</button>
          </div>
        </form>
      </Card>

      <Card title="Aquecimento (warm-up)">
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          5 DMs/dia na 1ª semana, +5 por semana, até o teto configurado. O limite efetivo do dia é o menor entre o teto e o aquecimento.
        </p>
      </Card>
    </div>
  );
}
