/** Artifacts captured when a browser job fails, for operator debugging. */
export interface FailureArtifacts {
  screenshotPath?: string;
  accessibilitySnapshot?: unknown;
  url?: string;
  consoleErrors?: string[];
  networkFailures?: string[];
  jobId?: string;
}

export type DmSendResult =
  | { ok: true; artifacts?: FailureArtifacts }
  | { ok: false; reason: "browser_unavailable" | "send_failed" | "blocked_domain" | "dry_run"; error?: string; artifacts?: FailureArtifacts };

export interface SendDmInput {
  handle: string;
  message: string;
  jobId?: string;
  /** Per-character typing delay range (ms). */
  typeDelayMs?: { min: number; max: number };
}

/**
 * The browser boundary the worker depends on. The real implementation drives a
 * CDP-connected Chrome; the fake simulates it for tests, dry-run and CI.
 */
export interface BrowserClient {
  /** Send the first-contact DM through the operator's logged-in Chrome. */
  sendInstagramDm(input: SendDmInput): Promise<DmSendResult>;
  /** Whether a real, logged-in browser context is reachable right now. */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
  close(): Promise<void>;
}
