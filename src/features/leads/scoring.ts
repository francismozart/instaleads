import type { BusinessConfig } from "@/lib/config";

/**
 * ICP fit scoring from PUBLIC profile signals only. Pure and deterministic so
 * it can be unit-tested and tuned as an experiment variable. Produces a 0..1
 * score, an inferred actor type, and a decision-maker flag.
 */
export type ActorType = "store" | "employee" | "owner" | "decision_maker" | "unknown";

export interface ProfileSignals {
  fullName?: string;
  bio?: string;
  category?: string;
  hashtags?: string[];
  recentCaptions?: string[];
  location?: string;
  followerCount?: number;
}

export interface ScoreResult {
  score: number; // 0..1
  actorType: ActorType;
  isDecisionMaker: boolean;
  matchedKeywords: string[];
  matchedSegments: string[];
}

const DECISION_MAKER_TERMS = [
  "ceo",
  "fundador",
  "fundadora",
  "founder",
  "dono",
  "dona",
  "proprietário",
  "proprietaria",
  "proprietária",
  "diretor",
  "diretora",
  "sócio",
  "socia",
  "sócia",
  "gestor",
  "gestora",
];

const STORE_TERMS = ["loja", "store", "atacado", "varejo", "showroom", "imobiliária", "imobiliaria"];
const EMPLOYEE_TERMS = ["atendimento", "vendas", "sac", "consultor de vendas", "corretor", "corretora"];

function norm(text: string | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function haystack(signals: ProfileSignals): string {
  return norm(
    [
      signals.fullName,
      signals.bio,
      signals.category,
      signals.location,
      ...(signals.hashtags ?? []),
      ...(signals.recentCaptions ?? []),
    ]
      .filter(Boolean)
      .join(" \n "),
  );
}

function detectActor(text: string): { actorType: ActorType; isDecisionMaker: boolean } {
  const has = (terms: string[]) => terms.some((t) => text.includes(norm(t)));
  if (has(DECISION_MAKER_TERMS)) return { actorType: "decision_maker", isDecisionMaker: true };
  if (has(STORE_TERMS)) return { actorType: "store", isDecisionMaker: false };
  if (has(EMPLOYEE_TERMS)) return { actorType: "employee", isDecisionMaker: false };
  return { actorType: "unknown", isDecisionMaker: false };
}

export function scoreLead(signals: ProfileSignals, config: BusinessConfig): ScoreResult {
  const text = haystack(signals);

  const matchedKeywords = config.icp.keywords.filter((kw) => {
    // Match on any significant token of the keyword phrase.
    const tokens = norm(kw)
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    return tokens.length > 0 && tokens.every((tok) => text.includes(tok));
  });

  const matchedSegments = config.icp.segments.filter((seg) => {
    const tokens = norm(seg)
      .split(/[\s/]+/)
      .filter((t) => t.length >= 4);
    return tokens.some((tok) => text.includes(tok));
  });

  const { actorType, isDecisionMaker } = detectActor(text);

  // Weighted score: keyword coverage dominates, segment + actor add lift.
  const keywordScore =
    config.icp.keywords.length === 0
      ? 0
      : matchedKeywords.length / config.icp.keywords.length;
  const segmentBonus = matchedSegments.length > 0 ? 0.2 : 0;
  const actorBonus = isDecisionMaker ? 0.2 : actorType !== "unknown" ? 0.1 : 0;

  const score = Math.min(1, keywordScore * 0.6 + segmentBonus + actorBonus);

  return { score, actorType, isDecisionMaker, matchedKeywords, matchedSegments };
}

/** Priority bucket derived from score (higher is sooner). */
export function priorityForScore(score: number): number {
  if (score >= 0.66) return 3;
  if (score >= 0.4) return 2;
  if (score > 0) return 1;
  return 0;
}
