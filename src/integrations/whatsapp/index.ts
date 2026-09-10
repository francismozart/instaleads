import type { BusinessConfig } from "@/lib/config";
import { DomainError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import type { Funnel } from "@/lib/states";

/**
 * WhatsApp / group routing. Interested customers go to the WhatsApp link;
 * interested affiliates go to the affiliate group link. If the affiliate group
 * link does not exist yet, we do NOT invent one — the lead is escalated.
 */
export interface RedirectTarget {
  kind: "whatsapp" | "affiliate_group";
  url: string;
}

export function redirectFor(config: BusinessConfig, funnel: Funnel): Result<RedirectTarget, DomainError> {
  if (funnel === "customer") {
    return ok({ kind: "whatsapp", url: config.links.whatsapp });
  }
  if (!config.links.affiliateGroup) {
    return err(
      new DomainError("validation_failed", "Link do grupo de afiliados não existe no site (bloqueado até existir)"),
    );
  }
  return ok({ kind: "affiliate_group", url: config.links.affiliateGroup });
}
