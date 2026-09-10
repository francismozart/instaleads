import type { BusinessConfig } from "./config";

/**
 * Claims guard — the hard rule of the system.
 *
 * The AI may ONLY send what is in VERIFIED_CLAIMS. Everything in
 * UNVERIFIED_CLAIMS is blocked until proven. The AI never invents rates,
 * conditions, guarantees, equity relationships, or superlatives; never promises
 * account approval or financial results.
 *
 * This gate runs on EVERY outbound message body, on every channel, before it
 * leaves the system.
 */
export type ClaimViolation =
  | { kind: "unverified_claim"; matched: string }
  | { kind: "forbidden_pattern"; category: string; matched: string };

export interface ClaimCheckResult {
  allowed: boolean;
  violations: ClaimViolation[];
}

// Patterns for fabricated numbers, guarantees, superlatives and financial /
// approval promises. Deliberately conservative: false positives are cheaper
// than sending a claim we cannot back.
const FORBIDDEN: { category: string; re: RegExp }[] = [
  { category: "guarantee", re: /\bgarant(?:o|ia|ido|imos|e|ir)\b/i },
  { category: "guarantee", re: /\b100%\b/i },
  {
    category: "financial_promise",
    re: /\b(?:lucro|retorno|roi|faturamento|ganho)\s+(?:de\s+)?(?:garantid|assegur|cert)/i,
  },
  {
    category: "financial_promise",
    re: /\br\$\s?\d/i,
  },
  {
    category: "account_approval_promise",
    re: /\b(?:aprova(?:ção|do|remos|mos)|libera(?:ção|do)|conta\s+aprovada)\b/i,
  },
  {
    category: "superlative",
    re: /\b(?:melhor|maior|nº?\s?1|numero\s+um|líder\s+de\s+mercado|imbatível|o\s+único)\b/i,
  },
  {
    category: "fabricated_rate",
    re: /\b\d{1,3}\s?%/i,
  },
  {
    category: "fabricated_metric",
    re: /\b(?:mais\s+de\s+)?\d{2,}\s*(?:clientes|empresas|projetos)\s+(?:atendidos|satisfeitos)/i,
  },
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function checkClaims(text: string, config: BusinessConfig): ClaimCheckResult {
  const violations: ClaimViolation[] = [];
  const norm = normalize(text);

  for (const claim of config.claims.unverified) {
    if (norm.includes(normalize(claim))) {
      violations.push({ kind: "unverified_claim", matched: claim });
    }
  }

  for (const { category, re } of FORBIDDEN) {
    const m = re.exec(text);
    if (m) {
      // A forbidden pattern is allowed only if it is a verbatim slice of a
      // verified claim (e.g. "15+ anos" contains digits but is verified).
      const withinVerified = config.claims.verified.some((c) =>
        normalize(c).includes(normalize(m[0])),
      );
      if (!withinVerified) {
        violations.push({ kind: "forbidden_pattern", category, matched: m[0] });
      }
    }
  }

  return { allowed: violations.length === 0, violations };
}

/** Convenience boolean form. */
export function isMessageAllowed(text: string, config: BusinessConfig): boolean {
  return checkClaims(text, config).allowed;
}
