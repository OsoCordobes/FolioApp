/**
 * Folio · decisión pura de upgrade de tier (PR 1.4 · self-serve a Clínica).
 *
 * Decide si una org es elegible para pasar de INDEPENDIENTE a CLINICA desde
 * /configuracion, y con qué impacto de precio. Sin proration (decisión
 * aprobada en el plan): el monto nuevo aplica al PRÓXIMO débito del preapproval
 * — `syncSubscriptionAmount` (lib/db/suscripcion.ts) hace el PUT idempotente
 * MP-first. Acá NO se cobra nada retroactivo.
 *
 * Reglas de elegibilidad (todas se cumplen para elegible=true):
 *   - Solo el OWNER puede iniciar el cambio (quien paga).
 *   - Solo INDEPENDIENTE → CLINICA es self-serve. El sentido inverso
 *     (downgrade Clínica → Solo) NO es self-serve: se resuelve "vía soporte"
 *     (baja de seats, prorrateos, migración de datos de equipo — proceso
 *     manual auditable).
 *   - CUALQUIER estado de suscripción es elegible: si está ACTIVA/MOROSA el
 *     sync ajusta el preapproval; si está PENDIENTE_ACTIVACION/CANCELADA/PAUSADA
 *     el próximo alta/reactivación toma el monto del tier actual (el preapproval
 *     se re-crea con computeMonthlyPriceCents del tier nuevo). El cambio de tier
 *     no depende de tener un cobro activo.
 *
 * Montos (centavos ARS, según lib/billing/pricing.ts al momento del cambio):
 *   - montoAntes  = precio del tier ACTUAL (INDEPENDIENTE → plan Solo vigente).
 *   - montoDespues = precio de CLINICA con los seats activos actuales. La base
 *     de Clínica INCLUYE al titular (1 seat = base; cada member activo
 *     adicional suma un seat). `membersActivos` es el head-count de members
 *     activos (deleted_at IS NULL) de la org, incluyendo al OWNER.
 *
 * Función pura y testeable (`tests/unit/upgrade-tipo.test.ts`).
 */

import { computeMonthlyPriceCents, type OrganizacionTipo } from "@/lib/billing/pricing";
import type { EstadoSuscripcion } from "@/lib/db/suscripcion";

/** Roles posibles del member de la sesión (mismo union que ActiveSession). */
export type MemberRol = "OWNER" | "DIRECTOR" | "PROFESIONAL" | "COORDINADOR" | "ASISTENTE";

export interface DecideUpgradeInput {
  /** organization.tipo actual. */
  tipoActual: OrganizacionTipo;
  /** Rol del member de la sesión que intenta el cambio. */
  rol: MemberRol;
  /**
   * Head-count de members activos de la org (deleted_at IS NULL), INCLUYENDO al
   * OWNER. Define cuántos seats cobra Clínica (la base cubre al titular).
   */
  membersActivos: number;
  /** Estado de la suscripción, o null si nunca se creó. No afecta elegibilidad. */
  estadoSuscripcion: EstadoSuscripcion | null;
}

export interface DecideUpgradeResult {
  /** true si el cambio de tier procede (OWNER + INDEPENDIENTE→CLINICA). */
  elegible: boolean;
  /** Por qué NO es elegible (user-facing es-AR). undefined si elegible=true. */
  motivo?: string;
  /** Monto mensual (centavos) del tier ACTUAL, según pricing.ts. */
  montoAntes: number;
  /**
   * Monto mensual (centavos) que aplicaría como CLINICA con los seats actuales
   * (base incluye titular). Se computa siempre — también cuando no es elegible,
   * para poder mostrar el "a cuánto pasarías" en la UI si hiciera falta.
   */
  montoDespues: number;
}

/**
 * Decide elegibilidad + montos de un upgrade de tier. Pura, sin side effects.
 *
 * `montoDespues` SIEMPRE se calcula como CLINICA con los seats actuales — es el
 * precio de destino del upgrade, no del estado presente. `montoAntes` es el
 * precio del tier ACTUAL (para INDEPENDIENTE, el plan Solo vigente).
 */
export function decideUpgradeTipo(input: DecideUpgradeInput): DecideUpgradeResult {
  const montoAntes = computeMonthlyPriceCents(input.tipoActual, input.membersActivos);
  const montoDespues = computeMonthlyPriceCents("CLINICA", input.membersActivos);

  // Downgrade Clínica → Solo: NO self-serve. Se documenta "vía soporte".
  if (input.tipoActual === "CLINICA") {
    return {
      elegible: false,
      motivo: "Para volver al plan Individual, escribinos a soporte.",
      montoAntes,
      montoDespues,
    };
  }

  // A esta altura tipoActual === "INDEPENDIENTE". Solo el OWNER puede pagar el
  // cambio de plan.
  if (input.rol !== "OWNER") {
    return {
      elegible: false,
      motivo: "Solo el titular de la cuenta puede cambiar el plan.",
      montoAntes,
      montoDespues,
    };
  }

  return { elegible: true, montoAntes, montoDespues };
}
