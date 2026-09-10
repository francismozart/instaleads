import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { getAppDb } from "@/db/app";
import { getPauseState } from "@/features/system/state";
import { resumeAction } from "./actions";

export const metadata: Metadata = {
  title: "instaleads — Prospecção autônoma",
  description: "Painel de prospecção autônoma no Instagram da Mozart Consultoria em TI",
};

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Painel" },
  { href: "/leads", label: "Leads (Kanban)" },
  { href: "/experiments", label: "Experimentos" },
  { href: "/jobs", label: "Fila de jobs" },
  { href: "/exceptions", label: "Exceções" },
  { href: "/settings", label: "Configurações" },
];

function readPause(): { paused: boolean; reason: string | null } {
  try {
    return getPauseState(getAppDb());
  } catch {
    return { paused: false, reason: null };
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const pause = readPause();
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <aside
            style={{
              width: 240,
              borderRight: "1px solid var(--border)",
              padding: 20,
              background: "var(--panel-2)",
              position: "sticky",
              top: 0,
              height: "100vh",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>instaleads</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 24 }}>
              Mozart Consultoria em TI
            </div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  style={{ padding: "8px 10px", borderRadius: 8, fontSize: 14, color: "var(--text)" }}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </aside>

          <main style={{ flex: 1, padding: 28, maxWidth: 1200 }}>
            {pause.paused && (
              <div
                className="card"
                style={{ borderColor: "var(--danger)", padding: 16, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <strong style={{ color: "var(--danger)" }}>Sistema pausado.</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>{pause.reason ?? "Motivo não informado"}</span>
                </div>
                <form action={resumeAction}>
                  <button className="btn btn-ok" type="submit">
                    Retomar
                  </button>
                </form>
              </div>
            )}
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
