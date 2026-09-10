"use server";

import { revalidatePath } from "next/cache";
import { getAppDb } from "@/db/app";
import { pauseSystem, resumeSystem, setLimitOverrides } from "@/features/system/state";
import { resolveException } from "@/features/system/exceptions";
import { discoverLead, walkPipelineTo } from "@/features/leads/repository";
import { enqueueJob } from "@/worker/queue";
import { loadBusinessConfig } from "@/lib/config";

/** Global pause switch — the operator's big red button. */
export async function pauseAction(formData: FormData): Promise<void> {
  const reason = String(formData.get("reason") ?? "Pausa manual do operador");
  pauseSystem(getAppDb(), reason);
  revalidatePath("/");
}

export async function resumeAction(): Promise<void> {
  resumeSystem(getAppDb());
  revalidatePath("/");
}

export async function resolveExceptionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  if (id) resolveException(getAppDb(), id);
  revalidatePath("/exceptions");
}

export async function updateLimitsAction(formData: FormData): Promise<void> {
  const num = (k: string) => {
    const v = formData.get(k);
    return v != null && v !== "" ? Number(v) : undefined;
  };
  setLimitOverrides(getAppDb(), {
    maxDmsPerDay: num("maxDmsPerDay"),
    minSecondsBetweenDms: num("minSecondsBetweenDms"),
    maxSecondsBetweenDms: num("maxSecondsBetweenDms"),
    operatingHours: (formData.get("operatingHours") as string) || undefined,
  });
  revalidatePath("/settings");
}

/**
 * Seed a few demo leads and queue discovery — lets the operator see the funnel
 * populate without wiring real discovery. Uses only the fake-safe path.
 */
export async function seedDemoAction(): Promise<void> {
  const db = getAppDb();
  const config = loadBusinessConfig();
  const demo = [
    { handle: "@imob.exemplo", funnel: "customer" as const, keyword: "CRM sob medida", signals: { fullName: "Rafael — Fundador", bio: "Imobiliária. CRM sob medida e atendimento IA WhatsApp." } },
    { handle: "@servico.exemplo", funnel: "customer" as const, keyword: "site que converte", signals: { fullName: "Marina", bio: "Reformas. Site que converte e automação n8n." } },
    { handle: "@criador.exemplo", funnel: "affiliate" as const, signals: { fullName: "Léo", bio: "Automação n8n, esteira de conteúdo e mentoria de IA." } },
  ];
  for (const d of demo) {
    const res = discoverLead(db, d, config);
    if (res.ok && res.value.score >= 0.2) {
      walkPipelineTo(db, res.value.id, "qualified");
      enqueueJob(db, { type: "first_contact", payload: { leadId: res.value.id }, idempotencyKey: `first_contact:${res.value.id}` });
    }
  }
  revalidatePath("/");
  revalidatePath("/leads");
}
