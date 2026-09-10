import type {
  ClassifyInput,
  ClassifyResult,
  ComposeInput,
  ComposeResult,
  ConversationEngine,
  Usage,
} from "./types";
import type { Intent } from "@/features/conversations/policy";

/**
 * Deterministic, offline conversation engine. Used by unit tests and the
 * end-to-end simulation so the whole pipeline runs without network or spend.
 * Its classification is keyword-based; its composition draws ONLY on verified
 * claims, so it passes the claims guard by construction.
 */
export interface FakeEngineModels {
  fastModel: string;
  writeModel: string;
}

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const RULES: { intent: Intent; patterns: string[] }[] = [
  { intent: "opt_out", patterns: ["parar", "pare", "remover", "nao quero mais", "sai", "descadastr", "para de"] },
  { intent: "wants_whatsapp", patterns: ["whats", "zap", "whatsapp", "me chama"] },
  { intent: "asked_pricing", patterns: ["preco", "quanto", "valor", "custa", "orcamento"] },
  { intent: "not_the_owner", patterns: ["nao sou o dono", "nao sou responsavel", "falar com o dono", "sou funcionario"] },
  { intent: "will_forward", patterns: ["vou passar", "encaminho", "repasso", "mando pro dono"] },
  { intent: "objection", patterns: ["caro", "nao tenho tempo", "ja tenho", "nao preciso agora", "depois eu vejo"] },
  { intent: "not_interested", patterns: ["nao tenho interesse", "nao obrigado", "nao quero"] },
  { intent: "interested", patterns: ["quero", "interess", "vamos", "gostei", "manda", "bora"] },
  { intent: "asked_info", patterns: ["como funciona", "o que voce faz", "me explica", "detalhe", "?"] },
];

function usageFor(model: string, prompt: string, completion: string): Usage {
  const promptTokens = Math.max(1, Math.ceil(prompt.length / 4));
  const completionTokens = Math.max(1, Math.ceil(completion.length / 4));
  return { model, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export class FakeConversationEngine implements ConversationEngine {
  constructor(private readonly models: FakeEngineModels) {}

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const text = norm(input.latestInbound);
    let intent: Intent = "ambiguous";
    let confidence = 0.4;
    for (const rule of RULES) {
      if (rule.patterns.some((p) => text.includes(norm(p)))) {
        intent = rule.intent;
        confidence = 0.9;
        break;
      }
    }
    const promptText = JSON.stringify(input);
    return {
      intent,
      confidence,
      usage: usageFor(this.models.fastModel, promptText, intent),
    };
  }

  async compose(input: ComposeInput): Promise<ComposeResult> {
    const { lead, config, objective } = input;
    const firstName = (lead.fullName ?? lead.handle).split(/\s|—|-/)[0];
    const claim = config.claims.verified[0] ?? "";
    // Truthful, short, personal — built from verified claims only.
    const text =
      `Oi, ${firstName}! ${config.pitch.oneLine} ` +
      `Trabalho com ${config.icp.keywords[1] ?? "sistemas sob medida"} e ${claim}. ` +
      `${objective}`;
    return {
      text: text.slice(0, 500),
      usage: usageFor(this.models.writeModel, JSON.stringify(input), text),
    };
  }
}
