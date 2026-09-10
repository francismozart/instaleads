/**
 * Pipeline and channel state machines. Internal values are English; the maps
 * below carry the PT-BR labels the UI renders. Pipeline and channel are two
 * independent dimensions on a lead.
 */

export type Funnel = "customer" | "affiliate";

export type CustomerPipelineState =
  | "discovered"
  | "qualified"
  | "contacted"
  | "replied"
  | "interested"
  | "whatsapp_handoff"
  | "registered"
  | "active_customer"
  | "closed";

export type AffiliatePipelineState =
  | "discovered"
  | "qualified"
  | "contacted"
  | "replied"
  | "interested"
  | "joined_affiliate_group"
  | "active_affiliate"
  | "generated_customer"
  | "closed";

export type PipelineState = CustomerPipelineState | AffiliatePipelineState;

export type ChannelState =
  | "browser_contact_pending"
  | "browser_contact_sent"
  | "waiting_inbound_reply"
  | "api_eligible"
  | "api_active"
  | "api_window_closed"
  | "human_review_required"
  | "do_not_contact"
  | "blocked"
  | "completed";

export type ChannelOwner = "browser" | "api" | "none";

export const CUSTOMER_PIPELINE: CustomerPipelineState[] = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "whatsapp_handoff",
  "registered",
  "active_customer",
  "closed",
];

export const AFFILIATE_PIPELINE: AffiliatePipelineState[] = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "joined_affiliate_group",
  "active_affiliate",
  "generated_customer",
  "closed",
];

export const CHANNEL_STATES: ChannelState[] = [
  "browser_contact_pending",
  "browser_contact_sent",
  "waiting_inbound_reply",
  "api_eligible",
  "api_active",
  "api_window_closed",
  "human_review_required",
  "do_not_contact",
  "blocked",
  "completed",
];

export const PIPELINE_LABELS_PT: Record<PipelineState, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  whatsapp_handoff: "Encaminhado ao WhatsApp",
  registered: "Cadastrado",
  active_customer: "Cliente ativo",
  joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente",
  closed: "Encerrado",
};

export const CHANNEL_LABELS_PT: Record<ChannelState, string> = {
  browser_contact_pending: "Contato pelo navegador pendente",
  browser_contact_sent: "Contato pelo navegador enviado",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "Elegível para API",
  api_active: "API ativa",
  api_window_closed: "Janela da API fechada",
  human_review_required: "Revisão humana necessária",
  do_not_contact: "Não contatar",
  blocked: "Bloqueado",
  completed: "Concluído",
};

// Forward-only pipeline transitions; any state may also move to "closed".
function buildForward<T extends string>(order: T[]): Record<T, T[]> {
  const map = {} as Record<T, T[]>;
  order.forEach((state, i) => {
    const next = order[i + 1];
    map[state] = next ? [next, order[order.length - 1]!] : [];
  });
  return map;
}

const CUSTOMER_TRANSITIONS = buildForward(CUSTOMER_PIPELINE);
const AFFILIATE_TRANSITIONS = buildForward(AFFILIATE_PIPELINE);

export function pipelineStatesFor(funnel: Funnel): PipelineState[] {
  return funnel === "customer" ? CUSTOMER_PIPELINE : AFFILIATE_PIPELINE;
}

export function canTransitionPipeline(
  funnel: Funnel,
  from: PipelineState,
  to: PipelineState,
): boolean {
  if (from === to) return false;
  const map = funnel === "customer" ? CUSTOMER_TRANSITIONS : AFFILIATE_TRANSITIONS;
  const allowed = (map as Record<string, string[]>)[from];
  return allowed ? allowed.includes(to) : false;
}

// Channel transitions. Safety targets (do_not_contact, blocked,
// human_review_required) are reachable from any non-terminal state.
const SAFETY_TARGETS: ChannelState[] = ["do_not_contact", "blocked", "human_review_required"];

const CHANNEL_TRANSITIONS: Record<ChannelState, ChannelState[]> = {
  browser_contact_pending: ["browser_contact_sent", "completed"],
  browser_contact_sent: ["waiting_inbound_reply"],
  waiting_inbound_reply: ["api_eligible", "api_active"],
  api_eligible: ["api_active", "api_window_closed"],
  api_active: ["api_window_closed", "completed"],
  api_window_closed: ["api_active", "completed"],
  human_review_required: [
    "browser_contact_sent",
    "waiting_inbound_reply",
    "api_active",
    "completed",
  ],
  do_not_contact: [], // permanent, terminal
  blocked: [], // reached only via safety target; recovered manually
  completed: [],
};

export function canTransitionChannel(from: ChannelState, to: ChannelState): boolean {
  if (from === to) return false;
  if (from === "do_not_contact") return false; // permanent
  if (SAFETY_TARGETS.includes(to)) return true; // opt-out / block / escalate anytime
  return CHANNEL_TRANSITIONS[from].includes(to);
}

export function initialChannelState(): ChannelState {
  return "browser_contact_pending";
}

export function initialPipelineState(): PipelineState {
  return "discovered";
}
