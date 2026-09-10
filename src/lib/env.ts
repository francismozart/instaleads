import { z } from "zod";

/**
 * Environment validation. All process configuration enters the system here and
 * nowhere else — domain code receives typed config, never `process.env`.
 *
 * Parsing is lazy and cached so importing this module never crashes tools that
 * don't need a fully-populated environment (e.g. unit tests).
 */
const timeRange = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_MODEL_FAST: z.string().min(1),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive(),

  CHROME_CDP_URL: z.string().url(),
  CHROME_PROFILE_DIR: z.string().min(1),

  INSTAGRAM_APP_SECRET: z.string().min(1),
  INSTAGRAM_PAGE_ACCESS_TOKEN: z.string().min(1),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().min(1),

  DATABASE_URL: z.string().min(1).default("data/instaleads.db"),

  MAX_DMS_PER_DAY: z.coerce.number().int().positive().default(30),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(240),
  OPERATING_HOURS: z.string().regex(timeRange).default("09:00-20:00"),
  OPERATING_TIMEZONE: z.string().min(1).default("America/Sao_Paulo"),

  STATE_ENCRYPTION_KEY: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validate and return the environment. Throws with a readable report if invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuração de ambiente inválida (.env):\n${issues}`);
  }
  if (parsed.data.MIN_SECONDS_BETWEEN_DMS > parsed.data.MAX_SECONDS_BETWEEN_DMS) {
    throw new Error("MIN_SECONDS_BETWEEN_DMS não pode ser maior que MAX_SECONDS_BETWEEN_DMS");
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: reset the cached env so a fresh source can be parsed. */
export function resetEnvCache(): void {
  cached = null;
}
