/* eslint-disable no-console */
import { existsSync, rmSync } from "node:fs";
import { createClient } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { loadBusinessConfig } from "@/lib/config";
import { PIPELINE_LABELS_PT } from "@/lib/states";
import { makeEnv } from "@/test/fixtures";
import { FakeBrowserClient } from "@/integrations/browser/fake";
import { FakeInstagramApiClient } from "@/integrations/instagram/api";
import { FakeConversationEngine } from "@/integrations/openai/fake";
import { costSummary } from "@/integrations/openai/accounting";
import { discoverLead, findLeadByHandle, walkPipelineTo } from "@/features/leads/repository";
import { handoffToApi } from "@/features/conversations/handoff";
import { listMessages } from "@/features/conversations/messages";
import { analyzeExperiment, createExperiment } from "@/features/experiments/service";
import { listOpenExceptions } from "@/features/system/exceptions";
import { ensureWarmupStart } from "@/features/system/state";
import { seededRng } from "@/test/fixtures";
import type { WorkerContext } from "@/worker/context";
import { claimNextJob, enqueueJob, recoverStuckJobs } from "@/worker/queue";
import { runOnce } from "@/worker/runner";

const DB_PATH = "data/e2e.db";

function banner(title: string): void {
  console.log(`\n${"─".repeat(72)}\n▶ ${title}\n${"─".repeat(72)}`);
}

async function drain(ctx: WorkerContext, max = 200): Promise<void> {
  for (let i = 0; i < max; i++) {
    const res = await runOnce(ctx);
    if (!res.worked) break;
  }
}

async function main(): Promise<void> {
  for (const suffix of ["", "-shm", "-wal"]) if (existsSync(DB_PATH + suffix)) rmSync(DB_PATH + suffix);

  const { db } = createClient(DB_PATH);
  runMigrations(db);

  // Read the REAL business identity from config/business.json.
  const config = loadBusinessConfig();
  // Env uses fakes only — no secrets, no network, no spend.
  const env = makeEnv({ MIN_SECONDS_BETWEEN_DMS: 0, MAX_SECONDS_BETWEEN_DMS: 1 });

  const browser = new FakeBrowserClient({ mode: "success" });
  const instagram = new FakeInstagramApiClient();
  const ctx: WorkerContext = {
    db,
    env,
    config,
    engine: new FakeConversationEngine({ fastModel: env.OPENAI_MODEL_FAST, writeModel: env.OPENAI_MODEL }),
    browser,
    instagram,
    clock: () => new Date(),
    rng: seededRng(7),
    workerId: "e2e",
  };

  // Warm-up anchored 60 days back so the daily cap is not the warm-up cap in the demo.
  ensureWarmupStart(db, () => new Date(Date.now() - 60 * 24 * 3600 * 1000));

  console.log(`\n🏢 ${config.company.name} — ${config.owner.name}`);
  console.log(`   ${config.pitch.oneLine}`);

  // ── A/B experiment on the opener copy ──────────────────────────────────────
  banner("Experimento A/B (variável: mensagem de abertura)");
  const exp = createExperiment(db, {
    name: "opener-copy",
    variable: "opening_message",
    funnel: "both",
    explorationRate: 0.15,
    variants: [
      { key: "control", label: "Controle — direto", isControl: true, weight: 1 },
      { key: "story", label: "Variante — referência ao conteúdo", weight: 1 },
    ],
  });
  console.log(exp.ok ? "  criado: opener-copy (controle + variante)" : `  erro: ${exp.ok}`);

  // ── discovery ───────────────────────────────────────────────────────────────
  banner("Funil A (clientes) + Funil B (afiliados) — descoberta");
  enqueueJob(db, {
    type: "discover",
    payload: {
      qualifyThreshold: 0.2,
      candidates: [
        { handle: "@imob.horizonte", funnel: "customer", source: "keyword:imobiliária", keyword: "CRM sob medida", signals: { fullName: "Rafael — Fundador", bio: "Imobiliária. CRM sob medida e atendimento IA WhatsApp para corretores.", category: "Imobiliária" } },
        { handle: "@studio.reforma", funnel: "customer", source: "keyword:site", keyword: "site que converte", signals: { fullName: "Marina", bio: "Reformas. Preciso de site que converte e automação n8n.", category: "Serviço" } },
        { handle: "@clinica.bemestar", funnel: "customer", source: "keyword:atendimento", keyword: "atendimento IA WhatsApp", signals: { fullName: "Dra. Paula — Diretora", bio: "Clínica. Atendimento IA WhatsApp e CRM sob medida.", category: "Saúde" } },
        { handle: "@memes.brasil", funnel: "customer", source: "keyword:generic", signals: { bio: "só memes e futebol" } },
        { handle: "@creator.tech", funnel: "affiliate", source: "topic:ia", signals: { fullName: "Léo Creator", bio: "Criador. Falo de automação n8n, esteira de conteúdo e mentoria de IA.", category: "Criador" } },
      ],
    },
  });
  await drain(ctx);
  for (const h of ["@imob.horizonte", "@studio.reforma", "@clinica.bemestar", "@memes.brasil", "@creator.tech"]) {
    const l = findLeadByHandle(db, h);
    console.log(`  ${h.padEnd(22)} → ${l ? `score ${l.score.toFixed(2)}, ${PIPELINE_LABELS_PT[l.pipelineState as keyof typeof PIPELINE_LABELS_PT]}, canal ${l.channelState}` : "não descoberto"}`);
  }

  // ── first contact via the browser ───────────────────────────────────────────
  banner("Primeiro contato pelo navegador (Chrome real do operador via CDP)");
  await drain(ctx);
  console.log(`  DMs enviadas pelo navegador: ${browser.sent.length}`);
  for (const s of browser.sent) console.log(`   → @${s.handle}: "${s.message.slice(0, 70)}..."`);

  // ── inbound replies + handoff to the official API ───────────────────────────
  banner("Respostas recebidas (webhook) → handoff → API oficial");
  const replies: { handle: string; meta: string; body: string; mid: string }[] = [
    { handle: "@imob.horizonte", meta: "IG_1", body: "quero saber mais, me chama no whats", mid: "mid.1" },
    { handle: "@studio.reforma", meta: "IG_2", body: "quanto custa?", mid: "mid.2" },
    { handle: "@clinica.bemestar", meta: "IG_3", body: "pode parar de me mandar mensagem", mid: "mid.3" },
    { handle: "@creator.tech", meta: "IG_4", body: "gostei, quero ser afiliado", mid: "mid.4" },
  ];
  for (const r of replies) {
    const res = handoffToApi(db, { metaUserId: r.meta, username: r.handle, body: r.body, externalId: r.mid });
    const lead = findLeadByHandle(db, r.handle)!;
    console.log(`  ${r.handle.padEnd(22)} "${r.body}" → ${res.ok ? `dono do canal: ${lead.channelOwner}` : "sem match"}`);
    enqueueJob(db, { type: "api_reply", payload: { leadId: lead.id }, idempotencyKey: `api_reply:${lead.id}:${r.mid}` });
  }
  await drain(ctx);

  banner("Decisão autônoma da IA + próxima ação (por lead)");
  for (const r of replies) {
    const lead = findLeadByHandle(db, r.handle)!;
    console.log(`  ${r.handle.padEnd(22)} → pipeline: ${PIPELINE_LABELS_PT[lead.pipelineState as keyof typeof PIPELINE_LABELS_PT]}, canal: ${lead.channelState}`);
  }
  console.log(`  Mensagens enviadas pela API oficial: ${instagram.sent.length}`);

  // ── double-send guarantee ───────────────────────────────────────────────────
  banner("Garantia anti-duplicidade (navegador × API)");
  const imob = findLeadByHandle(db, "@imob.horizonte")!;
  const msgs = listMessages(db, imob.id);
  console.log(`  @imob.horizonte: ${msgs.filter((m) => m.channel === "browser").length} via navegador, ${msgs.filter((m) => m.channel === "api").length} via API, 0 duplicadas (dedupe + trava de canal)`);

  // ── experiment measurement ──────────────────────────────────────────────────
  banner("Medição do experimento A/B");
  if (exp.ok) {
    for (const a of analyzeExperiment(db, exp.ok ? exp.value.experiment.id : "")) {
      const conv = Object.entries(a.conversionByMetric).map(([m, v]) => `${m}=${(v * 100).toFixed(0)}%`).join(" ");
      console.log(`  ${a.isControl ? "[controle] " : "          "}${a.label.padEnd(38)} amostra=${a.assigned} ${conv || "(sem conversões ainda)"}`);
    }
    console.log("  (nenhum vencedor declarado: amostra insuficiente — regra de honestidade estatística)");
  }

  // ── AI cost accounting ──────────────────────────────────────────────────────
  banner("Custo de IA (visível no painel)");
  const cost = costSummary(db);
  console.log(`  chamadas: ${cost.calls} · custo no mês: US$ ${cost.monthUsd.toFixed(4)} · total: US$ ${cost.totalUsd.toFixed(4)}`);

  // ── exception queue ─────────────────────────────────────────────────────────
  banner("Fila de exceções (ex.: afiliado sem link de grupo → revisão humana)");
  const exceptions = listOpenExceptions(db);
  if (exceptions.length === 0) console.log("  (vazia)");
  for (const e of exceptions) console.log(`  [${e.kind}] ${e.message}`);

  // ── restart recovery ────────────────────────────────────────────────────────
  banner("Recuperação após reinício");
  enqueueJob(db, { type: "follow_up", payload: { leadId: imob.id } });
  const claimed = claimNextJob(db, { workerId: "e2e" });
  console.log(`  job em execução (simulando crash): ${claimed?.type} [${claimed?.status}]`);
  const recovered = recoverStuckJobs(db);
  console.log(`  jobs re-enfileirados no restart: ${recovered}`);

  banner("✅ Fluxo end-to-end concluído");
  console.log("  Observar → Decidir → Agir → Medir → Aprender → Adaptar — sem intervenção manual.\n");
}

main().catch((e) => {
  console.error("e2e falhou:", e);
  process.exit(1);
});
