import type { Db } from "@/db/client";
import { getCircuitBreaker, isPaused, pauseSystem, setCircuitBreaker } from "@/features/system/state";

export interface CircuitBreakerConfig {
  threshold: number; // failures within the window to trip
  windowSeconds: number;
}

const DEFAULT: CircuitBreakerConfig = { threshold: 5, windowSeconds: 300 };

/** Record a successful operation: decay the failure count. */
export function recordSuccess(db: Db, clock: () => Date = () => new Date()): void {
  const cb = getCircuitBreaker(db);
  if (cb.failures === 0 && !cb.open) return;
  setCircuitBreaker(db, { ...cb, failures: Math.max(0, cb.failures - 1) }, clock);
}

/**
 * Record a failure. When failures cross the threshold inside the rolling window
 * the breaker opens and the whole system pauses — protecting the account and
 * the operator from a runaway error loop.
 */
export function recordFailure(
  db: Db,
  reason: string,
  config: CircuitBreakerConfig = DEFAULT,
  clock: () => Date = () => new Date(),
): { open: boolean } {
  const now = clock();
  const cb = getCircuitBreaker(db);
  const windowStart = new Date(cb.windowStart).getTime();
  const withinWindow = now.getTime() - windowStart <= config.windowSeconds * 1000;

  const failures = (withinWindow ? cb.failures : 0) + 1;
  const nextWindowStart = withinWindow ? cb.windowStart : now.toISOString();

  if (failures >= config.threshold) {
    setCircuitBreaker(
      db,
      { open: true, failures, windowStart: nextWindowStart, openedReason: reason },
      clock,
    );
    pauseSystem(db, `Circuit breaker aberto: ${reason} (${failures} falhas)`, clock);
    return { open: true };
  }

  setCircuitBreaker(db, { open: false, failures, windowStart: nextWindowStart }, clock);
  return { open: false };
}

export function isTripped(db: Db): boolean {
  return getCircuitBreaker(db).open || isPaused(db);
}

export function resetCircuitBreaker(db: Db, clock: () => Date = () => new Date()): void {
  setCircuitBreaker(db, { open: false, failures: 0, windowStart: clock().toISOString() }, clock);
}
