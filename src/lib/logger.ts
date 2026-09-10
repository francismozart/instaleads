import pino from "pino";

/**
 * Structured logger. Secrets and tokens are redacted so logs can be shipped or
 * shared without leaking credentials or PII beyond what the operator expects.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.OPENAI_API_KEY",
      "*.INSTAGRAM_APP_SECRET",
      "*.INSTAGRAM_PAGE_ACCESS_TOKEN",
      "*.INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
      "*.STATE_ENCRYPTION_KEY",
      "*.access_token",
      "*.token",
      "*.secret",
      "*.password",
      "*.authorization",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
  base: { app: "instaleads" },
});

export type Logger = typeof logger;
