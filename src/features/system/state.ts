import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { systemState } from "@/db/schema";
import { nowIso } from "@/lib/time";

/**
 * Typed access to the system_state key/value table: the global pause switch,
 * circuit-breaker state, and the warm-up anchor date. Everything the operator
 * can flip lives here so the worker and the panel share one source of truth.
 */
export const SYSTEM_KEYS = {
  paused: "paused",
  pauseReason: "pause_reason",
  circuitBreaker: "circuit_breaker",
  warmupStart: "warmup_start_date",
  limitOverrides: "limit_overrides",
} as const;

function get<T>(db: Db, key: string): T | undefined {
  const row = db.select().from(systemState).where(eq(systemState.key, key)).get();
  return row ? (row.value as T) : undefined;
}

function set(db: Db, key: string, value: unknown, clock: () => Date = () => new Date()): void {
  db.insert(systemState)
    .values({ key, value, updatedAt: nowIso(clock) })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: nowIso(clock) } })
    .run();
}

export interface PauseState {
  paused: boolean;
  reason: string | null;
}

export function getPauseState(db: Db): PauseState {
  return {
    paused: get<boolean>(db, SYSTEM_KEYS.paused) ?? false,
    reason: get<string>(db, SYSTEM_KEYS.pauseReason) ?? null,
  };
}

export function pauseSystem(db: Db, reason: string, clock?: () => Date): void {
  set(db, SYSTEM_KEYS.paused, true, clock);
  set(db, SYSTEM_KEYS.pauseReason, reason, clock);
}

export function resumeSystem(db: Db, clock?: () => Date): void {
  set(db, SYSTEM_KEYS.paused, false, clock);
  set(db, SYSTEM_KEYS.pauseReason, null, clock);
}

export function isPaused(db: Db): boolean {
  return getPauseState(db).paused;
}

// ── circuit breaker ───────────────────────────────────────────────────────────
export interface CircuitBreakerState {
  open: boolean;
  failures: number;
  windowStart: string; // ISO
  openedReason?: string;
}

export function getCircuitBreaker(db: Db): CircuitBreakerState {
  return (
    get<CircuitBreakerState>(db, SYSTEM_KEYS.circuitBreaker) ?? {
      open: false,
      failures: 0,
      windowStart: nowIso(),
    }
  );
}

export function setCircuitBreaker(db: Db, state: CircuitBreakerState, clock?: () => Date): void {
  set(db, SYSTEM_KEYS.circuitBreaker, state, clock);
}

// ── warm-up anchor ──────────────────────────────────────────────────────────
export function getWarmupStart(db: Db): string | undefined {
  return get<string>(db, SYSTEM_KEYS.warmupStart);
}

export function ensureWarmupStart(db: Db, clock: () => Date = () => new Date()): string {
  const existing = getWarmupStart(db);
  if (existing) return existing;
  const iso = nowIso(clock);
  set(db, SYSTEM_KEYS.warmupStart, iso, clock);
  return iso;
}

// ── operator limit overrides (panel-editable) ─────────────────────────────────
export interface LimitOverrides {
  maxDmsPerDay?: number;
  minSecondsBetweenDms?: number;
  maxSecondsBetweenDms?: number;
  operatingHours?: string;
}

export function getLimitOverrides(db: Db): LimitOverrides {
  return get<LimitOverrides>(db, SYSTEM_KEYS.limitOverrides) ?? {};
}

export function setLimitOverrides(db: Db, overrides: LimitOverrides, clock?: () => Date): void {
  set(db, SYSTEM_KEYS.limitOverrides, overrides, clock);
}
