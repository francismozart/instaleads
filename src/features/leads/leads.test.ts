import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { makeBusinessConfig, fakeClock } from "@/test/fixtures";
import { scoreLead } from "./scoring";
import {
  addToDoNotContact,
  discoverLead,
  findLeadByHandle,
  optOutLead,
  transitionChannel,
  transitionPipeline,
} from "./repository";

const config = makeBusinessConfig();

describe("scoreLead", () => {
  it("scores an on-ICP real-estate owner highly and flags decision maker", () => {
    const r = scoreLead(
      {
        fullName: "Ana — Fundadora",
        bio: "Imobiliária. CRM sob medida e atendimento IA WhatsApp para corretores.",
        category: "Imobiliária",
        hashtags: ["#imoveis", "#crm"],
      },
      config,
    );
    expect(r.score).toBeGreaterThan(0.4);
    expect(r.isDecisionMaker).toBe(true);
    expect(r.actorType).toBe("decision_maker");
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("scores an off-ICP profile low", () => {
    const r = scoreLead({ fullName: "Fã de futebol", bio: "Só posto memes" }, config);
    expect(r.score).toBeLessThan(0.2);
  });
});

describe("discoverLead — dedupe & do-not-contact", () => {
  it("creates a lead with initial pipeline/channel states", () => {
    const { db, close } = createTestDb();
    try {
      const res = discoverLead(
        db,
        { handle: "@Loja.Boa", funnel: "customer", source: "keyword", signals: { bio: "CRM sob medida" } },
        config,
        fakeClock(),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.pipelineState).toBe("discovered");
        expect(res.value.channelState).toBe("browser_contact_pending");
        expect(res.value.channelOwner).toBe("browser");
        expect(res.value.handle).toBe("loja.boa");
      }
    } finally {
      close();
    }
  });

  it("rejects duplicate handles (normalized)", () => {
    const { db, close } = createTestDb();
    try {
      discoverLead(db, { handle: "@dup", funnel: "customer", signals: {} }, config, fakeClock());
      const again = discoverLead(db, { handle: "DUP", funnel: "customer", signals: {} }, config, fakeClock());
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("duplicate_lead");
    } finally {
      close();
    }
  });

  it("refuses discovery of a do-not-contact handle", () => {
    const { db, close } = createTestDb();
    try {
      addToDoNotContact(db, "@blocked", "opt_out", "test");
      const res = discoverLead(db, { handle: "@blocked", funnel: "customer", signals: {} }, config, fakeClock());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("on_do_not_contact_list");
    } finally {
      close();
    }
  });
});

describe("transitions", () => {
  it("enforces pipeline order", () => {
    const { db, close } = createTestDb();
    try {
      const lead = discoverLead(db, { handle: "@x", funnel: "customer", signals: {} }, config, fakeClock());
      if (!lead.ok) throw new Error("setup");
      const bad = transitionPipeline(db, lead.value.id, "interested", fakeClock());
      expect(bad.ok).toBe(false);
      const good = transitionPipeline(db, lead.value.id, "qualified", fakeClock());
      expect(good.ok).toBe(true);
    } finally {
      close();
    }
  });

  it("rejects invalid channel transitions but always allows opt-out", () => {
    const { db, close } = createTestDb();
    try {
      const lead = discoverLead(db, { handle: "@y", funnel: "customer", signals: {} }, config, fakeClock());
      if (!lead.ok) throw new Error("setup");
      const bad = transitionChannel(db, lead.value.id, "api_active", {}, fakeClock());
      expect(bad.ok).toBe(false);
      const dnc = transitionChannel(db, lead.value.id, "do_not_contact", {}, fakeClock());
      expect(dnc.ok).toBe(true);
    } finally {
      close();
    }
  });
});

describe("optOutLead", () => {
  it("adds to DNC, closes pipeline, and blocks re-discovery", () => {
    const { db, close } = createTestDb();
    try {
      const lead = discoverLead(db, { handle: "@stop", funnel: "customer", signals: {} }, config, fakeClock());
      if (!lead.ok) throw new Error("setup");
      const out = optOutLead(db, lead.value.id, "conversation", fakeClock());
      expect(out.ok).toBe(true);
      const fresh = findLeadByHandle(db, "@stop");
      expect(fresh?.channelState).toBe("do_not_contact");
      expect(fresh?.pipelineState).toBe("closed");
      // permanent: cannot be re-discovered
      const redo = discoverLead(db, { handle: "@stop", funnel: "affiliate", signals: {} }, config, fakeClock());
      expect(redo.ok).toBe(false);
    } finally {
      close();
    }
  });
});
