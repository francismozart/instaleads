import { describe, expect, it } from "vitest";
import { canSendNow, effectiveDailyCap, warmupCapForDay } from "./pacing";
import { Mutex } from "./mutex";
import { FakeBrowserClient } from "./fake";

describe("warm-up + daily cap", () => {
  it("grows 5/day per week and is capped by the configured max", () => {
    expect(warmupCapForDay(0)).toBe(5);
    expect(warmupCapForDay(6)).toBe(5);
    expect(warmupCapForDay(7)).toBe(10);
    expect(warmupCapForDay(14)).toBe(15);
    expect(effectiveDailyCap(30, warmupCapForDay(0))).toBe(5);
    expect(effectiveDailyCap(30, warmupCapForDay(70))).toBe(30);
  });
});

describe("canSendNow", () => {
  const base = {
    operatingHours: "09:00-20:00",
    operatingTimezone: "UTC",
    configuredMaxPerDay: 30,
    daysSinceWarmupStart: 100,
    minSecondsBetween: 90,
  };

  it("blocks outside operating hours", () => {
    const d = canSendNow({ ...base, now: new Date("2026-01-05T03:00:00Z"), sentToday: 0, lastSentAt: null });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("outside_hours");
  });

  it("blocks when the daily cap is reached", () => {
    const d = canSendNow({ ...base, now: new Date("2026-01-05T12:00:00Z"), sentToday: 30, lastSentAt: null });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("daily_cap_reached");
  });

  it("blocks until the inter-DM interval elapses", () => {
    const now = new Date("2026-01-05T12:00:00Z");
    const d = canSendNow({ ...base, now, sentToday: 1, lastSentAt: new Date(now.getTime() - 30_000) });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("interval_not_elapsed");
  });

  it("allows when everything is satisfied", () => {
    const now = new Date("2026-01-05T12:00:00Z");
    const d = canSendNow({ ...base, now, sentToday: 1, lastSentAt: new Date(now.getTime() - 200_000) });
    expect(d.allowed).toBe(true);
  });
});

describe("Mutex", () => {
  it("serialises concurrent jobs", async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const job = (id: string) =>
      mutex.run(async () => {
        order.push(`start-${id}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end-${id}`);
      });
    await Promise.all([job("a"), job("b")]);
    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });
});

describe("FakeBrowserClient", () => {
  it("records sends and simulates unavailability + dry-run", async () => {
    const ok = new FakeBrowserClient({ mode: "success" });
    expect((await ok.sendInstagramDm({ handle: "@x", message: "oi" })).ok).toBe(true);
    expect(ok.sent).toHaveLength(1);

    const down = new FakeBrowserClient({ mode: "unavailable" });
    const r = await down.sendInstagramDm({ handle: "@x", message: "oi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("browser_unavailable");

    const dry = new FakeBrowserClient({ dryRun: true });
    const d = await dry.sendInstagramDm({ handle: "@x", message: "oi" });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("dry_run");
  });
});
