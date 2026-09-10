import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { fakeClock } from "@/test/fixtures";
import { backoffSeconds, claimNextJob, completeJob, enqueueJob, failJob, recoverStuckJobs } from "./queue";

describe("job queue", () => {
  it("is idempotent on the idempotency key", () => {
    const { db, close } = createTestDb();
    try {
      const a = enqueueJob(db, { type: "first_contact", payload: { leadId: "l1" }, idempotencyKey: "k1" }, fakeClock());
      const b = enqueueJob(db, { type: "first_contact", payload: { leadId: "l1" }, idempotencyKey: "k1" }, fakeClock());
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.job.id).toBe(a.job.id);
    } finally {
      close();
    }
  });

  it("claims a due job exactly once", () => {
    const { db, close } = createTestDb();
    try {
      enqueueJob(db, { type: "discover", payload: {} }, fakeClock());
      const first = claimNextJob(db, { workerId: "w1" });
      const second = claimNextJob(db, { workerId: "w2" });
      expect(first).not.toBeNull();
      expect(second).toBeNull(); // already running
    } finally {
      close();
    }
  });

  it("does not claim jobs scheduled in the future", () => {
    const { db, close } = createTestDb();
    try {
      const future = new Date(Date.now() + 60_000).toISOString();
      enqueueJob(db, { type: "follow_up", payload: {}, runAfter: future });
      expect(claimNextJob(db, { workerId: "w1", now: new Date() })).toBeNull();
    } finally {
      close();
    }
  });

  it("retries with backoff then dead-letters at max attempts", () => {
    const { db, close } = createTestDb();
    try {
      const clock = fakeClock("2026-01-05T12:00:00.000Z", 0);
      const { job } = enqueueJob(db, { type: "discover", payload: {}, maxAttempts: 3 }, clock);
      let j = failJob(db, job.id, "boom", { clock });
      expect(j?.status).toBe("pending");
      expect(j?.attempts).toBe(1);
      failJob(db, job.id, "boom", { clock });
      j = failJob(db, job.id, "boom", { clock });
      expect(j?.status).toBe("dead");
      expect(j?.attempts).toBe(3);
    } finally {
      close();
    }
  });

  it("exponential backoff grows and caps", () => {
    expect(backoffSeconds(1, 5)).toBe(5);
    expect(backoffSeconds(2, 5)).toBe(10);
    expect(backoffSeconds(3, 5)).toBe(20);
    expect(backoffSeconds(20, 5)).toBe(3600);
  });

  it("recovers jobs left running after a crash/restart", () => {
    const { db, close } = createTestDb();
    try {
      enqueueJob(db, { type: "discover", payload: {} });
      const claimed = claimNextJob(db, { workerId: "w1" });
      expect(claimed?.status).toBe("running");
      const recovered = recoverStuckJobs(db);
      expect(recovered).toBe(1);
      // now claimable again
      const again = claimNextJob(db, { workerId: "w2" });
      expect(again).not.toBeNull();
      completeJob(db, again!.id);
    } finally {
      close();
    }
  });
});
