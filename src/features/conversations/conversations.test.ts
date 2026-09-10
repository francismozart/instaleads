import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { makeBusinessConfig, fakeClock } from "@/test/fixtures";
import { discoverLead, findLeadById, transitionChannel } from "@/features/leads/repository";
import { handoffToApi } from "./handoff";
import { decideAction } from "./policy";
import { markOutboundSent, recordInbound, reserveOutbound } from "./messages";

const config = makeBusinessConfig();

function seedLead(db: ReturnType<typeof createTestDb>["db"], handle = "@loja") {
  const res = discoverLead(
    db,
    { handle, funnel: "customer", signals: { bio: "CRM sob medida" } },
    config,
    fakeClock(),
  );
  if (!res.ok) throw new Error("seed failed");
  return res.value;
}

describe("reserveOutbound — dedupe + ownership + claims", () => {
  it("blocks a second send for the same logical phase", () => {
    const { db, close } = createTestDb();
    try {
      const lead = seedLead(db);
      const first = reserveOutbound(
        db,
        { leadId: lead.id, channel: "browser", body: "Oi, tudo bem?", phase: "opener" },
        config,
        fakeClock(),
      );
      expect(first.ok).toBe(true);
      const dup = reserveOutbound(
        db,
        { leadId: lead.id, channel: "browser", body: "Oi de novo", phase: "opener" },
        config,
        fakeClock(),
      );
      expect(dup.ok).toBe(false);
      if (!dup.ok) expect(dup.error.code).toBe("duplicate_send_blocked");
    } finally {
      close();
    }
  });

  it("refuses a send on the channel that does not own the conversation", () => {
    const { db, close } = createTestDb();
    try {
      const lead = seedLead(db); // owner = browser
      const viaApi = reserveOutbound(
        db,
        { leadId: lead.id, channel: "api", body: "oi", phase: "opener" },
        config,
        fakeClock(),
      );
      expect(viaApi.ok).toBe(false);
      if (!viaApi.ok) expect(viaApi.error.code).toBe("channel_ownership_conflict");
    } finally {
      close();
    }
  });

  it("blocks a body that violates the claims rule", () => {
    const { db, close } = createTestDb();
    try {
      const lead = seedLead(db);
      const res = reserveOutbound(
        db,
        { leadId: lead.id, channel: "browser", body: "Aprovação garantida da conta!", phase: "opener" },
        config,
        fakeClock(),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("claim_not_verified");
    } finally {
      close();
    }
  });
});

describe("inbound idempotency", () => {
  it("ignores a re-delivered Meta message id", () => {
    const { db, close } = createTestDb();
    try {
      const lead = seedLead(db);
      const a = recordInbound(db, { leadId: lead.id, body: "oi", externalId: "mid.1" }, fakeClock());
      expect(a.ok).toBe(true);
      const b = recordInbound(db, { leadId: lead.id, body: "oi", externalId: "mid.1" }, fakeClock());
      expect(b.ok).toBe(false);
      if (!b.ok) expect(b.error.code).toBe("webhook_duplicate");
    } finally {
      close();
    }
  });
});

describe("handoff browser → API and the double-send guarantee", () => {
  it("transfers ownership to API on first reply and locks out the browser", () => {
    const { db, close } = createTestDb();
    try {
      const lead = seedLead(db, "@corretor");
      // simulate the browser first contact having been sent
      const opener = reserveOutbound(
        db,
        { leadId: lead.id, channel: "browser", body: "Oi! Vi seu perfil de corretor.", phase: "opener" },
        config,
        fakeClock(),
      );
      expect(opener.ok).toBe(true);
      transitionChannel(db, lead.id, "browser_contact_sent", {}, fakeClock());
      transitionChannel(db, lead.id, "waiting_inbound_reply", {}, fakeClock());
      if (opener.ok) markOutboundSent(db, opener.value.id, {}, fakeClock());

      // inbound reply arrives via webhook → handoff
      const handoff = handoffToApi(
        db,
        { metaUserId: "IGSID_123", username: "@corretor", body: "Oi, me conta mais", externalId: "mid.reply.1" },
        fakeClock(),
      );
      expect(handoff.ok).toBe(true);
      const after = findLeadById(db, lead.id)!;
      expect(after.channelOwner).toBe("api");
      expect(after.channelState).toBe("api_active");
      expect(after.pipelineState).toBe("replied");
      expect(after.metaUserId).toBe("IGSID_123");

      // the browser must NOT be able to send on this thread anymore
      const browserAgain = reserveOutbound(
        db,
        { leadId: lead.id, channel: "browser", body: "mais uma", phase: "opener-2" },
        config,
        fakeClock(),
      );
      expect(browserAgain.ok).toBe(false);
      if (!browserAgain.ok) expect(browserAgain.error.code).toBe("channel_ownership_conflict");

      // the API now owns it and can send
      const apiSend = reserveOutbound(
        db,
        { leadId: lead.id, channel: "api", body: "Claro! Trabalho com CRM sob medida.", phase: "turn-1" },
        config,
        fakeClock(),
      );
      expect(apiSend.ok).toBe(true);
    } finally {
      close();
    }
  });

  it("is idempotent when the same reply webhook is redelivered", () => {
    const { db, close } = createTestDb();
    try {
      const lead = seedLead(db, "@studio");
      transitionChannel(db, lead.id, "browser_contact_sent", {}, fakeClock());
      transitionChannel(db, lead.id, "waiting_inbound_reply", {}, fakeClock());
      const env = { metaUserId: "IG_9", username: "@studio", body: "oi", externalId: "mid.same" };
      const first = handoffToApi(db, env, fakeClock());
      const second = handoffToApi(db, env, fakeClock());
      expect(first.ok && second.ok).toBe(true);
    } finally {
      close();
    }
  });
});

describe("policy decisions", () => {
  it("routes an interested customer to WhatsApp and an affiliate to the group", () => {
    expect(decideAction("interested", "customer").action).toBe("forward_whatsapp");
    expect(decideAction("interested", "affiliate").action).toBe("forward_affiliate_group");
  });

  it("honours opt-out and escalates ambiguity after one clarification", () => {
    expect(decideAction("opt_out", "customer").optOut).toBe(true);
    expect(decideAction("ambiguous", "customer", 0).action).toBe("ask");
    expect(decideAction("ambiguous", "customer", 1).action).toBe("escalate_human");
  });
});
