import { eq } from "drizzle-orm";
import { getAppDb } from "@/db/app";
import { webhookEvents } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { nowIso } from "@/lib/time";
import { handoffToApi } from "@/features/conversations/handoff";
import { parseInboundMessages, verifySignature, verifyWebhookChallenge, webhookDeliveryId } from "@/integrations/instagram/webhook";
import { enqueueJob } from "@/worker/queue";

export const dynamic = "force-dynamic";

/** Subscription verification handshake (GET). */
export async function GET(req: Request): Promise<Response> {
  let env;
  try {
    env = loadEnv();
  } catch {
    return new Response("env não configurado", { status: 503 });
  }
  const url = new URL(req.url);
  const challenge = verifyWebhookChallenge(
    {
      mode: url.searchParams.get("hub.mode") ?? undefined,
      token: url.searchParams.get("hub.verify_token") ?? undefined,
      challenge: url.searchParams.get("hub.challenge") ?? undefined,
    },
    env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
  );
  if (challenge === null) return new Response("forbidden", { status: 403 });
  return new Response(challenge, { status: 200 });
}

/** Inbound messaging events (POST). Signature-verified and idempotent. */
export async function POST(req: Request): Promise<Response> {
  let env;
  try {
    env = loadEnv();
  } catch {
    return new Response("env não configurado", { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifySignature(raw, signature, env.INSTAGRAM_APP_SECRET)) {
    logger.warn("webhook: assinatura inválida");
    return new Response("assinatura inválida", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("payload inválido", { status: 400 });
  }

  const db = getAppDb();
  const deliveryId = webhookDeliveryId(payload);

  // Idempotency: a re-delivered webhook is recorded once and skipped.
  try {
    db.insert(webhookEvents)
      .values({
        id: newId("wh"),
        provider: "instagram",
        externalEventId: deliveryId,
        payload: payload as Record<string, unknown>,
        status: "received",
        processedAt: null,
        createdAt: nowIso(),
      })
      .run();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return new Response("ok (duplicado)", { status: 200 });
    }
    throw e;
  }

  const inbound = parseInboundMessages(payload);
  for (const env2 of inbound) {
    const res = handoffToApi(db, env2);
    if (res.ok) {
      enqueueJob(db, {
        type: "api_reply",
        payload: { leadId: res.value.id },
        idempotencyKey: `api_reply:${res.value.id}:${env2.externalId}`,
      });
    } else {
      // Could not match; keep the raw event for operator review (best-effort).
      logger.warn({ metaUserId: env2.metaUserId }, "webhook: lead não encontrado para a mensagem");
    }
  }

  db.update(webhookEvents)
    .set({ status: "processed", processedAt: nowIso() })
    .where(eq(webhookEvents.externalEventId, deliveryId))
    .run();
  return new Response("ok", { status: 200 });
}
