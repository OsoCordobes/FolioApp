/**
 * Folio · chip "Prueba: quedan N días" (E3 · billing que vende).
 *
 * Lógica pura de cuándo mostrar el aviso de trial en la navegación (sidebar
 * desktop + bottom-nav mobile) y con qué tono. Vive separada del JSX para
 * que sea testeable con node:test (tests/unit/trial-chip.test.ts).
 *
 * Reglas:
 *   - Solo el OWNER lo ve: es el único que puede activar la suscripción
 *     (/configuracion/billing hace notFound() para el resto).
 *   - Solo durante el trial: `graceDaysLeft` viene de computeAccessGate y es
 *     null cuando hay suscripción activa (o período pagado vigente) — con
 *     suscripción al día no hay nada que avisar.
 *   - 0 días o gate bloqueado → nada: el layout ya redirige a billing, el
 *     chip sería ruido duplicado.
 *   - Cuentas internas (M37) nunca lo ven: su gate está bypasseado y el
 *     "trial" derivado de created_at no significa nada ahí.
 *   - Tono: discreto por defecto; urgente (amber) recién con N ≤ 7 días.
 */

import type { Role } from "@/lib/auth/capabilities";

/** Umbral de urgencia: con ≤7 días el chip pasa a tono amber. */
export const TRIAL_CHIP_URGENT_DAYS = 7;

export interface TrialChipInput {
  /** Rol del member logueado en la org activa. */
  role: Role;
  /** `accessGate.graceDaysLeft` de computeAccessGate (null si no aplica trial). */
  graceDaysLeft: number | null;
  /** M37 · cuentas internas/demo: el gate no aplica, el chip tampoco. */
  isInternalAccount?: boolean;
}

export type TrialChipView =
  | { show: false }
  | { show: true; days: number; urgent: boolean; label: string };

export function computeTrialChip({
  role,
  graceDaysLeft,
  isInternalAccount = false,
}: TrialChipInput): TrialChipView {
  if (isInternalAccount) return { show: false };
  if (role !== "OWNER") return { show: false };
  if (graceDaysLeft == null) return { show: false };
  const days = Math.floor(graceDaysLeft);
  if (days <= 0) return { show: false };
  return {
    show: true,
    days,
    urgent: days <= TRIAL_CHIP_URGENT_DAYS,
    label: days === 1 ? "Prueba: queda 1 día" : `Prueba: quedan ${days} días`,
  };
}
