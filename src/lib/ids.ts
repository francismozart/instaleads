import { randomUUID, createHash } from "node:crypto";

/** Prefixed, sortable-ish identifiers. UUID keeps them globally unique. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Deterministic dedupe key. Used to build UNIQUE constraints that forbid the
 * same logical message being sent twice across browser/API (idempotency).
 */
export function dedupeKey(...parts: (string | number)[]): string {
  const raw = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/** Normalise an Instagram handle to a canonical, comparable form. */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase().replace(/^@+/, "").replace(/\/+$/, "");
}
