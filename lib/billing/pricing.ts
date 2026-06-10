/**
 * Folio · pricing puro por tier (Fase C · tiers Solo/Clinic).
 *
 * Modelo de precios (decisión de usuario documentada en docs/PLAN.md §3):
 *   - Solo  (organization.tipo = INDEPENDIENTE): el plan único vigente
 *     (`MP_PLAN_PRICE_CENTS`, hoy ARS 30.000/mes).
 *   - Clinic (organization.tipo = CLINICA): base ARS 100.000/mes + ARS 25.000
 *     por seat adicional. SUPUESTO documentado en PLAN.md: la base cubre al
 *     OWNER; cada member activo adicional (cualquier rol, deleted_at IS NULL)
 *     cuenta como 1 seat.
 *
 * ⚠️ Este módulo es SOLO modelo/display (Fase C). El cobro real por seats
 * (PUT del preapproval de MP) es Fase E — acá NO se toca createPreapproval ni
 * el webhook. Hoy MP debita el plan vigente de `MP_PLAN_PRICE_CENTS`.
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

/** ARS 100.000 en centavos — base mensual del plan Clínica (cubre al OWNER). */
const CLINIC_BASE_PRICE_CENTS_DEFAULT = 10_000_000;
/** ARS 25.000 en centavos — por cada member activo adicional al OWNER. */
const CLINIC_SEAT_PRICE_CENTS_DEFAULT = 2_500_000;

function resolveCentsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`[pricing] ${name} inválido (${raw}); usando default ${fallback}.`);
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
 * `seatsActivos` = count de members activos de la org (deleted_at IS NULL),
 * incluyendo al OWNER. Valores no enteros se truncan; negativos cuentan 0.
 *
 *   INDEPENDIENTE          → MP_PLAN_PRICE_CENTS (los seats no aplican)
 *   CLINICA, 1 seat        → base
 *   CLINICA, N seats (N>1) → base + (N - 1) × seat
 */
export function computeMonthlyPriceCents(
  tipo: OrganizacionTipo,
  seatsActivos: number,
): number {
  if (tipo === "INDEPENDIENTE") return MP_PLAN_PRICE_CENTS;
  const seats = Math.max(0, Math.floor(seatsActivos));
  const extraSeats = Math.max(0, seats - 1);
  return resolveClinicBasePriceCents() + resolveClinicSeatPriceCents() * extraSeats;
}

export interface ClinicPriceBreakdown {
  /** Members activos contados (incluye OWNER). */
  seats: number;
  /** Seats cobrados además de la base = max(0, seats - 1). */
  extraSeats: number;
  basePriceCents: number;
  seatPriceCents: number;
  totalCents: number;
}

/** Desglose para display de billing (base + N adicionales = total). */
export function computeClinicBreakdownCents(seatsActivos: number): ClinicPriceBreakdown {
  const seats = Math.max(0, Math.floor(seatsActivos));
  const extraSeats = Math.max(0, seats - 1);
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
