import OpenAI from "openai";
import type { Intent } from "@/features/conversations/policy";
import type {
  ClassifyInput,
  ClassifyResult,
  ComposeInput,
  ComposeResult,
  ConversationEngine,
  Usage,
} from "./types";

const INTENTS: Intent[] = [
  "interested",
  "asked_info",
  "asked_pricing",
  "wants_whatsapp",
  "not_the_owner",
  "will_forward",
  "objection",
  "not_interested",
  "opt_out",
  "ambiguous",
  "needs_human",
];

export interface OpenAiEngineConfig {
  apiKey: string;
  writeModel: string;
  fastModel: string;
}

function toUsage(model: string, usage: OpenAI.CompletionUsage | undefined): Usage {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  return { model, promptTokens, completionTokens, totalTokens: usage?.total_tokens ?? promptTokens + completionTokens };
}

function historyLines(history: { direction: "outbound" | "inbound"; body: string }[]): string {
  return history.map((h) => `${h.direction === "outbound" ? "NÓS" : "LEAD"}: ${h.body}`).join("\n");
}

/**
 * OpenAI-backed conversation engine. Exact model ids come from the environment
 * (no floating aliases in production). Classification/extraction use the fast
 * model; composition uses the writing model. Composition output is still passed
 * through the claims guard by the caller — the model is never trusted to police
 * itself on claims.
 */
export class OpenAiConversationEngine implements ConversationEngine {
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAiEngineConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const system =
      "Você classifica a intenção da última mensagem de um lead no Instagram. " +
      `Responda em JSON {"intent": <um de: ${INTENTS.join(", ")}>, "confidence": <0..1>}. ` +
      "Se o lead pedir para parar/sair, use opt_out. Se pedir preço, asked_pricing.";
    const user =
      `Lead @${input.lead.handle} (${input.lead.funnel}, ${input.lead.actorType}).\n` +
      `Histórico:\n${historyLines(input.history)}\n\nÚltima mensagem do lead:\n${input.latestInbound}`;

    const res = await this.client.chat.completions.create({
      model: this.config.fastModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const content = res.choices[0]?.message?.content ?? "{}";
    let intent: Intent = "ambiguous";
    let confidence = 0.5;
    try {
      const parsed = JSON.parse(content) as { intent?: string; confidence?: number };
      if (parsed.intent && (INTENTS as string[]).includes(parsed.intent)) intent = parsed.intent as Intent;
      if (typeof parsed.confidence === "number") confidence = parsed.confidence;
    } catch {
      intent = "needs_human";
    }

    return { intent, confidence, usage: toUsage(this.config.fastModel, res.usage) };
  }

  async compose(input: ComposeInput): Promise<ComposeResult> {
    const { config } = input;
    const system =
      "Você escreve mensagens curtas, pessoais e verdadeiras em PT-BR para o Instagram, " +
      `em nome de ${config.owner.name} (${config.company.name}). ` +
      "REGRA ABSOLUTA: só afirme o que está na lista de AFIRMAÇÕES VERIFICADAS. " +
      "Nunca invente taxa, condição, garantia, superlativo, relação societária. " +
      "Nunca prometa aprovação de conta nem resultado financeiro. Soe humano, não campanha.";
    const user =
      `AFIRMAÇÕES VERIFICADAS (únicas permitidas):\n- ${config.claims.verified.join("\n- ")}\n\n` +
      `Pitch: ${config.pitch.oneLine}\n` +
      `Lead: @${input.lead.handle}, tipo ${input.lead.actorType}, nicho ${input.lead.niche ?? "?"}.\n` +
      `Sinais do perfil: ${JSON.stringify(input.lead.profile).slice(0, 500)}\n` +
      `Histórico:\n${historyLines(input.history)}\n\n` +
      `Objetivo desta mensagem: ${input.objective}\n\n` +
      "Escreva apenas a mensagem, sem aspas, no máximo 3 frases.";

    const res = await this.client.chat.completions.create({
      model: this.config.writeModel,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const text = (res.choices[0]?.message?.content ?? "").trim();
    return { text, usage: toUsage(this.config.writeModel, res.usage) };
  }
}
