import { normalizeHandle } from "@/lib/ids";
import type { BrowserClient, DmSendResult, SendDmInput } from "./types";

export interface FakeBrowserOptions {
  /** How the fake behaves, to exercise each branch. */
  mode?: "success" | "unavailable" | "fail";
  dryRun?: boolean;
}

/**
 * In-memory browser client for tests, CI and dry-run. Records what would have
 * been sent, and can simulate an unreachable Chrome (to prove the queue pauses)
 * or a send failure (to prove artifact capture + exception handling).
 */
export class FakeBrowserClient implements BrowserClient {
  readonly sent: { handle: string; message: string }[] = [];
  constructor(private readonly options: FakeBrowserOptions = {}) {}

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (this.options.mode === "unavailable") return { ok: false, error: "CDP indisponível (fake)" };
    return { ok: true };
  }

  async sendInstagramDm(input: SendDmInput): Promise<DmSendResult> {
    if (this.options.mode === "unavailable") {
      return { ok: false, reason: "browser_unavailable", error: "connectOverCDP falhou (fake)" };
    }
    if (this.options.dryRun) {
      return { ok: false, reason: "dry_run" };
    }
    if (this.options.mode === "fail") {
      return {
        ok: false,
        reason: "send_failed",
        error: "elemento não encontrado (fake)",
        artifacts: {
          jobId: input.jobId,
          url: `https://www.instagram.com/${normalizeHandle(input.handle)}/`,
          consoleErrors: ["fake console error"],
          networkFailures: [],
          screenshotPath: `screenshots/${input.jobId ?? "fake"}.png`,
        },
      };
    }
    this.sent.push({ handle: normalizeHandle(input.handle), message: input.message });
    return { ok: true };
  }

  async close(): Promise<void> {
    /* no-op */
  }
}
