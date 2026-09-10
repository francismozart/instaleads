import { describe, expect, it } from "vitest";
import { createTestDb } from "./testing";
import { leads } from "./schema";
import { newId, normalizeHandle } from "@/lib/ids";
import { nowIso } from "@/lib/time";

describe("database harness", () => {
  it("applies migrations and enforces the unique handle constraint", () => {
    const { db, close } = createTestDb();
    try {
      const base = {
        displayHandle: "@Loja_Teste",
        funnel: "customer" as const,
        pipelineState: "discovered",
        channelState: "browser_contact_pending",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.insert(leads)
        .values({ id: newId("lead"), handle: normalizeHandle("@Loja_Teste"), ...base })
        .run();

      expect(() =>
        db
          .insert(leads)
          .values({ id: newId("lead"), handle: normalizeHandle("loja_teste"), ...base })
          .run(),
      ).toThrow(/UNIQUE/i);

      const rows = db.select().from(leads).all();
      expect(rows).toHaveLength(1);
    } finally {
      close();
    }
  });
});
