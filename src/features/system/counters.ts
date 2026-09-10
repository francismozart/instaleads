import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dailyCounters } from "@/db/schema";
import { nowIso } from "@/lib/time";

/** Local calendar date (YYYY-MM-DD) in the operating timezone. */
export function dateKeyFor(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export function getSentToday(db: Db, dateKey: string): number {
  return db.select().from(dailyCounters).where(eq(dailyCounters.date, dateKey)).get()?.dmSent ?? 0;
}

export function incrementSentToday(db: Db, dateKey: string, clock: () => Date = () => new Date()): number {
  const now = nowIso(clock);
  db.insert(dailyCounters)
    .values({ date: dateKey, dmSent: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: dailyCounters.date,
      set: { dmSent: sql`${dailyCounters.dmSent} + 1`, updatedAt: now },
    })
    .run();
  return getSentToday(db, dateKey);
}
