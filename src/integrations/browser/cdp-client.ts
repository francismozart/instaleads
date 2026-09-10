import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { normalizeHandle } from "@/lib/ids";
import { logger } from "@/lib/logger";
import type { BrowserClient, DmSendResult, FailureArtifacts, SendDmInput } from "./types";

const INSTAGRAM_HOSTS = ["instagram.com", "www.instagram.com"];

export interface CdpClientConfig {
  cdpUrl: string;
  /** When true, everything runs except the final send keystroke (dry-run). */
  dryRun: boolean;
  screenshotDir?: string;
}

/**
 * Real browser client. Connects to the operator's Chrome over CDP and drives a
 * DEDICATED tab. It never launches its own Chrome, never adopts the operator's
 * tab, never calls bringToFront, and never takes the mouse/keyboard. It is
 * restricted to the Instagram domain and closes its tab in a finally block.
 *
 * NOTE: this code runs on the operator's machine (real Chrome). In an isolated
 * container use the fake client instead; see src/integrations/browser/fake.ts.
 */
export class CdpBrowserClient implements BrowserClient {
  private browser: Browser | null = null;

  constructor(private readonly config: CdpClientConfig) {}

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const browser = await this.connect();
      const context = browser.contexts()[0];
      if (!context) return { ok: false, error: "Nenhum contexto logado disponível" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Connect over CDP. On failure we DO NOT launch a new Chrome. */
  private async connect(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    try {
      this.browser = await chromium.connectOverCDP(this.config.cdpUrl);
      return this.browser;
    } catch (e) {
      throw new Error(`connectOverCDP falhou (${this.config.cdpUrl}): ${e instanceof Error ? e.message : e}`);
    }
  }

  async sendInstagramDm(input: SendDmInput): Promise<DmSendResult> {
    let browser: Browser;
    try {
      browser = await this.connect();
    } catch (e) {
      // Do not open a new Chrome; signal unavailability so the queue pauses.
      logger.error({ err: String(e) }, "browser_unavailable");
      return { ok: false, reason: "browser_unavailable", error: e instanceof Error ? e.message : String(e) };
    }

    const context = browser.contexts()[0] as BrowserContext | undefined;
    if (!context) {
      return { ok: false, reason: "browser_unavailable", error: "Sem contexto logado (browser.contexts()[0])" };
    }

    // Our own tab — never adopt the user's tab.
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const networkFailures: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      networkFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "?"}`);
    });

    // Restrict to the Instagram domain: abort any main-frame navigation elsewhere.
    await page.route("**/*", (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        const host = safeHost(req.url());
        if (host && !INSTAGRAM_HOSTS.includes(host)) {
          return route.abort();
        }
      }
      return route.continue();
    });

    const handle = normalizeHandle(input.handle);
    try {
      await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });

      // Prefer accessible roles over fragile CSS selectors.
      const messageButton = page.getByRole("button", { name: /message|mensagem|enviar mensagem/i });
      await messageButton.first().click({ timeout: 15_000 });

      const editor = page.getByRole("textbox").first();
      await editor.click({ timeout: 15_000 });

      const delay = input.typeDelayMs ?? { min: 40, max: 140 };
      await editor.pressSequentially(input.message, { delay: Math.round((delay.min + delay.max) / 2) });

      // Human pause before sending.
      await page.waitForTimeout(600 + Math.floor(Math.random() * 900));

      if (this.config.dryRun) {
        logger.info({ handle }, "dry_run: DM composed but NOT sent");
        return { ok: false, reason: "dry_run" };
      }

      await editor.press("Enter");
      await page.waitForTimeout(1500);
      return { ok: true };
    } catch (e) {
      const artifacts = await this.captureArtifacts(page, input.jobId, consoleErrors, networkFailures);
      logger.error({ handle, err: String(e), artifacts }, "browser send_failed");
      return { ok: false, reason: "send_failed", error: e instanceof Error ? e.message : String(e), artifacts };
    } finally {
      // Always release our tab, even on error.
      await page.close().catch(() => undefined);
    }
  }

  private async captureArtifacts(
    page: Page,
    jobId: string | undefined,
    consoleErrors: string[],
    networkFailures: string[],
  ): Promise<FailureArtifacts> {
    const dir = resolve(this.config.screenshotDir ?? "screenshots");
    mkdirSync(dir, { recursive: true });
    const screenshotPath = resolve(dir, `${jobId ?? Date.now()}.png`);
    let url: string | undefined;
    let accessibilitySnapshot: unknown;
    try {
      url = page.url();
      await page.screenshot({ path: screenshotPath, fullPage: false });
      // Prefer a stable ARIA snapshot over fragile DOM dumps.
      accessibilitySnapshot = await page.locator("body").ariaSnapshot();
    } catch {
      // best-effort capture
    }
    return { screenshotPath, accessibilitySnapshot, url, consoleErrors, networkFailures, jobId };
  }

  async close(): Promise<void> {
    // We connected to an existing Chrome; disconnect without closing it.
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
