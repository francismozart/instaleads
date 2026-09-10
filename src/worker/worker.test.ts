import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { fakeClock, makeBusinessConfig } from "@/test/fixtures";
import { makeWorkerContext } from "@/test/worker-context";
import { FakeBrowserClient } from "@/integrations/browser/fake";
import { discoverLead, findLeadById, walkPipelineTo } from "@/features/leads/repository";
import { listMessages } from "@/features/conversations/messages";
import { handoffToApi } from "@/features/conversations/handoff";
import { isPaused } from "@/features/system/state";
import { listOpenExceptions } from "@/features/system/exceptions";
import { recordFailure } from "./circuit-breaker";
import { enqueueJob } from "./queue";
import { runOnce } from "./runner";

const config = makeBusinessConfig();

function seed(db: ReturnType<typeof createTestDb>["db"], handle = "@corretor.top") {
  const r = discoverLead(
    db,
    { handle, funnel: "customer", signals: { bio: "Imobiliária. CRM sob medida e atendimento IA WhatsApp." } },
    config,
    fakeClock(),
  );
  if (!r.ok) throw new Error("seed");
  walkPipelineTo(db, r.value.id, "qualified", fakeClock());
  return r.value;
}

describe("first_contact via browser", () => {
  it("sends the opener, advances states, and paces the counter", async () => {
    const { db, close } = createTestDb();
    try {
      const { ctx, browser } = makeWorkerContext(db);
      const lead = seed(db);
      enqueueJob(db, { type: "first_contact", payload: { leadId: lead.id } }, ctx.clock);
      const res = await runOnce(ctx);
      expect(res.outcome).toBe("done");
      expect(browser.sent).toHaveLength(1);
      const after = findLeadById(db, lead.id)!;
      expect(after.channelState).toBe("waiting_inbound_reply");
      expect(after.pipelineState).toBe("contacted");
      const sent = listMessages(db, lead.id).filter((m) => m.channel === "browser" && m.status === "sent");
      expect(sent).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("pauses the system when the browser is unavailable and captures an exception", async () => {
    const { db, close } = createTestDb();
    try {
      const { ctx } = makeWorkerContext(db, { browser: new FakeBrowserClient({ mode: "unavailable" }) });
      const lead = seed(db);
      enqueueJob(db, { type: "first_contact", payload: { leadId: lead.id } }, ctx.clock);
      const res = await runOnce(ctx);
      expect(res.outcome).toContain("pause");
      expect(isPaused(db)).toBe(true);
      expect(listOpenExceptions(db).some((e) => e.kind === "browser_unavailable")).toBe(true);
      // no queued message left behind (so a retry can re-reserve)
      expect(listMessages(db, lead.id)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("pauses when the OpenAI monthly budget is exhausted", async () => {
    const { db, close } = createTestDb();
    try {
      const { ctx } = makeWorkerContext(db, { budgetUsd: 0 });
      const lead = seed(db);
      enqueueJob(db, { type: "first_contact", payload: { leadId: lead.id } }, ctx.clock);
      const res = await runOnce(ctx);
      expect(res.outcome).toContain("pause");
      expect(isPaused(db)).toBe(true);
    } finally {
      close();
    }
  });
});

describe("circuit breaker", () => {
  it("opens and pauses after repeated failures", () => {
    const { db, close } = createTestDb();
    try {
      const clock = fakeClock("2026-01-05T12:00:00.000Z", 0);
      let open = false;
      for (let i = 0; i < 5; i++) open = recordFailure(db, "boom", { threshold: 5, windowSeconds: 300 }, clock).open;
      expect(open).toBe(true);
      expect(isPaused(db)).toBe(true);
    } finally {
      close();
    }
  });
});

describe("full loop: browser → handoff → API → WhatsApp", () => {
  it("continues on the API after a reply and forwards an interested customer", async () => {
    const { db, close } = createTestDb();
    try {
      const clock = fakeClock();
      const { ctx, browser, instagram } = makeWorkerContext(db, { clock });
      const lead = seed(db, "@studio.reforma");

      // 1) browser first contact
      enqueueJob(db, { type: "first_contact", payload: { leadId: lead.id } }, clock);
      await runOnce(ctx);
      expect(browser.sent).toHaveLength(1);

      // 2) inbound reply arrives → webhook handoff to API
      const handoff = handoffToApi(
        db,
        { metaUserId: "IG_777", username: "@studio.reforma", body: "quero saber mais, me manda no whats", externalId: "mid.r1" },
        clock,
      );
      expect(handoff.ok).toBe(true);

      // 3) worker processes the API reply
      enqueueJob(db, { type: "api_reply", payload: { leadId: lead.id } }, clock);
      const res = await runOnce(ctx);
      expect(res.outcome).toBe("done");
      expect(instagram.sent.length).toBeGreaterThanOrEqual(1);
      const after = findLeadById(db, lead.id)!;
      expect(after.pipelineState).toBe("whatsapp_handoff");
      expect(after.channelOwner).toBe("api");
    } finally {
      close();
    }
  });
});
