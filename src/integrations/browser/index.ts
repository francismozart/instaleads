import type { Env } from "@/lib/env";
import { CdpBrowserClient } from "./cdp-client";
import { FakeBrowserClient } from "./fake";
import type { BrowserClient } from "./types";

/**
 * Build the browser client. Uses the fake whenever USE_FAKE_BROWSER=1 (tests,
 * CI, isolated containers). BROWSER_DRY_RUN=1 makes even the real client stop
 * short of the final send keystroke.
 */
export function createBrowserClient(env: Env): BrowserClient {
  if (process.env.USE_FAKE_BROWSER === "1") {
    return new FakeBrowserClient({
      mode: (process.env.FAKE_BROWSER_MODE as "success" | "unavailable" | "fail") ?? "success",
      dryRun: process.env.BROWSER_DRY_RUN === "1",
    });
  }
  return new CdpBrowserClient({
    cdpUrl: env.CHROME_CDP_URL,
    dryRun: process.env.BROWSER_DRY_RUN === "1",
  });
}

export { CdpBrowserClient } from "./cdp-client";
export { FakeBrowserClient } from "./fake";
export { browserMutex, Mutex } from "./mutex";
export * from "./pacing";
export * from "./types";
