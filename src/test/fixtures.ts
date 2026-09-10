import { parseBusinessConfig, type BusinessConfig } from "@/lib/config";
import type { Env } from "@/lib/env";

/** A valid BusinessConfig for tests — verified claims only, no affiliate group. */
export function makeBusinessConfig(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  const base = parseBusinessConfig({
    owner: { name: "Francis Mozart", role: "Fundador / Desenvolvedor Especialista em IA" },
    company: {
      name: "Mozart Consultoria em TI",
      website: "https://immoz.art",
      instagramHandle: "@mozart_hq",
    },
    links: { whatsapp: "https://wa.me/5527981434479", affiliateGroup: null },
    pitch: {
      oneLine: "Orquestro atendimento com IA, CRM, sites e sistemas sob medida.",
      howItWorks: ["Diagnóstico", "Desenho", "Construção", "Operação"],
      revenueModel: "Consultoria/serviço sob medida",
    },
    jargon: { orquestração: "conectar n8n + agentes de IA" },
    claims: {
      verified: [
        "15+ anos de software",
        "fala direto com quem constrói",
        "sem rastreador de terceiro (CSP 'self', verificável)",
        "demos do portfólio simuladas em código, não clientes reais",
      ],
      unverified: ["mais barato do mercado", "aprovação garantida de conta"],
    },
    icp: {
      segments: [
        "Imobiliárias/corretores",
        "Negócios de serviço com atendimento WhatsApp",
        "Quem precisa de constância em redes",
      ],
      keywords: [
        "atendimento IA WhatsApp",
        "CRM sob medida",
        "site que converte",
        "automação n8n",
        "esteira de conteúdo",
        "mentoria de IA",
      ],
      confirmed: false,
    },
    affiliates: { programExists: false, topics: [] },
    geography: {
      country: "Brasil",
      timezone: "America/Sao_Paulo",
      utcOffset: "-03:00",
      notes: "remoto",
    },
  });
  return { ...base, ...overrides };
}

/** A valid Env for tests (always-open operating window, in-memory DB). */
export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "gpt-4.1",
    OPENAI_MODEL_FAST: "gpt-4.1-mini",
    OPENAI_MONTHLY_BUDGET_USD: 50,
    CHROME_CDP_URL: "http://127.0.0.1:9222",
    CHROME_PROFILE_DIR: "./.chrome-profile",
    INSTAGRAM_APP_SECRET: "secret",
    INSTAGRAM_PAGE_ACCESS_TOKEN: "token",
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify",
    INSTAGRAM_BUSINESS_ACCOUNT_ID: "1784000000",
    DATABASE_URL: ":memory:",
    MAX_DMS_PER_DAY: 30,
    MIN_SECONDS_BETWEEN_DMS: 90,
    MAX_SECONDS_BETWEEN_DMS: 240,
    OPERATING_HOURS: "00:00-23:59",
    OPERATING_TIMEZONE: "UTC",
    STATE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

/** A monotonically-advancing clock for deterministic timestamps in tests. */
export function fakeClock(startIso = "2026-01-05T12:00:00.000Z", stepMs = 1000): () => Date {
  let t = new Date(startIso).getTime();
  return () => {
    const d = new Date(t);
    t += stepMs;
    return d;
  };
}

/** Deterministic pseudo-random generator for experiment tests. */
export function seededRng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
