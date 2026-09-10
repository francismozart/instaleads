import { logger } from "@/lib/logger";
import { isPaused } from "@/features/system/state";
import { isTripped, recordFailure, recordSuccess } from "./circuit-breaker";
import type { WorkerContext } from "./context";
import { HANDLERS } from "./handlers";
import { claimNextJob, completeJob, failJob, rescheduleJob } from "./queue";

export interface RunOnceResult {
  worked: boolean;
  jobId?: string;
  outcome?: string;
}

/** Process at most one job. Respects the global pause and the circuit breaker. */
export async function runOnce(ctx: WorkerContext): Promise<RunOnceResult> {
  if (isPaused(ctx.db) || isTripped(ctx.db)) return { worked: false, outcome: "paused" };

  const job = claimNextJob(ctx.db, { workerId: ctx.workerId, now: ctx.clock() });
  if (!job) return { worked: false, outcome: "idle" };

  const handler = HANDLERS[job.type];
  if (!handler) {
    failJob(ctx.db, job.id, `Sem handler para o tipo "${job.type}"`, { clock: ctx.clock });
    return { worked: true, jobId: job.id, outcome: "no_handler" };
  }

  try {
    const result = await handler(ctx, job);
    switch (result.status) {
      case "done":
        completeJob(ctx.db, job.id, ctx.clock);
        recordSuccess(ctx.db, ctx.clock);
        return { worked: true, jobId: job.id, outcome: "done" };
      case "reschedule":
        rescheduleJob(ctx.db, job.id, result.seconds, ctx.clock);
        return { worked: true, jobId: job.id, outcome: `reschedule:${result.reason ?? ""}` };
      case "pause":
        // The handler already paused the system; return the job to the queue.
        rescheduleJob(ctx.db, job.id, result.rescheduleSeconds ?? 300, ctx.clock);
        logger.warn({ reason: result.reason }, "worker paused system");
        return { worked: true, jobId: job.id, outcome: `pause:${result.reason}` };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const failed = failJob(ctx.db, job.id, message, { clock: ctx.clock });
    const trip = recordFailure(ctx.db, `job ${job.type} falhou: ${message}`, undefined, ctx.clock);
    logger.error({ jobId: job.id, type: job.type, err: message, dead: failed?.status === "dead", circuitOpen: trip.open }, "job failed");
    return { worked: true, jobId: job.id, outcome: "failed" };
  }
}

export interface LoopControls {
  stop: () => void;
}

/** Continuously drain the queue; sleep briefly when idle. */
export function runLoop(ctx: WorkerContext, opts: { idleMs?: number } = {}): LoopControls {
  let running = true;
  const idleMs = opts.idleMs ?? 1000;

  const tick = async (): Promise<void> => {
    while (running) {
      let res: RunOnceResult;
      try {
        res = await runOnce(ctx);
      } catch (e) {
        logger.error({ err: String(e) }, "runOnce crashed");
        res = { worked: false, outcome: "crash" };
      }
      if (!res.worked) {
        await new Promise((r) => setTimeout(r, idleMs));
      }
    }
  };

  void tick();
  return { stop: () => (running = false) };
}
