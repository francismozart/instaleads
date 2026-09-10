import { describe, expect, it } from "vitest";
import { makeBusinessConfig } from "@/test/fixtures";
import { checkClaims, isMessageAllowed } from "./claims-guard";

const config = makeBusinessConfig();

describe("claims guard", () => {
  it("allows a message built from verified claims", () => {
    const msg = "Oi! Trabalho com CRM sob medida — 15+ anos de software, falo direto com quem constrói.";
    expect(isMessageAllowed(msg, config)).toBe(true);
  });

  it("blocks an unverified claim verbatim", () => {
    const r = checkClaims("Somos o mais barato do mercado, pode confiar.", config);
    expect(r.allowed).toBe(false);
    expect(r.violations.some((v) => v.kind === "unverified_claim")).toBe(true);
  });

  it("blocks fabricated guarantees and financial promises", () => {
    expect(isMessageAllowed("Garanto R$ 10.000 de retorno no primeiro mês.", config)).toBe(false);
    expect(isMessageAllowed("Aprovação garantida da sua conta.", config)).toBe(false);
  });

  it("blocks fabricated rates and superlatives", () => {
    expect(isMessageAllowed("Aumentamos suas vendas em 300%.", config)).toBe(false);
    expect(isMessageAllowed("Somos a melhor agência líder de mercado.", config)).toBe(false);
  });

  it("does not flag digits that are part of a verified claim", () => {
    expect(isMessageAllowed("Tenho 15+ anos de software.", config)).toBe(true);
  });
});
