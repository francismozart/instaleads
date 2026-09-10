import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { fakeClock, makeBusinessConfig, seededRng } from "@/test/fixtures";
import { discoverLead } from "@/features/leads/repository";
import {
  analyzeExperiment,
  assignVariant,
  createExperiment,
  hasSufficientSample,
  recordOutcome,
} from "./service";

const config = makeBusinessConfig();

function makeExp(db: ReturnType<typeof createTestDb>["db"]) {
  const res = createExperiment(
    db,
    {
      name: "opener-copy",
      variable: "opening_message",
      variants: [
        { key: "control", label: "Controle", isControl: true, weight: 1 },
        { key: "b", label: "Variante B", weight: 1 },
      ],
      explorationRate: 0.1,
    },
    fakeClock(),
  );
  if (!res.ok) throw new Error("exp setup");
  return res.value.experiment;
}

describe("experiments", () => {
  it("requires a control and at least two variants", () => {
    const { db, close } = createTestDb();
    try {
      const noControl = createExperiment(db, {
        name: "x",
        variable: "v",
        variants: [
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ],
      });
      expect(noControl.ok).toBe(false);
    } finally {
      close();
    }
  });

  it("assigns idempotently: a lead keeps its first variant", () => {
    const { db, close } = createTestDb();
    try {
      const exp = makeExp(db);
      const lead = discoverLead(db, { handle: "@a", funnel: "customer", signals: {} }, config, fakeClock());
      if (!lead.ok) throw new Error("lead");
      const first = assignVariant(db, exp.id, lead.value.id, seededRng(1), fakeClock());
      const again = assignVariant(db, exp.id, lead.value.id, seededRng(999), fakeClock());
      expect(first.ok && again.ok).toBe(true);
      if (first.ok && again.ok) expect(first.value.id).toBe(again.value.id);
    } finally {
      close();
    }
  });

  it("measures conversion per variant and gates winner declaration by sample size", () => {
    const { db, close } = createTestDb();
    try {
      const exp = makeExp(db);
      const rng = seededRng(42);
      const clock = fakeClock();
      for (let i = 0; i < 20; i++) {
        const lead = discoverLead(db, { handle: `@u${i}`, funnel: "customer", signals: {} }, config, clock);
        if (!lead.ok) continue;
        const v = assignVariant(db, exp.id, lead.value.id, rng, clock);
        if (v.ok && i % 2 === 0) recordOutcome(db, exp.id, lead.value.id, "reply", 1, clock);
      }
      const analysis = analyzeExperiment(db, exp.id);
      const totalAssigned = analysis.reduce((s, a) => s + a.assigned, 0);
      expect(totalAssigned).toBe(20);
      expect(hasSufficientSample(analysis, 30)).toBe(false);
      // conversion rates are populated where there were replies
      const withReplies = analysis.filter((a) => (a.outcomes.reply ?? 0) > 0);
      expect(withReplies.length).toBeGreaterThan(0);
    } finally {
      close();
    }
  });
});
