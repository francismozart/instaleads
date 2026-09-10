import { isWithinOperatingHours, randomInt } from "@/lib/time";

/**
 * Human-rhythm pacing — for account health, mirroring the discipline of a real
 * SDR, NOT to evade detection. Enforces the daily cap, the warm-up schedule,
 * the inter-DM interval, and the operating window.
 */

/** Warm-up cap: 5/day in week 1, +5 each subsequent week. */
export function warmupCapForDay(daysSinceStart: number, base = 5, increment = 5): number {
  const week = Math.floor(Math.max(0, daysSinceStart) / 7);
  return base + week * increment;
}

/** Effective daily cap is the smaller of the configured max and the warm-up cap. */
export function effectiveDailyCap(configuredMax: number, warmupCap: number): number {
  return Math.max(0, Math.min(configuredMax, warmupCap));
}

export interface PacingInput {
  now: Date;
  operatingHours: string;
  operatingTimezone: string;
  configuredMaxPerDay: number;
  daysSinceWarmupStart: number;
  sentToday: number;
  lastSentAt: Date | null;
  minSecondsBetween: number;
}

export type PacingDecision =
  | { allowed: true }
  | { allowed: false; reason: "outside_hours" | "daily_cap_reached" | "interval_not_elapsed"; retryAfterSeconds?: number };

/** Decide whether a DM may be sent right now under the pacing rules. */
export function canSendNow(input: PacingInput): PacingDecision {
  if (!isWithinOperatingHours(input.operatingHours, input.operatingTimezone, input.now)) {
    return { allowed: false, reason: "outside_hours" };
  }
  const cap = effectiveDailyCap(input.configuredMaxPerDay, warmupCapForDay(input.daysSinceWarmupStart));
  if (input.sentToday >= cap) {
    return { allowed: false, reason: "daily_cap_reached" };
  }
  if (input.lastSentAt) {
    const elapsed = (input.now.getTime() - input.lastSentAt.getTime()) / 1000;
    if (elapsed < input.minSecondsBetween) {
      return { allowed: false, reason: "interval_not_elapsed", retryAfterSeconds: Math.ceil(input.minSecondsBetween - elapsed) };
    }
  }
  return { allowed: true };
}

/** Random inter-DM delay in seconds. */
export function nextDelaySeconds(min: number, max: number, rng: () => number = Math.random): number {
  return randomInt(min, max, rng);
}

/** Per-character typing delay in ms (small, human-ish). */
export function typingDelayMs(rng: () => number = Math.random): number {
  return randomInt(40, 140, rng);
}

/** Days between two instants (UTC), floored. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
