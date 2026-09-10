import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isWithinMessagingWindow } from "./api";
import { parseInboundMessages, verifySignature, verifyWebhookChallenge } from "./webhook";

const SECRET = "test_app_secret";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

describe("webhook signature", () => {
  it("accepts a correct signature and rejects a tampered body", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySignature(body + "x", sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=deadbeef", SECRET)).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
  });
});

describe("webhook challenge", () => {
  it("echoes the challenge only when mode + token match", () => {
    expect(
      verifyWebhookChallenge({ mode: "subscribe", token: "vt", challenge: "123" }, "vt"),
    ).toBe("123");
    expect(verifyWebhookChallenge({ mode: "subscribe", token: "wrong", challenge: "123" }, "vt")).toBeNull();
  });
});

describe("parseInboundMessages", () => {
  it("extracts non-echo text messages with their Meta id", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "page",
          messaging: [
            { sender: { id: "IG_1" }, recipient: { id: "page" }, message: { mid: "m1", text: "oi" } },
            { sender: { id: "IG_1" }, message: { mid: "m2", text: "echo", is_echo: true } },
          ],
        },
      ],
    };
    const msgs = parseInboundMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ metaUserId: "IG_1", body: "oi", externalId: "m1" });
  });

  it("ignores non-instagram payloads", () => {
    expect(parseInboundMessages({ object: "page", entry: [] })).toHaveLength(0);
  });
});

describe("messaging window", () => {
  it("is open within 24h of the last inbound and closed after", () => {
    const now = new Date("2026-01-05T12:00:00Z");
    expect(isWithinMessagingWindow(new Date(now.getTime() - 23 * 3600_000), now)).toBe(true);
    expect(isWithinMessagingWindow(new Date(now.getTime() - 25 * 3600_000), now)).toBe(false);
    expect(isWithinMessagingWindow(null, now)).toBe(false);
  });
});
