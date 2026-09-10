import type { ReactNode } from "react";

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>{title}</h1>
      {subtitle && <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>{subtitle}</p>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "danger" ? "var(--danger)" : "var(--text)";
  return (
    <div className="card" style={{ padding: 16, minWidth: 160 }}>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <div style={{ display: "flex", gap: 12, flexWrap: wrap ? "wrap" : "nowrap" }}>{children}</div>;
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      {title && <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>{title}</h2>}
      {children}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "ok" | "warn" | "danger" | "accent" }) {
  const bg =
    tone === "ok" ? "rgba(34,197,94,.15)" : tone === "warn" ? "rgba(245,158,11,.15)" : tone === "danger" ? "rgba(239,68,68,.15)" : tone === "accent" ? "rgba(59,130,246,.15)" : undefined;
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "danger" ? "var(--danger)" : tone === "accent" ? "var(--accent)" : "var(--muted)";
  return (
    <span className="badge" style={bg ? { background: bg, color, borderColor: color } : undefined}>
      {children}
    </span>
  );
}

export function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div style={{ color: "var(--muted)", padding: 24, textAlign: "center" }}>{children}</div>;
}
