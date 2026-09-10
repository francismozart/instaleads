import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { fakeClock, makeBusinessConfig } from "@/test/fixtures";
import { assertWithinBudget, costSummary, monthlySpendUsd, recordAiCall } from "./accounting";
import { estimateCostUsd } from "./pricing";
import { FakeConversationEngine } from "./fake";
import { classifyGuarded, composeGuarded } from "./runner";

describe("pricing + accounting", () => {
  it("estimates cost and sums monthly spend", () => {
    const { db, close } = createTestDb();
    try {
      const clock = fakeClock("2026-03-10T00:00:00.000Z", 0);
      const cost = recordAiCall(
        db,
        { purpose: "compose", usage: { model: "gpt-4.1", promptTokens: 1000, completionTokens: 500, totalTokens: 1500 } },
        clock,
      );
      expect(cost).toBeCloseTo(estimateCostUsd("gpt-4.1", 1000, 500), 6);
      expect(monthlySpendUsd(db, clock)).toBeCloseTo(cost, 6);
      expect(costSummary(db, clock).calls).toBe(1);
    } finally {
      close();
    }
  });

  it("blocks calls once the monthly budget is reached", () => {
    const { db, close } = createTestDb();
    try {
      const clock = fakeClock("2026-03-10T00:00:00.000Z", 0);
      recordAiCall(
        db,
        { purpose: "compose", usage: { model: "gpt-4.1", promptTokens: 5_000_000, completionTokens: 0, totalTokens: 5_000_000 } },
        clock,
      );
      const res = assertWithinBudget(db, 5, clock); // 5M input tokens @ $2/M = $10 > $5
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("budget_exceeded");
    } finally {
      close();
    }
  });
});

describe("guarded engine runner", () => {
  const config = makeBusinessConfig();
  const engine = new FakeConversationEngine({ fastModel: "gpt-4.1-mini", writeModel: "gpt-4.1" });

  it("classifies within budget and logs the call", async () => {
    const { db, close } = createTestDb();
    try {
      const r = await classifyGuarded(
        db,
        engine,
        {
          lead: { handle: "loja", funnel: "customer", actorType: "owner", profile: {} },
          history: [],
          latestInbound: "quero saber o preço",
        },
        { budgetUsd: 50, clock: fakeClock() },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.intent).toBe("asked_pricing");
      expect(costSummary(db).calls).toBe(1);
    } finally {
      close();
    }
  });

  it("composes a claims-safe message", async () => {
    const { db, close } = createTestDb();
    try {
      const r = await composeGuarded(
        db,
        engine,
        {
          lead: { handle: "loja", funnel: "customer", actorType: "owner", niche: "imobiliária", profile: {} },
          history: [],
          objective: "Apresentar a empresa.",
          config,
        },
        { budgetUsd: 50, clock: fakeClock() },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.text.length).toBeGreaterThan(10);
    } finally {
      close();
    }
  });
});
