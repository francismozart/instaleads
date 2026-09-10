import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Business identity, offer, ICP and claims. This is the ONLY place real
 * business data lives (config/business.json, gitignored). Nothing is hardcoded
 * elsewhere — every module reads from the loaded BusinessConfig.
 */
export const businessConfigSchema = z.object({
  owner: z.object({ name: z.string().min(1), role: z.string().min(1) }),
  company: z.object({
    name: z.string().min(1),
    website: z.string().url(),
    instagramHandle: z.string().min(1),
  }),
  links: z.object({
    whatsapp: z.string().url(),
    affiliateGroup: z.string().url().nullable(),
  }),
  pitch: z.object({
    oneLine: z.string().min(1),
    howItWorks: z.array(z.string().min(1)).min(1),
    revenueModel: z.string().min(1),
  }),
  jargon: z.record(z.string(), z.string()),
  claims: z.object({
    verified: z.array(z.string().min(1)),
    unverified: z.array(z.string().min(1)),
  }),
  icp: z.object({
    segments: z.array(z.string().min(1)).min(1),
    keywords: z.array(z.string().min(1)).min(1),
    confirmed: z.boolean(),
  }),
  affiliates: z.object({
    programExists: z.boolean(),
    topics: z.array(z.string().min(1)),
  }),
  geography: z.object({
    country: z.string().min(1),
    timezone: z.string().min(1),
    utcOffset: z.string().min(1),
    notes: z.string(),
  }),
});

export type BusinessConfig = z.infer<typeof businessConfigSchema>;

let cached: BusinessConfig | null = null;

export function loadBusinessConfig(
  path = process.env.BUSINESS_CONFIG_PATH ?? "config/business.json",
): BusinessConfig {
  if (cached) return cached;
  const raw = readFileSync(resolve(path), "utf8");
  cached = parseBusinessConfig(JSON.parse(raw));
  return cached;
}

export function parseBusinessConfig(data: unknown): BusinessConfig {
  const parsed = businessConfigSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`config/business.json inválido:\n${issues}`);
  }
  return parsed.data;
}

export function resetBusinessConfigCache(): void {
  cached = null;
}
