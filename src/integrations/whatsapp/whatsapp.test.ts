import { describe, expect, it } from "vitest";
import { makeBusinessConfig } from "@/test/fixtures";
import { redirectFor } from "./index";

describe("redirectFor", () => {
  it("sends customers to WhatsApp", () => {
    const r = redirectFor(makeBusinessConfig(), "customer");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("whatsapp");
  });

  it("refuses to invent an affiliate group link when none exists", () => {
    const r = redirectFor(makeBusinessConfig(), "affiliate");
    expect(r.ok).toBe(false);
  });

  it("uses the affiliate group link when configured", () => {
    const config = makeBusinessConfig({
      links: { whatsapp: "https://wa.me/5527981434479", affiliateGroup: "https://chat.whatsapp.com/abc" },
    });
    const r = redirectFor(config, "affiliate");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("affiliate_group");
  });
});
