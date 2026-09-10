/**
 * Domain error codes. Kept as a closed union so callers can switch
 * exhaustively and the UI can translate each to a PT-BR operator message.
 */
export type DomainErrorCode =
  | "duplicate_lead"
  | "on_do_not_contact_list"
  | "lead_blocked"
  | "invalid_pipeline_transition"
  | "invalid_channel_transition"
  | "channel_ownership_conflict"
  | "duplicate_send_blocked"
  | "claim_not_verified"
  | "api_window_closed"
  | "recipient_not_eligible"
  | "budget_exceeded"
  | "system_paused"
  | "circuit_open"
  | "browser_unavailable"
  | "webhook_signature_invalid"
  | "webhook_duplicate"
  | "not_found"
  | "validation_failed";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    if (details) this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
