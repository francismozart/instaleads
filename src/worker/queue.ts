import { and, asc, desc, eq, lte, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs, type Job } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export interface EnqueueInput {
  type: string;
  payload: Record<string, unknown>;
  runAfter?: string;
  maxAttempts?: number;
  priority?: number;
  /** When set, a second enqueue with the same key is a no-op (idempotent). */
  idempotencyKey?: string;
}

export interface EnqueueResult {
  job: Job;
  created: boolean;
}

/** Add a durable job. Idempotent when `idempotencyKey` is provided. */
export function enqueueJob(db: Db, input: EnqueueInput, clock: () => Date = () => new Date()): EnqueueResult {
  const now = nowIso(clock);
  const job: Job = {
    id: newId("job"),
    type: input.type,
    payload: input.payload,
    status: "pending",
    priority: input.priority ?? 0,
    runAfter: input.runAfter ?? now,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    lastError: null,
    lockedAt: null,
    lockedBy: null,
    idempotencyKey: input.idempotencyKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    db.insert(jobs).values(job).run();
    return { job, created: true };
  } catch (e) {
    if (input.idempotencyKey && e instanceof Error && /UNIQUE/i.test(e.message)) {
      const existing = db.select().from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey)).get();
      if (existing) return { job: existing, created: false };
    }
    throw e;
  }
}

/**
 * Atomically claim the next due job. Selects the highest-priority job whose
 * runAfter has passed and flips it to `running` inside a transaction so two
 * workers never grab the same job.
 */
export function claimNextJob(
  db: Db,
  opts: { workerId: string; types?: string[]; now?: Date },
): Job | null {
  const nowStr = nowIso(opts.now ? () => opts.now! : undefined);
  return db.transaction((tx) => {
    const candidate = tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAfter, nowStr)))
      .orderBy(desc(jobs.priority), asc(jobs.runAfter))
      .limit(20)
      .all()
      .find((j) => !opts.types || opts.types.includes(j.type));
    if (!candidate) return null;

    const res = tx
      .update(jobs)
      .set({ status: "running", lockedAt: nowStr, lockedBy: opts.workerId, updatedAt: nowStr })
      .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "pending")))
      .run();
    if (res.changes === 0) return null; // lost the race
    return { ...candidate, status: "running", lockedAt: nowStr, lockedBy: opts.workerId };
  });
}

/** Put a claimed job back to pending after a delay (not a failure). */
export function rescheduleJob(
  db: Db,
  id: string,
  seconds: number,
  clock: () => Date = () => new Date(),
): void {
  const now = clock();
  const runAfter = new Date(now.getTime() + seconds * 1000).toISOString();
  db.update(jobs)
    .set({ status: "pending", lockedAt: null, lockedBy: null, runAfter, updatedAt: now.toISOString() })
    .where(eq(jobs.id, id))
    .run();
}

export function completeJob(db: Db, id: string, clock: () => Date = () => new Date()): void {
  const now = nowIso(clock);
  db.update(jobs)
    .set({ status: "succeeded", lockedAt: null, lockedBy: null, updatedAt: now })
    .where(eq(jobs.id, id))
    .run();
}

/** Exponential backoff (seconds), capped. */
export function backoffSeconds(attempts: number, baseSeconds = 5, cap = 3600): number {
  return Math.min(cap, baseSeconds * 2 ** Math.max(0, attempts - 1));
}

/**
 * Fail a job: increment attempts, and either reschedule with backoff or move to
 * the dead-letter state when max attempts are exhausted.
 */
export function failJob(
  db: Db,
  id: string,
  error: string,
  opts: { baseSeconds?: number; clock?: () => Date } = {},
): Job | null {
  const clock = opts.clock ?? (() => new Date());
  const now = clock();
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) return null;
  const attempts = job.attempts + 1;
  const dead = attempts >= job.maxAttempts;
  const runAfter = new Date(now.getTime() + backoffSeconds(attempts, opts.baseSeconds) * 1000).toISOString();
  const patch = {
    status: dead ? ("dead" as const) : ("pending" as const),
    attempts,
    lastError: error.slice(0, 2000),
    lockedAt: null,
    lockedBy: null,
    runAfter: dead ? job.runAfter : runAfter,
    updatedAt: now.toISOString(),
  };
  db.update(jobs).set(patch).where(eq(jobs.id, id)).run();
  return { ...job, ...patch };
}

/**
 * Restart recovery: any job left `running` (a crash mid-flight) is returned to
 * `pending` so it runs again. Called once on worker startup.
 */
export function recoverStuckJobs(db: Db, clock: () => Date = () => new Date()): number {
  const now = nowIso(clock);
  const res = db
    .update(jobs)
    .set({ status: "pending", lockedAt: null, lockedBy: null, updatedAt: now })
    .where(eq(jobs.status, "running"))
    .run();
  return res.changes;
}

export function listDeadJobs(db: Db, limit = 100): Job[] {
  return db.select().from(jobs).where(eq(jobs.status, "dead")).orderBy(desc(jobs.updatedAt)).limit(limit).all();
}

export function queueDepth(db: Db, now?: Date): number {
  const nowStr = nowIso(now ? () => now : undefined);
  return db
    .select()
    .from(jobs)
    .where(or(eq(jobs.status, "pending"), eq(jobs.status, "running")))
    .all()
    .filter((j) => j.status === "running" || j.runAfter <= nowStr).length;
}
