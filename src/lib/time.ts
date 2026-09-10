/**
 * Time helpers: operating-hours checks (timezone-aware), human-rhythm jitter,
 * and UTC formatting. Timestamps are always stored as UTC ISO strings.
 */

export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString();
}

export interface OperatingWindow {
  readonly startMinutes: number; // minutes past midnight, local tz
  readonly endMinutes: number;
}

/** Parse "HH:MM-HH:MM" into minute offsets. */
export function parseOperatingHours(spec: string): OperatingWindow {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(spec);
  if (!match) throw new Error(`Janela de operação inválida: ${spec}`);
  const [, sh, sm, eh, em] = match as unknown as [string, string, string, string, string];
  return {
    startMinutes: Number(sh) * 60 + Number(sm),
    endMinutes: Number(eh) * 60 + Number(em),
  };
}

/** Minutes-past-midnight for `date` rendered in `timeZone`. */
export function minutesInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** Whether `date` falls inside the operating window in the given timezone. */
export function isWithinOperatingHours(
  spec: string,
  timeZone: string,
  date: Date = new Date(),
): boolean {
  const { startMinutes, endMinutes } = parseOperatingHours(spec);
  const current = minutesInTimeZone(date, timeZone);
  if (startMinutes <= endMinutes) {
    return current >= startMinutes && current < endMinutes;
  }
  // Overnight window (e.g. 20:00-06:00).
  return current >= startMinutes || current < endMinutes;
}

/** Uniform random integer in [min, max]. Deterministic when `rng` is supplied. */
export function randomInt(min: number, max: number, rng: () => number = Math.random): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
