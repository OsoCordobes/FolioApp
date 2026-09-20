import type { OrganizacionTipo } from "@/lib/billing/pricing";

export interface OnboardingChoice {
  tipo: OrganizacionTipo;
  ownerTratante: boolean;
}

/** An intent is only a UI hint across OAuth/email. The database wins after bootstrap. */
export function parseOnboardingIntent(raw: string | null): OnboardingChoice | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const choice = value as Record<string, unknown>;
    if (choice.tipo === "INDEPENDIENTE" && choice.ownerTratante === true)
      return { tipo: "INDEPENDIENTE", ownerTratante: true };
    if (choice.tipo === "CLINICA" && typeof choice.ownerTratante === "boolean")
      return { tipo: "CLINICA", ownerTratante: choice.ownerTratante };
  } catch { /* invalid or unavailable storage */ }
  return null;
}
