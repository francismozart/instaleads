import { logger } from "@/lib/logger";

/** The 24h standard messaging window for the Instagram Messaging API. */
export const MESSAGING_WINDOW_HOURS = 24;

export function isWithinMessagingWindow(
  lastInboundAt: Date | null,
  now: Date = new Date(),
  windowHours = MESSAGING_WINDOW_HOURS,
): boolean {
  if (!lastInboundAt) return false;
  const elapsedHours = (now.getTime() - lastInboundAt.getTime()) / (60 * 60 * 1000);
  return elapsedHours <= windowHours;
}

export type SendApiResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; status?: number };

/**
 * The official Instagram Messaging API boundary. The real client posts to the
 * Graph API; the fake records sends for tests. Callers MUST verify permissions,
 * recipient eligibility, the messaging window, and channel ownership before
 * calling — this client does not try to work around a closed window.
 */
export interface InstagramApiClient {
  sendTextMessage(recipientId: string, text: string): Promise<SendApiResult>;
}

export interface InstagramApiConfig {
  pageAccessToken: string;
  businessAccountId: string;
  graphVersion?: string;
}

export class GraphInstagramApiClient implements InstagramApiClient {
  constructor(private readonly config: InstagramApiConfig) {}

  async sendTextMessage(recipientId: string, text: string): Promise<SendApiResult> {
    const version = this.config.graphVersion ?? "v21.0";
    const url = `https://graph.facebook.com/${version}/me/messages?access_token=${encodeURIComponent(
      this.config.pageAccessToken,
    )}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      });
      const json = (await res.json()) as { message_id?: string; error?: { message?: string } };
      if (!res.ok || json.error) {
        return { ok: false, error: json.error?.message ?? `HTTP ${res.status}`, status: res.status };
      }
      return { ok: true, messageId: json.message_id ?? "" };
    } catch (e) {
      logger.error({ err: String(e) }, "instagram api send failed");
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** In-memory API client for tests and simulation. */
export class FakeInstagramApiClient implements InstagramApiClient {
  readonly sent: { recipientId: string; text: string }[] = [];
  constructor(private readonly failing = false) {}

  async sendTextMessage(recipientId: string, text: string): Promise<SendApiResult> {
    if (this.failing) return { ok: false, error: "fake api failure" };
    this.sent.push({ recipientId, text });
    return { ok: true, messageId: `mid.out.${this.sent.length}` };
  }
}
