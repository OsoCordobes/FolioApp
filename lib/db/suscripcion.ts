
import { safeLog } from "@/lib/observability/safe-log";
/**
 * Folio · helpers de datos para la suscripción mensual MP (M19).
 *
 * Capa entre el data layer y los handlers de la API/Server Actions:
 *   - loadSubscriptionForOrg()             · Server Components (RLS-aware, solo OWNER ve)
 *   - createOrRenewPendingSubscription()   · Server Action al iniciar activación
 *   - applySubscriptionUpdate()            · Webhook handler (service client, bypassa RLS)
 *   - recordChargeAttempt()                · Webhook handler — INSERT idempotente
 *   - cancelSubscription()                 · Cancelación manual + sync con el proveedor
 *   - syncSubscriptionAmount()             · Fase E: monto variable Clínica por seats
 *   - computeAccessGate()                  · Pura: decide si bloquear acceso a la app
 *
 * Las decisiones de estado son puras y se testean sin Supabase:
 *   - decideEstadoFromProvider()  · qué estado gana cuando el proveedor informa
 *                                   el suyo (MOROSA no se pisa con ACTIVA).
 *   - validateChargeAmount()      · si el monto de un cargo es aceptable.
 *
 * El proveedor de cobros se consume vía PaymentProvider (lib/payments) — este
 * módulo solo habla tipos de dominio (SubscriptionInfo / ChargeAttemptInfo).
 * Source of truth del estado: webhook del proveedor → DB. La UI solo lee.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

import {
  computeMonthlyPriceCents,
  resolveClinicBasePriceCents,
  resolveClinicSeatPriceCents,
  type OrganizacionTipo,
} from "@/lib/billing/pricing";
import {
  getPaymentProvider,
  type ChargeAttemptInfo,
  type SubscriptionInfo,
  type SubscriptionStatus,
} from "@/lib/payments";

import { runProviderOperation } from "@/lib/billing/provider-operations";

import { err, ok, type Result } from "./errors";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

// ─── Tipos públicos ────────────────────────────────────────────────────────

export type EstadoSuscripcion =
  | "PENDIENTE_ACTIVACION"
  | "ACTIVA"
  | "PAUSADA"
  | "CANCELADA"
  | "MOROSA";

export type EstadoCargo = "PENDIENTE" | "APROBADO" | "RECHAZADO" | "REFUNDED";

/**
 * Estado canónico de dominio (PaymentProvider) → enum de DB.
 * `PENDIENTE` del dominio se persiste como `PENDIENTE_ACTIVACION` (el nombre
 * histórico de M19 evita colisión semántica con el estado de cobro PENDIENTE).
 * El resto es identidad. Pura, exportada para tests.
 */
export function subscriptionStatusToEstado(status: SubscriptionStatus): EstadoSuscripcion {
  return status === "PENDIENTE" ? "PENDIENTE_ACTIVACION" : status;
}

/**
 * A2 (docs/AUDIT.md): estados que el cron de reconciliación re-chequea contra
 * MP. Cubre webhook perdido en ambas direcciones (activación que no llegó,
 * cancelación/pausa que no llegó). CANCELADA es terminal en MP — no se
 * reconcilia (un preapproval cancelado no revive; reactivar crea uno nuevo).
 */
export const RECONCILABLE_ESTADOS: readonly EstadoSuscripcion[] = [
  "PENDIENTE_ACTIVACION",
  "ACTIVA",
  "PAUSADA",
  "MOROSA",
];

export interface SuscripcionRow {
  id: string;
  organizationId: string;
  mpPreapprovalId: string | null;
  payerEmail: string;
  montoCents: number;
  moneda: string;
  estado: EstadoSuscripcion;
  fechaAlta: string;
  fechaActivacion: string | null;
  proximaCobro: string | null;
  ultimoCobroTs: string | null;
  ultimoError: string | null;
  fechaCancelacion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CargoRow {
  id: string;
  mpPaymentId: string;
  montoCents: number;
  estado: EstadoCargo;
  fechaIntento: string;
  fechaAcreditacion: string | null;
}

export interface AccessGate {
  /** true si la org puede usar la app normal. false → redirect a /configuracion/billing. */
  allowed: boolean;
  /** Razón por la que está bloqueada. null si allowed=true. */
  reason:
    | "grace_expired"
    | "subscription_cancelled"
    | "subscription_morosa_expired"
    | "subscription_paused"
    | null;
  /** Días que quedan de grace period si la suscripción aún no está activa. null si no aplica. */
  graceDaysLeft: number | null;
}

export const GRACE_PERIOD_DAYS = 30;

// ─── Row mapper ────────────────────────────────────────────────────────────

interface SuscripcionDbRow {
  id: string;
  organization_id: string;
  mp_preapproval_id: string | null;
  payer_email: string;
  monto_cents: number;
  moneda: string;
  estado: EstadoSuscripcion;
  fecha_alta: string;
  fecha_activacion: string | null;
  proxima_cobro: string | null;
  ultimo_cobro_ts: string | null;
  ultimo_error: string | null;
  fecha_cancelacion: string | null;
  created_at: string;
  updated_at: string;
}

function mapSuscripcion(row: SuscripcionDbRow): SuscripcionRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    mpPreapprovalId: row.mp_preapproval_id,
    payerEmail: row.payer_email,
    montoCents: row.monto_cents,
    moneda: row.moneda,
    estado: row.estado,
    fechaAlta: row.fecha_alta,
    fechaActivacion: row.fecha_activacion,
    proximaCobro: row.proxima_cobro,
    ultimoCobroTs: row.ultimo_cobro_ts,
    ultimoError: row.ultimo_error,
    fechaCancelacion: row.fecha_cancelacion,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * Lee la suscripción de la org. Usa service client (bypassa RLS) porque también
 * la llama el middleware (sin sesión de Supabase user context en algunos edges).
 * El gating de "solo OWNER ve billing" se hace a nivel de UI/route, no acá.
 */
export async function loadSubscriptionForOrg(
  organizationId: string,
): Promise<Result<SuscripcionRow | null>> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("suscripcion")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) return err("db_error", "Error leyendo suscripción.", error.message);
  return ok(data ? mapSuscripcion(data as SuscripcionDbRow) : null);
}

export async function loadRecentCharges(
  suscripcionId: string,
  limit = 12,
): Promise<Result<CargoRow[]>> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("cargo_suscripcion")
    .select("id, mp_payment_id, monto_cents, estado, fecha_intento, fecha_acreditacion")
    .eq("suscripcion_id", suscripcionId)
    .order("fecha_intento", { ascending: false })
    .limit(limit);

  if (error) return err("db_error", "Error leyendo historial de cargos.", error.message);
  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    mpPaymentId: r.mp_payment_id as string,
    montoCents: r.monto_cents as number,
    estado: r.estado as EstadoCargo,
    fechaIntento: r.fecha_intento as string,
    fechaAcreditacion: (r.fecha_acreditacion as string | null) ?? null,
  }));
  return ok(rows);
}

// ─── Pricing por org (Fase E · E2) ─────────────────────────────────────────

interface OrgExpectedAmount {
  tipo: OrganizacionTipo;
  /** Members activos (deleted_at IS NULL), incluyendo OWNER. 1 para INDEPENDIENTE (no aplica). */
  seats: number;
  /** Monto mensual esperado en centavos según tier + seats (computeMonthlyPriceCents). */
  expectedCents: number;
}

/**
 * Resuelve el monto mensual que corresponde cobrarle a la org HOY:
 * tipo (organization.tipo) + seats activos → computeMonthlyPriceCents.
 * Para INDEPENDIENTE no cuenta members (el precio no depende de seats) —
 * cero queries extra y cero cambio de comportamiento para el plan Solo.
 *
 * Consistencia: el count de seats NO es transaccional con el alta/baja del
 * member que disparó el sync (fire-and-forget). Trade-off aceptado: el PUT a
 * MP es idempotente (X-Idempotency-Key incluye el monto) y el cron
 * reconcile-suscripciones re-sincroniza cualquier carrera en ≤24 h.
 */
async function resolveExpectedAmountForOrg(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  organizationId: string,
): Promise<Result<OrgExpectedAmount>> {
  const { data: orgRow, error: orgErr } = await supabase
    .from("organization")
    .select("tipo")
    .eq("id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (orgErr) return err("db_error", "Error leyendo organización.", orgErr.message);
  if (!orgRow) return err("not_found", "Organización no encontrada o eliminada.");
  const tipo = (orgRow as { tipo: OrganizacionTipo }).tipo;

  let seats = 1;
  if (tipo === "CLINICA") {
    const { count, error: cntErr } = await supabase
      .from("member")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    if (cntErr) return err("db_error", "Error contando miembros activos.", cntErr.message);
    seats = count ?? 1;
  }

  return ok({ tipo, seats, expectedCents: computeMonthlyPriceCents(tipo, seats) });
}

// ─── Writes (Server Actions) ───────────────────────────────────────────────

export interface CreatePendingInput {
  organizationId: string;
  payerEmail: string;
  appUrl: string;          // base URL para back_url callback
}

/**
 * Crea (o re-genera) el preapproval en MP y persiste la fila local.
 *
 * Si ya existe una suscripción ACTIVA para la org, devuelve conflict.
 * Si existe en PENDIENTE_ACTIVACION o CANCELADA, la actualiza (no crea segunda fila —
 * la UNIQUE constraint lo impide de todos modos).
 *
 * "Volver a activar" (PAUSADA / MOROSA con período vencido / PENDIENTE a medias)
 * pisa `mp_preapproval_id` con el nuevo. Antes de eso hay que CANCELAR el
 * anterior en MP: si no, quedan dos preapprovals vivos sobre la misma tarjeta
 * (MP puede debitar los dos) y la DB pierde para siempre la referencia al
 * viejo — sus cargos llegan al webhook, no matchean ninguna fila y devuelven
 * 503 en loop. La cancelación debe confirmarse antes de iniciar otro preapproval.
 */
export async function createOrRenewPendingSubscription(
  input: CreatePendingInput,
): Promise<Result<{ subscription: SuscripcionRow; initPoint: string }>> {
  const supabase = createSupabaseServiceClient();
  const expected = await resolveExpectedAmountForOrg(supabase, input.organizationId);
  if (!expected.ok) return expected;
  try {
    const reserved = await supabase.rpc("billing_reserve_operation", {
      p_org: input.organizationId, p_kind: "create", p_amount: expected.data.expectedCents, p_email: input.payerEmail,
    });
    if (reserved.error || !reserved.data) return err("conflict", "Hay una operación de cobro pendiente de resolver.");
    const result = await runProviderOperation(reserved.data.id, {client:supabase,provider:getPaymentProvider(),appUrl:input.appUrl});
    if (!result.ok || !result.checkoutUrl) return err("network", "Estamos verificando la operación con Mercado Pago. Reintentá en unos minutos.");
    return ok({subscription:mapSuscripcion(result.row as unknown as SuscripcionDbRow),initPoint:result.checkoutUrl});
  } catch {
    return err("db_error", "No se pudo confirmar la operación de cobro.");
  }
}

/**
 * Cancelación manual disparada por el OWNER. Llama a MP + actualiza estado.
 * El webhook subsiguiente confirmará el cambio (idempotente con esto).
 */
export async function cancelSubscription(organizationId: string): Promise<Result<SuscripcionRow>> {
  const existing = await loadSubscriptionForOrg(organizationId);
  if (!existing.ok) return existing;
  if (!existing.data) return err("not_found", "No hay suscripción para cancelar.");
  const supabase=createSupabaseServiceClient();
  try {
    const reserved=await supabase.rpc("billing_reserve_operation",{p_org:organizationId,p_kind:"cancel",p_amount:existing.data.montoCents});
    if(reserved.error || !reserved.data)return err("conflict","Hay otra operación de cobro pendiente.");
    const result=await runProviderOperation(reserved.data.id,{client:supabase,provider:getPaymentProvider()});
    if(!result.ok)return err("network","La cancelación está pendiente de confirmación en Mercado Pago.");
    return ok(mapSuscripcion(result.row as unknown as SuscripcionDbRow));
  } catch {return err("db_error","No se pudo confirmar la cancelación.");}
}

// ─── Writes (Webhook) ──────────────────────────────────────────────────────

/**
 * Resultado de reconciliar el estado local con el que informa el proveedor.
 */
export interface EstadoReconciliado {
  estado: EstadoSuscripcion;
  /** true si se descartó un `ACTIVA` del proveedor para conservar MOROSA. */
  morosaPreservada: boolean;
}

/**
 * Pura: decide con qué estado se queda la fila cuando el proveedor informa el
 * suyo (webhook de preapproval, cron de reconciliación, refresh manual).
 *
 * Regla dura — **MOROSA solo sale por un cargo aprobado**:
 * MOROSA es un estado LOCAL, derivado de cargos rechazados; el proveedor no lo
 * conoce. Mientras MP reintenta el débito, su preapproval sigue `authorized`,
 * o sea que el reconcile traía "ACTIVA" y pisaba la morosidad: el moroso
 * recuperaba el acceso sin haber pagado un peso y el dunning (emails de
 * suspensión, episodio `morosa_desde`) quedaba roto. La única vía legítima
 * MOROSA→ACTIVA es `recordChargeAttempt` con un cargo APROBADO nuevo.
 *
 * El resto del tiempo el proveedor manda, porque es la fuente de verdad de lo
 * que existe de su lado: una MOROSA que MP pasó a `cancelled` (agotó los
 * reintentos) o a `paused` SÍ se escribe — son estados que solo él puede
 * informar y que no le regalan acceso a nadie.
 */
export function decideEstadoFromProvider(input: {
  estadoLocal: EstadoSuscripcion;
  estadoProveedor: EstadoSuscripcion;
}): EstadoReconciliado {
  if (input.estadoLocal === "MOROSA" && input.estadoProveedor === "ACTIVA") {
    return { estado: "MOROSA", morosaPreservada: true };
  }
  return { estado: input.estadoProveedor, morosaPreservada: false };
}

/**
 * Aplica un update de la suscripción que recibimos por webhook (o por lazy
 * reconcile / cron), ya mapeado a dominio por el PaymentProvider.
 * Idempotente: actualizar dos veces con el mismo payload deja la fila igual.
 *
 * La decisión de estado es `decideEstadoFromProvider` (pura, testeada): el
 * proveedor manda salvo que quiera resucitar una MOROSA.
 */
export async function applySubscriptionUpdate(
  info: SubscriptionInfo,
  client?: ServiceClient,
): Promise<Result<SuscripcionRow | null>> {
  try {
    const supabase = client ?? createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("billing_apply_subscription", { p_info: info });
    if (error) return err(error.code === "P0002" ? "not_found" : "db_error", "Error aplicando estado del proveedor.", error.message);
    return ok(data ? mapSuscripcion(data as SuscripcionDbRow) : null);
  } catch {
    return err("db_error", "No se pudo confirmar la operación de cobro.");
  }
}

export interface ChargeAmountCheck {
  /**
   * true si el cargo cuenta como pago legítimo de esta suscripción y por lo
   * tanto habilita la transición de estado (activación / recuperación).
   * false = sospechoso: el cargo se registra igual, pero NO mueve el estado.
   */
  aceptado: boolean;
  /** Texto para el log (y para `ultimo_error` si no se aceptó). Sin PII. */
  warning: string | null;
}

/** Redondeos de MP: hasta 1 centavo de desvío es ruido, no una anomalía. */
const TOLERANCIA_REDONDEO_CENTS = 1;

/**
 * true si la diferencia entre lo debitado y lo esperado se explica por un
 * cambio de equipo en una org CLINICA. El precio Clínica es
 * `base + (seats - 1) × seat` (computeMonthlyPriceCents), así que cualquier
 * alta/baja de integrantes mueve el monto en múltiplos EXACTOS del precio por
 * seat. Cuando se suma gente, `syncSubscriptionAmount` actualiza monto_cents y
 * el preapproval, pero el débito que MP ya tenía en curso sale con el monto
 * viejo: un pago perfectamente legítimo que llegaba "corto".
 *
 * Se exige que ambos montos cubran la base de Clínica para que la tolerancia
 * no toque al plan Solo (cuyo precio está muy por debajo de esa base).
 */
function esDesfasajePorSeats(input: { amountCents: number; expectedCents: number }): boolean {
  const baseCents = resolveClinicBasePriceCents();
  const seatCents = resolveClinicSeatPriceCents();
  if (seatCents <= 0) return false;
  if (input.expectedCents < baseCents || input.amountCents < baseCents) return false;
  const faltante = input.expectedCents - input.amountCents;
  return faltante > 0 && faltante % seatCents === 0;
}

/**
 * M-BILL-2 · Pura: valida moneda y monto de un cargo contra el monto esperado
 * de la suscripción de esa org (`suscripcion.monto_cents`). Exportada para
 * tests (tests/unit/suscripcion-sync.test.ts).
 *
 * Qué se acepta (y por qué): el objetivo de esta validación es no dejar que un
 * cargo ajeno o desprolijo active una suscripción, NO castigar al que pagó.
 * Un cliente que pagó y queda igual afuera de la app es el peor resultado
 * posible, así que solo se rechaza lo que no se puede explicar:
 *
 *   - moneda ≠ ARS                          → rechazado (no es nuestro cobro).
 *   - desvío ≤ 1 centavo                    → aceptado, sin warning.
 *   - debitaron de MÁS                      → aceptado con warning: la plata
 *     entró; el exceso es un problema de soporte, no motivo para bloquear.
 *   - debitaron de MENOS por múltiplos      → aceptado con warning: es el
 *     exactos del precio por seat            desfasaje de seats de Clínica
 *                                            (ver `esDesfasajePorSeats`).
 *   - cualquier otro faltante               → rechazado, va a `ultimo_error`
 *                                            para revisión manual.
 */
export function validateChargeAmount(input: {
  amountCents: number;
  currency: string;
  expectedCents: number;
}): ChargeAmountCheck {
  if (input.currency !== "ARS") {
    return {
      aceptado: false,
      warning: `Cargo en moneda inesperada (${input.currency}); esperado ARS.`,
    };
  }

  const desvio = input.amountCents - input.expectedCents;
  if (Math.abs(desvio) <= TOLERANCIA_REDONDEO_CENTS) {
    return { aceptado: true, warning: null };
  }

  const inesperado = `Monto inesperado (${input.amountCents / 100} ${input.currency}); esperado ${input.expectedCents / 100} ARS.`;

  if (desvio > 0) {
    return {
      aceptado: true,
      warning: `${inesperado} Se debitó de más: el cobro se acredita igual y queda para revisión manual.`,
    };
  }

  if (esDesfasajePorSeats(input)) {
    const seatsDeDiferencia = -desvio / resolveClinicSeatPriceCents();
    return {
      aceptado: true,
      warning: `${inesperado} Coincide con ${seatsDeDiferencia} integrante(s) de diferencia: el débito de Mercado Pago todavía no tomó el último cambio de equipo.`,
    };
  }

  return { aceptado: false, warning: inesperado };
}

/** Result of the complete transaction; scheduling is persisted by SQL, not the caller. */
export interface ChargeAttemptOutcome {
  /** null only for a scheduled attempt without a payment. */
  cargo: CargoRow | null;
  /** Whether this payment ID was newly inserted; later status changes may still apply. */
  isNewCharge: boolean;
  estadoAntes: EstadoSuscripcion;
  estadoDespues: EstadoSuscripcion;
  organizationId: string;
  payerEmail: string;
  montoMensualCents: number;
  mpPreapprovalId: string;
  morosaDesdeAntes: string | null;
}

/** Atomically persist a provider charge, authoritative transition and durable follow-up.
 * SQL owns locking, ordering, amount validation and retries. See M99 SQL behavior specs.
 * rawPayload remains accepted for compatibility but is deliberately never persisted.
 */
export async function recordChargeAttempt(
  input: { charge: ChargeAttemptInfo; rawPayload: unknown },
  client?: ServiceClient,
): Promise<Result<ChargeAttemptOutcome>> {
  try {
    const supabase = client ?? createSupabaseServiceClient();
    // Record charge, transition and follow-up in one transaction, without copying payloads.
    const charge = input.charge;
    const { data, error } = await supabase.rpc("billing_record_charge", {
      p_charge: {
        providerChargeId: charge.providerChargeId,
        providerSubscriptionId: charge.providerSubscriptionId,
        amountCents: charge.amountCents,
        currency: charge.currency,
        attemptDate: charge.attemptDate,
        lastModified: charge.lastModified ?? null,
        payment: charge.payment ? { paymentId: charge.payment.paymentId, status: charge.payment.status } : null,
      },
      p_clinic_base: resolveClinicBasePriceCents(),
      p_clinic_seat: resolveClinicSeatPriceCents(),
    });
    if (error) return err(error.code === "P0002" ? "not_found" : "db_error", "No se pudo guardar el cobro completo.", error.message);
    if (!data) return err("db_error", "El cobro no devolvió una confirmación durable.");
    return ok(data as ChargeAttemptOutcome);
  } catch {
    return err("db_error", "No se pudo confirmar la operación de cobro.");
  }
}

// ─── Sync de monto por seats (Fase E · E2) ─────────────────────────────────

export type SyncAmountSkipReason =
  | "org_independiente"
  | "sin_suscripcion"
  | "sin_preapproval"
  | "estado_no_elegible"
  | "monto_igual";

export type SyncAmountDecision =
  | { action: "skip"; reason: SyncAmountSkipReason }
  | { action: "sync"; fromCents: number; toCents: number };

/**
 * Pura (patrón computeAccessGate): decide si corresponde actualizar el monto
 * recurrente del proveedor para una org. Exportada para tests.
 *
 * Reglas:
 *   1. INDEPENDIENTE → NUNCA se toca, aunque monto_cents difiera del plan
 *      vigente (regla dura de Fase E: cero cambio de comportamiento para el
 *      plan Solo; una migración de precio Solo es un proceso manual aparte).
 *   2. Sin suscripción, o sin mp_preapproval_id → nada que sincronizar.
 *   3. Solo estados ACTIVA y MOROSA son elegibles: el preapproval existe y
 *      sigue debitando. PENDIENTE_ACTIVACION se resuelve re-activando (el
 *      preapproval se re-crea con el monto del tier actual); CANCELADA es
 *      terminal; PAUSADA no debita y MP puede rechazar el PUT.
 *   4. monto_cents ya igual al esperado → idempotente, no hay PUT.
 */
export function decideSubscriptionAmountSync(input: {
  tipo: OrganizacionTipo;
  /** Monto mensual esperado en centavos (computeMonthlyPriceCents con seats actuales). */
  expectedCents: number;
  subscription: Pick<SuscripcionRow, "estado" | "montoCents" | "mpPreapprovalId"> | null;
}): SyncAmountDecision {
  if (input.tipo === "INDEPENDIENTE") return { action: "skip", reason: "org_independiente" };
  if (!input.subscription) return { action: "skip", reason: "sin_suscripcion" };
  if (!input.subscription.mpPreapprovalId) return { action: "skip", reason: "sin_preapproval" };
  if (input.subscription.estado !== "ACTIVA" && input.subscription.estado !== "MOROSA") {
    return { action: "skip", reason: "estado_no_elegible" };
  }
  if (input.subscription.montoCents === input.expectedCents) {
    return { action: "skip", reason: "monto_igual" };
  }
  return {
    action: "sync",
    fromCents: input.subscription.montoCents,
    toCents: input.expectedCents,
  };
}

export interface SyncAmountOutcome {
  synced: boolean;
  /** Por qué NO se sincronizó (decisión skip). null si synced=true. */
  skippedReason: SyncAmountSkipReason | null;
  fromCents: number | null;
  toCents: number | null;
}

/** Reserve an immutable price intent, then observe/apply it through the provider saga.
 * A timeout retains its phase and blocks later price changes until the provider fact
 * is reconciled. Cron recovers unfinished operations independently of billing state.
 */
export async function syncSubscriptionAmount(
  organizationId: string,
): Promise<Result<SyncAmountOutcome>> {
  const supabase = createSupabaseServiceClient();

  const expected = await resolveExpectedAmountForOrg(supabase, organizationId);
  if (!expected.ok) return expected;

  const subRes = await loadSubscriptionForOrg(organizationId);
  if (!subRes.ok) return subRes;
  const sub = subRes.data;

  const decision = decideSubscriptionAmountSync({
    tipo: expected.data.tipo,
    expectedCents: expected.data.expectedCents,
    subscription: sub
      ? { estado: sub.estado, montoCents: sub.montoCents, mpPreapprovalId: sub.mpPreapprovalId }
      : null,
  });

  if (decision.action === "skip") {
    return ok({
      synced: false,
      skippedReason: decision.reason,
      fromCents: sub?.montoCents ?? null,
      toCents: expected.data.expectedCents,
    });
  }

  // Guard de narrowing: la decisión "sync" garantiza suscripción + preapproval.
  if (!sub?.mpPreapprovalId) {
    return ok({ synced: false, skippedReason: "sin_preapproval", fromCents: null, toCents: decision.toCents });
  }

  try {
    const reserved=await supabase.rpc("billing_reserve_operation",{p_org:organizationId,p_kind:"amount",p_amount:decision.toCents});
    if(reserved.error || !reserved.data)return err("conflict","Hay otra operación de cobro pendiente.");
    const result=await runProviderOperation(reserved.data.id,{client:supabase,provider:getPaymentProvider()});
    if(!result.ok)return err("network","El cambio de monto está pendiente de confirmación en Mercado Pago.");
    return ok({synced:true,skippedReason:null,fromCents:decision.fromCents,toCents:result.row.monto_cents as number});
  } catch {return err("db_error","No se pudo confirmar el cambio de monto.");}
}

/**
 * Versión fire-and-forget para los hooks de cambio de seats (aceptar/revivir
 * invitación, baja de member): JAMÁS rompe el flujo del caller — cualquier
 * error queda logueado y lo recupera el cron de reconciliación (o el botón
 * "Actualizar monto" de billing). El webhook de MP NO la llama (evita loops
 * PUT → webhook → PUT).
 */
export function syncSubscriptionAmountInBackground(organizationId: string, trigger: string): void {
  void syncSubscriptionAmount(organizationId)
    .then((res) => {
      if (!res.ok) {
        safeLog("warn", "lib.db.suscripcion.L630",
          { error: res.error },
        );
      }
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      safeLog("warn", "lib.db.suscripcion.L637", `[billing] sync monto (${trigger}) org=${organizationId} tiró: ${msg}`);
    });
}

// ─── Pure: gating decision ─────────────────────────────────────────────────

/**
 * Calcula si la org puede usar la app. Pura, testeable, sin side effects.
 *
 * Reglas (ver plan D5):
 *   1. ACTIVA → siempre permitido.
 *   2. MOROSA con proxima_cobro > now → permitido (sigue en periodo pagado).
 *   3. PAUSADA → bloqueado.
 *   4. CANCELADA con proxima_cobro > now → permitido (terminar ciclo pagado).
 *   5. PENDIENTE_ACTIVACION o sin suscripción:
 *       - si orgCreatedAt + GRACE_PERIOD_DAYS > now → permitido (grace).
 *       - si no → bloqueado.
 */
export function computeAccessGate(
  organizationCreatedAt: string,
  // Pick<> deliberado: la decisión solo lee estado + proximaCobro. Permite que
  // el cron de lifecycle (PR 1.2) evalúe el gate desde picks SQL angostos sin
  // fabricar SuscripcionRow completas. Los callers con la fila entera siguen
  // compilando sin cambios.
  subscription: Pick<SuscripcionRow, "estado" | "proximaCobro"> | null,
  now: Date = new Date(),
): AccessGate {
  // Caso 1: activa.
  if (subscription?.estado === "ACTIVA") {
    return { allowed: true, reason: null, graceDaysLeft: null };
  }

  // Caso 2 y 4: morosa o cancelada pero todavía en periodo pagado.
  if (
    subscription &&
    (subscription.estado === "MOROSA" || subscription.estado === "CANCELADA") &&
    subscription.proximaCobro &&
    new Date(subscription.proximaCobro).getTime() > now.getTime()
  ) {
    return { allowed: true, reason: null, graceDaysLeft: null };
  }

  // Caso 3: pausada → bloqueado. Razón propia (H-BILL-3): la copy de
  // subscription_morosa_expired dice "se canceló", que es incorrecto para PAUSADA.
  if (subscription?.estado === "PAUSADA") {
    return { allowed: false, reason: "subscription_paused", graceDaysLeft: null };
  }

  // Caso 5: pendiente o sin suscripción → grace period.
  const gracePeriodEnds =
    new Date(organizationCreatedAt).getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  const msLeft = gracePeriodEnds - now.getTime();
  if (msLeft > 0) {
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    return { allowed: true, reason: null, graceDaysLeft: daysLeft };
  }

  // Grace vencido.
  if (subscription?.estado === "CANCELADA") {
    return { allowed: false, reason: "subscription_cancelled", graceDaysLeft: 0 };
  }
  if (subscription?.estado === "MOROSA") {
    return { allowed: false, reason: "subscription_morosa_expired", graceDaysLeft: 0 };
  }
  return { allowed: false, reason: "grace_expired", graceDaysLeft: 0 };
}

/**
 * Path canónico de la pantalla de recuperación de cobro. Cualquier ruta bajo
 * este prefijo (la página + sus server actions) DEBE seguir siendo alcanzable
 * aunque el access gate bloquee el resto de la app — es donde el OWNER
 * refresca / repaga / cancela. Vive acá (no en el layout) para que la decisión
 * de gating sea pura y testeable.
 */
export const BILLING_RECOVERY_PATH = "/configuracion/billing";

/**
 * H-BILLING-1 · decide si el layout debe redirigir al usuario a la pantalla de
 * recuperación de cobro. Pura y testeable (la decisión NO puede vivir solo
 * inline en el layout: un dead-end de cobro deja al cliente pagando sin acceso
 * y sin forma de llegar a billing).
 *
 * Invariantes que garantiza:
 *   - `is_internal_account` (demo/comp/internal) nunca se gatea.
 *   - Si el gate permite el acceso, no se redirige.
 *   - **Billing es SIEMPRE alcanzable**: estando ya bajo el path de recuperación
 *     no se redirige (evita loop), incluso con el gate bloqueado por MOROSA con
 *     grace vencido, CANCELADA, PAUSADA o grace_expired. Es la pantalla donde el
 *     OWNER repaga/refresca/cancela; bloquearla sería un callejón sin salida.
 *
 * El match del path es robusto: normaliza trailing slash y query string, y
 * compara contra el prefijo canónico — así una `x-pathname` con cola
 * (`/configuracion/billing?gate=...`) o con barra final no rompe la excepción.
 * Si el pathname no se pudo determinar (header ausente), se trata como "no es
 * billing": el redirect manda a billing igual, que es el destino correcto y no
 * un loop (Next no re-redirige cuando origen y destino coinciden tras resolver).
 */
export function shouldGateToBilling(args: {
  isInternalAccount: boolean;
  accessGate: Pick<AccessGate, "allowed">;
  /** `x-pathname` del request (o "" si no se pudo leer). */
  pathname: string;
}): boolean {
  if (args.isInternalAccount) return false;
  if (args.accessGate.allowed) return false;
  return !isBillingRecoveryPath(args.pathname);
}

/**
 * true si `pathname` apunta a la pantalla de recuperación de cobro (o a una
 * ruta bajo ella). Tolera query string y trailing slash. Exportada para tests.
 */
export function isBillingRecoveryPath(pathname: string): boolean {
  // Descartar query/hash y normalizar trailing slash antes de comparar prefijo.
  const path = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  return path === BILLING_RECOVERY_PATH || path.startsWith(`${BILLING_RECOVERY_PATH}/`);
}

// Expose constants for tests.
export const __testing = { GRACE_PERIOD_DAYS };
