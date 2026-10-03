
import { safeLog } from "@/lib/observability/safe-log";
/**
 * Folio · pricing puro por tier (Fase C · tiers Solo/Clinic).
 *
 * Modelo de precios (decisión del titular, 2026-10-03):
 *   - Solo  (organization.tipo = INDEPENDIENTE): el plan único vigente
 *     (`MP_PLAN_PRICE_CENTS`, hoy ARS 30.000/mes).
 *   - Clinic (organization.tipo = CLINICA): base ARS 100.000/mes + ARS 25.000
 *     por profesional que atiende (member activo con es_colegiado=true).
 *     No hay plaza incluida: fijo + N profesionales. Los paneles de recepción,
 *     administración y del titular están incluidos; un titular que atiende
 *     cuenta como profesional.
 *
 * Desde Fase E (E2) este módulo es la fuente de verdad del COBRO REAL:
 * `createOrRenewPendingSubscription` crea el preapproval con este monto y
 * `syncSubscriptionAmount` lo ajusta cuando cambian los seats (solo CLINICA).
 * La validación de cada cargo compara contra `suscripcion.monto_cents` per-org.
 *
 * Overrides por env (mismo patrón warn-and-fallback que resolvePlanPriceCents
 * en lib/mercadopago/client.ts): CLINIC_BASE_PRICE_CENTS y
 * CLINIC_SEAT_PRICE_CENTS. Se resuelven en cada llamada (no al cargar el
 * módulo) para que los unit tests puedan setear process.env sin re-importar.
 *
 * Función pura y testeable (`tests/unit/clinic-pricing.test.ts`).
 */

import { MP_PLAN_PRICE_CENTS } from "@/lib/mercadopago/client";

export type OrganizacionTipo = "INDEPENDIENTE" | "CLINICA";

/** ARS 100.000 en centavos — fijo mensual del plan Clínica. */
const CLINIC_BASE_PRICE_CENTS_DEFAULT = 10_000_000;
/** ARS 25.000 en centavos — por cada profesional que atiende. */
const CLINIC_SEAT_PRICE_CENTS_DEFAULT = 2_500_000;

function resolveCentsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    safeLog("warn", "lib.billing.pricing.L39", `[pricing] ${name} inválido (${raw}); usando default ${fallback}.`);
    return fallback;
  }
  return parsed;
}

export function resolveClinicBasePriceCents(): number {
  return resolveCentsEnv("CLINIC_BASE_PRICE_CENTS", CLINIC_BASE_PRICE_CENTS_DEFAULT);
}

export function resolveClinicSeatPriceCents(): number {
  return resolveCentsEnv("CLINIC_SEAT_PRICE_CENTS", CLINIC_SEAT_PRICE_CENTS_DEFAULT);
}

/**
 * Precio mensual del plan en centavos ARS según tier.
 *
 * `seatsActivos` = profesionales que atienden (es_colegiado=true y
 * deleted_at IS NULL). Valores no enteros se truncan; negativos cuentan 0.
 *
 *   INDEPENDIENTE          → MP_PLAN_PRICE_CENTS (los seats no aplican)
 *   CLINICA, 0 profesionales → fijo
 *   CLINICA, N profesionales → fijo + N × precio por profesional
 */
export function computeMonthlyPriceCents(
  tipo: OrganizacionTipo,
  seatsActivos: number,
): number {
  if (tipo === "INDEPENDIENTE") return MP_PLAN_PRICE_CENTS;
  const seats = Math.max(0, Math.floor(seatsActivos));
  return resolveClinicBasePriceCents() + resolveClinicSeatPriceCents() * seats;
}

export interface ClinicPriceBreakdown {
  /** Profesionales activos que atienden. */
  seats: number;
  /** Profesionales cobrados además del fijo = seats, sin plaza incluida. */
  extraSeats: number;
  basePriceCents: number;
  seatPriceCents: number;
  totalCents: number;
}

/** Desglose para display de billing (base + N adicionales = total). */
export function computeClinicBreakdownCents(seatsActivos: number): ClinicPriceBreakdown {
  const seats = Math.max(0, Math.floor(seatsActivos));
  const extraSeats = seats;
  const basePriceCents = resolveClinicBasePriceCents();
  const seatPriceCents = resolveClinicSeatPriceCents();
  return {
    seats,
    extraSeats,
    basePriceCents,
    seatPriceCents,
    totalCents: basePriceCents + seatPriceCents * extraSeats,
  };
}
