import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordLeadEvent } from "@/db/audit";
import { messages, type Lead, type Message } from "@/db/schema";
import type { BusinessConfig } from "@/lib/config";
import { checkClaims } from "@/lib/claims-guard";
import { DomainError } from "@/lib/errors";
import { dedupeKey as buildDedupeKey, newId } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import { nowIso } from "@/lib/time";
import { findLeadById, markContacted } from "@/features/leads/repository";

export type MessageChannel = "browser" | "api" | "whatsapp";

export interface ReserveOutboundInput {
  leadId: string;
  channel: MessageChannel;
  body: string;
  /** Logical phase (e.g. "opener", "presentation", turn number) — part of the dedupe key. */
  phase: string;
  variantId?: string;
  intent?: string;
}

/**
 * Reserve an outbound send slot. This is the single choke point that guarantees
 * "zero duplicate sends between browser and API":
 *
 *  1. channel-ownership lock — a lead is owned by exactly one channel; a send
 *     on the wrong channel is refused (no simultaneous browser + API sends).
 *  2. claims guard — the body must pass the verified-claims gate.
 *  3. unique dedupe key — a UNIQUE index makes a second insert of the same
 *     logical message fail atomically at the database level.
 *
 * On success a `queued` message row is returned; the integration then sends it
 * and calls `markOutboundSent`.
 */
export function reserveOutbound(
  db: Db,
  input: ReserveOutboundInput,
  config: BusinessConfig,
  clock: () => Date = () => new Date(),
): Result<Message, DomainError> {
  const lead = findLeadById(db, input.leadId);
  if (!lead) return err(new DomainError("not_found", `Lead ${input.leadId} não encontrado`));

  // (1) channel ownership. WhatsApp is a redirect target, not a DM thread we own.
  if (input.channel !== "whatsapp" && lead.channelOwner !== input.channel) {
    return err(
      new DomainError(
        "channel_ownership_conflict",
        `Canal ${input.channel} não é o dono da conversa (dono atual: ${lead.channelOwner})`,
        { leadId: lead.id, owner: lead.channelOwner },
      ),
    );
  }

  // (2) verified-claims gate.
  const claim = checkClaims(input.body, config);
  if (!claim.allowed) {
    return err(
      new DomainError("claim_not_verified", "Mensagem bloqueada pela regra de afirmações", {
        violations: claim.violations,
      }),
    );
  }

  // (3) atomic dedupe.
  const key = buildDedupeKey(lead.id, input.channel, input.phase);
  const row: Message = {
    id: newId("msg"),
    leadId: lead.id,
    channel: input.channel,
    direction: "outbound",
    body: input.body,
    variantId: input.variantId ?? null,
    intent: input.intent ?? null,
    status: "queued",
    externalId: null,
    dedupeKey: key,
    createdAt: nowIso(clock),
  };

  try {
    db.transaction((tx) => {
      tx.insert(messages).values(row).run();
      recordLeadEvent(tx, lead.id, "message_queued", { channel: input.channel, phase: input.phase }, clock);
    });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return err(
        new DomainError("duplicate_send_blocked", "Envio duplicado bloqueado", {
          leadId: lead.id,
          phase: input.phase,
        }),
      );
    }
    throw e;
  }

  return ok(row);
}

export function markOutboundSent(
  db: Db,
  messageId: string,
  opts: { externalId?: string } = {},
  clock: () => Date = () => new Date(),
): void {
  const msg = db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!msg) throw new DomainError("not_found", `Mensagem ${messageId} não encontrada`);
  db.transaction((tx) => {
    tx.update(messages)
      .set({ status: "sent", externalId: opts.externalId ?? msg.externalId })
      .where(eq(messages.id, messageId))
      .run();
    recordLeadEvent(tx, msg.leadId, "message_sent", { channel: msg.channel, messageId }, clock);
  });
  markContacted(db, msg.leadId, clock);
}

/**
 * Record an inbound message. `externalId` (the Meta message id) is UNIQUE, so a
 * re-delivered webhook is a no-op — inbound idempotency.
 */
export function recordInbound(
  db: Db,
  input: { leadId: string; body: string; externalId: string; channel?: MessageChannel },
  clock: () => Date = () => new Date(),
): Result<Message, DomainError> {
  const row: Message = {
    id: newId("msg"),
    leadId: input.leadId,
    channel: input.channel ?? "api",
    direction: "inbound",
    body: input.body,
    variantId: null,
    intent: null,
    status: "received",
    externalId: input.externalId,
    dedupeKey: buildDedupeKey(input.leadId, "inbound", input.externalId),
    createdAt: nowIso(clock),
  };
  try {
    db.transaction((tx) => {
      tx.insert(messages).values(row).run();
      recordLeadEvent(tx, input.leadId, "message_received", { externalId: input.externalId }, clock);
    });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return err(new DomainError("webhook_duplicate", "Mensagem já registrada (idempotente)"));
    }
    throw e;
  }
  return ok(row);
}

/**
 * Cancel a still-queued outbound message (delete the reserved row) so a retry
 * can re-reserve the same logical phase after a transient send failure.
 */
export function cancelOutbound(db: Db, messageId: string): void {
  db.delete(messages).where(and(eq(messages.id, messageId), eq(messages.status, "queued"))).run();
}

/** Timestamp of the most recent browser outbound DM (for pacing), or null. */
export function lastBrowserSendAt(db: Db): Date | null {
  const row = db
    .select()
    .from(messages)
    .where(and(eq(messages.channel, "browser"), eq(messages.direction, "outbound"), eq(messages.status, "sent")))
    .orderBy(asc(messages.createdAt))
    .all()
    .at(-1);
  return row ? new Date(row.createdAt) : null;
}

export function listMessages(db: Db, leadId: string): Message[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.leadId, leadId))
    .orderBy(asc(messages.createdAt))
    .all();
}

export function lastOutboundPhase(db: Db, leadId: string, channel: MessageChannel): Message | undefined {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.leadId, leadId), eq(messages.channel, channel), eq(messages.direction, "outbound")))
    .orderBy(asc(messages.createdAt))
    .all()
    .at(-1);
}

export type { Lead };
