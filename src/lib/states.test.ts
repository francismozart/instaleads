import { describe, expect, it } from "vitest";
import {
  canTransitionChannel,
  canTransitionPipeline,
  CHANNEL_LABELS_PT,
  CHANNEL_STATES,
  PIPELINE_LABELS_PT,
} from "./states";

describe("pipeline transitions", () => {
  it("allows forward steps for the customer funnel", () => {
    expect(canTransitionPipeline("customer", "discovered", "qualified")).toBe(true);
    expect(canTransitionPipeline("customer", "interested", "whatsapp_handoff")).toBe(true);
  });

  it("rejects skipping and backward steps", () => {
    expect(canTransitionPipeline("customer", "discovered", "interested")).toBe(false);
    expect(canTransitionPipeline("customer", "qualified", "discovered")).toBe(false);
  });

  it("allows closing from any stage", () => {
    expect(canTransitionPipeline("customer", "qualified", "closed")).toBe(true);
    expect(canTransitionPipeline("affiliate", "replied", "closed")).toBe(true);
  });

  it("uses the affiliate-specific ladder", () => {
    expect(canTransitionPipeline("affiliate", "interested", "joined_affiliate_group")).toBe(true);
    expect(canTransitionPipeline("affiliate", "interested", "whatsapp_handoff")).toBe(false);
  });
});

describe("channel transitions", () => {
  it("follows the browser → api handoff path", () => {
    expect(canTransitionChannel("browser_contact_pending", "browser_contact_sent")).toBe(true);
    expect(canTransitionChannel("browser_contact_sent", "waiting_inbound_reply")).toBe(true);
    expect(canTransitionChannel("waiting_inbound_reply", "api_active")).toBe(true);
  });

  it("lets opt-out and blocks happen from anywhere", () => {
    expect(canTransitionChannel("api_active", "do_not_contact")).toBe(true);
    expect(canTransitionChannel("browser_contact_pending", "blocked")).toBe(true);
    expect(canTransitionChannel("waiting_inbound_reply", "human_review_required")).toBe(true);
  });

  it("keeps do_not_contact permanent", () => {
    expect(canTransitionChannel("do_not_contact", "api_active")).toBe(false);
    expect(canTransitionChannel("do_not_contact", "browser_contact_pending")).toBe(false);
  });

  it("has a PT-BR label for every channel state", () => {
    for (const s of CHANNEL_STATES) {
      expect(CHANNEL_LABELS_PT[s]).toBeTruthy();
    }
  });

  it("has PT-BR labels for pipeline states", () => {
    expect(PIPELINE_LABELS_PT.active_customer).toBe("Cliente ativo");
    expect(PIPELINE_LABELS_PT.joined_affiliate_group).toBe("Entrou no grupo");
  });
});
