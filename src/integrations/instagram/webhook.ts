import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundEnvelope } from "@/features/conversations/handoff";

/**
 * Instagram/Meta webhook helpers: subscription challenge, HMAC signature
 * verification (X-Hub-Signature-256), and parsing of inbound messaging events.
 */

/** GET verification handshake. Returns the challenge to echo, or null. */
export function verifyWebhookChallenge(
  params: { mode?: string; token?: string; challenge?: string },
  verifyToken: string,
): string | null {
  if (params.mode === "subscribe" && params.token && params.token === verifyToken) {
    return params.challenge ?? "";
  }
  return null;
}

/** Verify the X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(rawBody: string, signatureHeader: string | null | undefined, appSecret: string): boolean {
  if (!signatureHeader) return false;
  const [scheme, provided] = signatureHeader.split("=");
  if (scheme !== "sha256" || !provided) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface RawMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
}

interface RawEntry {
  id?: string;
  time?: number;
  messaging?: RawMessaging[];
}

interface RawPayload {
  object?: string;
  entry?: RawEntry[];
}

/**
 * Extract inbound (non-echo) text messages. Each carries the Meta message id
 * (`externalId`), which is the idempotency key downstream.
 */
export function parseInboundMessages(payload: unknown): InboundEnvelope[] {
  const p = payload as RawPayload;
  if (!p || p.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: InboundEnvelope[] = [];
  for (const entry of p.entry) {
    for (const m of entry.messaging ?? []) {
      const senderId = m.sender?.id;
      const mid = m.message?.mid;
      const text = m.message?.text;
      if (!senderId || !mid || m.message?.is_echo || typeof text !== "string") continue;
      out.push({ metaUserId: senderId, body: text, externalId: mid });
    }
  }
  return out;
}

/** Stable id used to dedupe whole webhook deliveries. */
export function webhookDeliveryId(payload: unknown): string {
  const p = payload as RawPayload;
  const ids = (p.entry ?? [])
    .flatMap((e) => (e.messaging ?? []).map((m) => m.message?.mid).filter(Boolean))
    .join(",");
  return ids || `entry:${(p.entry ?? []).map((e) => `${e.id}:${e.time}`).join("|")}`;
}
