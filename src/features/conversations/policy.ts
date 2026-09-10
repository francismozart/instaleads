import type { Funnel, PipelineState } from "@/lib/states";

/**
 * Deterministic conversation policy. The OpenAI engine classifies the inbound
 * message into an Intent; this pure function maps (intent, funnel) to the next
 * Action and any state targets. Keeping it model-independent makes the core
 * decision logic testable and auditable.
 */
export type Intent =
  | "interested"
  | "asked_info"
  | "asked_pricing"
  | "wants_whatsapp"
  | "not_the_owner"
  | "will_forward"
  | "objection"
  | "not_interested"
  | "opt_out"
  | "ambiguous"
  | "needs_human";

export type Action =
  | "reply"
  | "ask"
  | "present"
  | "handle_objection"
  | "forward_whatsapp"
  | "forward_affiliate_group"
  | "wait"
  | "schedule_followup"
  | "close"
  | "escalate_human";

export interface Decision {
  action: Action;
  pipelineTarget?: PipelineState;
  optOut?: boolean;
  escalate?: boolean;
  followupHours?: number;
  note: string;
}

export function decideAction(intent: Intent, funnel: Funnel, ambiguousRetries = 0): Decision {
  switch (intent) {
    case "opt_out":
      return { action: "close", optOut: true, note: "Pedido de parar atendido; entra em não contatar." };

    case "needs_human":
      return { action: "escalate_human", escalate: true, note: "Requer avaliação humana." };

    case "ambiguous":
      // Give the model one clarifying turn; escalate if it stays ambiguous.
      return ambiguousRetries >= 1
        ? { action: "escalate_human", escalate: true, note: "Ambíguo após esclarecimento." }
        : { action: "ask", note: "Mensagem ambígua; pedir esclarecimento." };

    case "wants_whatsapp":
    case "interested":
      return funnel === "customer"
        ? {
            action: "forward_whatsapp",
            pipelineTarget: "whatsapp_handoff",
            note: "Interessado; encaminhar ao WhatsApp.",
          }
        : {
            action: "forward_affiliate_group",
            pipelineTarget: "joined_affiliate_group",
            note: "Interessado; encaminhar ao grupo de afiliados.",
          };

    case "asked_pricing":
      return {
        action: "reply",
        pipelineTarget: "interested",
        note: "Explicar modelo (consultoria/serviço sob medida) sem inventar preço.",
      };

    case "asked_info":
      return { action: "present", pipelineTarget: "interested", note: "Apresentar oferta e empresa." };

    case "objection":
      return { action: "handle_objection", note: "Tratar objeção com informação verdadeira." };

    case "not_the_owner":
      return { action: "ask", note: "Pedir contato do decisor; não insistir." };

    case "will_forward":
      return { action: "schedule_followup", followupHours: 48, note: "Aguardar repasse; follow-up em 48h." };

    case "not_interested":
      return { action: "close", pipelineTarget: "closed", note: "Sem interesse; encerrar (sem DNC)." };

    default: {
      const _exhaustive: never = intent;
      return { action: "wait", note: `Intenção não tratada: ${String(_exhaustive)}` };
    }
  }
}
