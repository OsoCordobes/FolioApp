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
 * El proveedor de cobros se consume vía PaymentProvider (lib/payments) — este
 * módulo solo habla tipos de dominio (SubscriptionInfo / ChargeAttemptInfo).
 * Source of truth del estado: webhook del proveedor → DB. La UI solo lee.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

import { computeMonthlyPriceCents, type OrganizacionTipo } from "@/lib/billing/pricing";
import {
  getPaymentProvider,
  type ChargeAttemptInfo,
  type CreateSubscriptionOutput,
  type SubscriptionInfo,
  type SubscriptionStatus,
} from "@/lib/payments";

import { err, isUniqueViolation, ok, type Result } from "./errors";

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

const GRACE_PERIOD_DAYS = 7;

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
 */
export async function createOrRenewPendingSubscription(
  input: CreatePendingInput,
): Promise<Result<{ subscription: SuscripcionRow; initPoint: string }>> {
  const supabase = createSupabaseServiceClient();

  // Si ya hay suscripción ACTIVA, no permitimos crear otra preapproval.
  const existing = await loadSubscriptionForOrg(input.organizationId);
  if (!existing.ok) return existing;
  if (existing.data && existing.data.estado === "ACTIVA") {
    return err("conflict", "Ya tenés una suscripción activa.");
  }

  // 1. Monto por tier (Fase E · E2): INDEPENDIENTE = plan vigente, idéntico a
  // siempre; CLINICA = base + seats activos AL MOMENTO de activar. Si los
  // seats cambian después, syncSubscriptionAmount ajusta el preapproval.
  const expected = await resolveExpectedAmountForOrg(supabase, input.organizationId);
  if (!expected.ok) return expected;
  const montoCents = expected.data.expectedCents;

  // 2. Crear la suscripción en el proveedor de cobros (hoy: MP preapproval).
  const provider = getPaymentProvider();
  let created: CreateSubscriptionOutput;
  try {
    created = await provider.createSubscription({
      payerEmail: input.payerEmail,
      externalReference: `org_${input.organizationId}`,
      backUrl: `${input.appUrl}/configuracion/billing?activation=ok`,
      amountCents: montoCents,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("network", "No se pudo iniciar el cobro en Mercado Pago.", msg);
  }

  // 3. Upsert local. UNIQUE(organization_id) garantiza una sola fila.
  // monto_cents es el monto que el preapproval va a debitar — la validación
  // de cada cargo (recordChargeAttempt) compara contra ESTE valor por-org.
  const upsertPayload = {
    organization_id: input.organizationId,
    mp_preapproval_id: created.subscription.providerSubscriptionId,
    payer_email: input.payerEmail,
    monto_cents: montoCents,
    moneda: "ARS",
    estado: subscriptionStatusToEstado(created.subscription.status),
    ultimo_error: null,
    fecha_cancelacion: null,
    // M-E: reseteamos el watermark monotónico (CR-3) al escribir un nuevo
    // mp_preapproval_id. Si no, applySubscriptionUpdate compararía el
    // last_modified del nuevo preapproval contra el del anterior y podría
    // descartar el evento `authorized` de la re-suscripción como stale.
    mp_last_modified: null,
  };
  const { data: upserted, error: upErr } = await supabase
    .from("suscripcion")
    .upsert(upsertPayload, { onConflict: "organization_id" })
    .select("*")
    .single();

  if (upErr) return err("db_error", "Error guardando suscripción.", upErr.message);

  return ok({
    subscription: mapSuscripcion(upserted as SuscripcionDbRow),
    initPoint: created.checkoutUrl,
  });
}

/**
 * Cancelación manual disparada por el OWNER. Llama a MP + actualiza estado.
 * El webhook subsiguiente confirmará el cambio (idempotente con esto).
 */
export async function cancelSubscription(
  organizationId: string,
): Promise<Result<SuscripcionRow>> {
  const existing = await loadSubscriptionForOrg(organizationId);
  if (!existing.ok) return existing;
  if (!existing.data) return err("not_found", "No hay suscripción para cancelar.");
  if (!existing.data.mpPreapprovalId) {
    return err("conflict", "La suscripción nunca fue activada en Mercado Pago.");
  }
  if (existing.data.estado === "CANCELADA") {
    return ok(existing.data);
  }

  try {
    await getPaymentProvider().cancelSubscription(existing.data.mpPreapprovalId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("network", "No se pudo cancelar en Mercado Pago.", msg);
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("suscripcion")
    .update({
      estado: "CANCELADA" as EstadoSuscripcion,
      fecha_cancelacion: new Date().toISOString(),
    })
    .eq("id", existing.data.id)
    .select("*")
    .single();

  if (error) return err("db_error", "Error actualizando suscripción.", error.message);
  return ok(mapSuscripcion(data as SuscripcionDbRow));
}

// ─── Writes (Webhook) ──────────────────────────────────────────────────────

/**
 * Aplica un update de la suscripción que recibimos por webhook (o por lazy
 * reconcile / cron), ya mapeado a dominio por el PaymentProvider.
 * Idempotente: actualizar dos veces con el mismo payload deja la fila igual.
 */
export async function applySubscriptionUpdate(
  info: SubscriptionInfo,
): Promise<Result<SuscripcionRow | null>> {
  const supabase = createSupabaseServiceClient();

  const newEstado = subscriptionStatusToEstado(info.status);

  // CR-3 (orden no monotónico): MP no garantiza el orden de entrega de los
  // webhooks. Leemos el estado actual + el último last_modified aplicado y
  // SOLO escribimos si el evento entrante es más nuevo. Así un `authorized`
  // stale/reenviado no resucita una suscripción CANCELADA.
  const { data: current, error: curErr } = await supabase
    .from("suscripcion")
    .select("fecha_activacion, mp_last_modified, estado")
    .eq("mp_preapproval_id", info.providerSubscriptionId)
    .maybeSingle();
  if (curErr) return err("db_error", "Error leyendo suscripción.", curErr.message);
  if (!current) return ok(null);

  const incomingModified = info.lastModified
    ? new Date(info.lastModified).getTime()
    : null;
  const storedModified =
    (current as { mp_last_modified?: string | null }).mp_last_modified
      ? new Date((current as { mp_last_modified: string }).mp_last_modified).getTime()
      : null;

  // Si tenemos un last_modified guardado y el entrante NO es estrictamente más
  // nuevo (o no trae last_modified), descartamos el evento como stale.
  if (storedModified !== null && (incomingModified === null || incomingModified <= storedModified)) {
    console.warn(
      `[mp] preapproval ${info.providerSubscriptionId}: evento stale descartado (incoming=${info.lastModified ?? "null"} <= stored).`,
    );
    // No tocamos la fila. Devolvemos null (no es un error; el caller solo loguea).
    return ok(null);
  }

  const patch: Record<string, unknown> = {
    estado: newEstado,
    proxima_cobro: info.nextChargeDate ?? null,
    mp_last_modified: info.lastModified ?? null,
  };
  if (newEstado === "ACTIVA") {
    // fecha_activacion solo se setea la primera vez (COALESCE en SQL no aplica
    // acá; lo manejamos leyendo y escribiendo si era null).
    if (!current.fecha_activacion) {
      patch.fecha_activacion = new Date().toISOString();
    }
  }
  if (newEstado === "CANCELADA") {
    patch.fecha_cancelacion = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("suscripcion")
    .update(patch)
    .eq("mp_preapproval_id", info.providerSubscriptionId)
    .select("*")
    .maybeSingle();

  if (error) return err("db_error", "Error aplicando update MP.", error.message);
  return ok(data ? mapSuscripcion(data as SuscripcionDbRow) : null);
}

/**
 * M-BILL-2 · Pura: valida moneda y monto de un cargo contra el monto esperado
 * de la suscripción de esa org (`suscripcion.monto_cents`). Tolerancia de
 * ±1 centavo (redondeos de MP). Devuelve el texto del warning (sin PII) o
 * null si el cargo es consistente. Exportada para tests
 * (tests/unit/suscripcion-sync.test.ts).
 */
export function validateChargeAmount(input: {
  amountCents: number;
  currency: string;
  expectedCents: number;
}): string | null {
  if (input.currency !== "ARS") {
    return `Cargo en moneda inesperada (${input.currency}); esperado ARS.`;
  }
  if (Math.abs(input.amountCents - input.expectedCents) > 1) {
    return `Monto inesperado (${input.amountCents / 100} ${input.currency}); esperado ${input.expectedCents / 100} ARS.`;
  }
  return null;
}

/**
 * Registra un intento de cobro recibido por webhook.
 * Idempotente vía UNIQUE(mp_payment_id) — INSERT que choca por conflict
 * se ignora silenciosamente y devolvemos la fila existente.
 */
export async function recordChargeAttempt(input: {
  charge: ChargeAttemptInfo;
  rawPayload: unknown;
}): Promise<Result<CargoRow | null>> {
  const supabase = createSupabaseServiceClient();

  const charge = input.charge;

  // Resolver suscripcion local por el ID de suscripción del proveedor.
  // monto_cents viene en el mismo SELECT: es el monto esperado de ESA org
  // (M-BILL-2 per-org, Fase E · E2).
  const { data: sus, error: susErr } = await supabase
    .from("suscripcion")
    .select("id, estado, monto_cents")
    .eq("mp_preapproval_id", charge.providerSubscriptionId)
    .maybeSingle();
  if (susErr) return err("db_error", "Error buscando suscripción.", susErr.message);
  // M-BILL-1: la suscripción puede no estar linkeada aún si el webhook de cargo
  // llega antes que el de preapproval. Devolvemos not_found para que el route
  // responda 5xx y MP reintente (no perdemos el primer cobro).
  if (!sus) return err("not_found", `Suscripción no existe para preapproval ${charge.providerSubscriptionId}.`);

  const currentEstado = (sus as { estado: EstadoSuscripcion }).estado;

  // Solo registramos cargos que ya tienen payment asociado. Los "scheduled" sin payment
  // todavía no son cobros — los ignoramos.
  if (!charge.payment) {
    return ok(null);
  }

  const mpPaymentId = charge.payment.paymentId;
  const estado = charge.payment.status;

  // M-BILL-2 (per-org desde Fase E · E2): validar moneda y monto contra
  // `suscripcion.monto_cents` de ESA org — que es lo que su preapproval debita
  // (plan Solo fijo o Clínica base+seats), no contra una constante global.
  // Un cargo en moneda distinta de ARS, o con un monto que se desvía más de 1
  // centavo del esperado, NO debe activar/recuperar la suscripción: lo
  // registramos pero marcamos warning para revisión manual.
  const montoCents = charge.amountCents;
  // Guard defensivo: una fila legacy con monto_cents NULL (no debería existir —
  // M19 lo crea NOT NULL y createOrRenewPendingSubscription siempre lo setea)
  // cae al precio del plan Solo: toda fila legacy es pre-tiers y por lo tanto
  // INDEPENDIENTE.
  const expectedMontoCents =
    (sus as { monto_cents: number | null }).monto_cents ??
    computeMonthlyPriceCents("INDEPENDIENTE", 1);
  const montoWarning = validateChargeAmount({
    amountCents: montoCents,
    currency: charge.currency,
    expectedCents: expectedMontoCents,
  });

  // INSERT idempotente. `select` + ausencia de error nos dice si creó fila nueva
  // (data presente) vs duplicado (23505 → data null). En duplicado SALTEAMOS la
  // mutación de estado de la suscripción (CR-4): re-entregas viejas no deben
  // pisar el estado actual.
  const { data: inserted, error: insErr } = await supabase
    .from("cargo_suscripcion")
    .insert({
      suscripcion_id: sus.id,
      mp_payment_id: mpPaymentId,
      mp_authorized_payment_id: charge.providerChargeId,
      monto_cents: montoCents,
      estado,
      // L-B: fecha_intento es NOT NULL. attemptDate puede venir null en
      // payloads de cobro rechazado (el provider ya cayó de debit_date a
      // date_created) → en última instancia, now. Un INSERT con null tiraría
      // 500 y MP reintentaría infinito.
      fecha_intento: charge.attemptDate ?? new Date().toISOString(),
      fecha_acreditacion: estado === "APROBADO" ? new Date().toISOString() : null,
      raw_payload: input.rawPayload as object,
    })
    .select("id")
    .maybeSingle();

  // 23505 = unique_violation → ya lo procesamos antes (idempotencia OK).
  // M5 (AUDIT.md): detectar el duplicado por SQLSTATE, no por substring del
  // mensaje — el texto puede cambiar entre versiones/locales de Postgres y un
  // duplicado legítimo se reportaría como db_error (MP reintentaría de gusto).
  if (insErr && !isUniqueViolation(insErr)) {
    return err("db_error", "Error registrando cargo.", insErr.message);
  }

  const isNewCharge = !insErr && !!inserted;

  // CR-4: solo mutamos el estado de la suscripción si el cargo es NUEVO. En una
  // re-entrega (duplicado) no tocamos nada — evita que un "rejected" reenviado
  // tire a MOROSA una org ya recuperada, o que un "approved" reenviado limpie un
  // ultimo_error legítimo.
  if (isNewCharge && estado === "APROBADO") {
    if (montoWarning) {
      // Cargo aprobado pero sospechoso: registramos el warning y NO marcamos ACTIVA.
      console.warn(`[mp] cargo ${mpPaymentId} aprobado pero ${montoWarning}`);
      await supabase
        .from("suscripcion")
        .update({
          ultimo_cobro_ts: new Date().toISOString(),
          ultimo_error: montoWarning,
        })
        .eq("id", sus.id);
    } else if (currentEstado === "MOROSA" || currentEstado === "PENDIENTE_ACTIVACION") {
      // Solo recuperación MOROSA->ACTIVA y activación pending->ACTIVA. NO forzamos
      // ACTIVA si la suscripción está CANCELADA o PAUSADA (CR-4).
      await supabase
        .from("suscripcion")
        .update({
          ultimo_cobro_ts: new Date().toISOString(),
          estado: "ACTIVA",
          ultimo_error: null,
        })
        .eq("id", sus.id);
    } else {
      // ACTIVA u otro estado terminal: solo registramos el cobro, sin forzar estado.
      await supabase
        .from("suscripcion")
        .update({
          ultimo_cobro_ts: new Date().toISOString(),
          ultimo_error: null,
        })
        .eq("id", sus.id);
    }
  } else if (isNewCharge && estado === "RECHAZADO") {
    await supabase
      .from("suscripcion")
      .update({
        estado: "MOROSA",
        ultimo_error: charge.payment.statusDetail ?? "Cobro rechazado por Mercado Pago.",
      })
      .eq("id", sus.id);
  }

  const { data: cargoRow } = await supabase
    .from("cargo_suscripcion")
    .select("id, mp_payment_id, monto_cents, estado, fecha_intento, fecha_acreditacion")
    .eq("mp_payment_id", mpPaymentId)
    .single();

  if (!cargoRow) return ok(null);
  return ok({
    id: cargoRow.id as string,
    mpPaymentId: cargoRow.mp_payment_id as string,
    montoCents: cargoRow.monto_cents as number,
    estado: cargoRow.estado as EstadoCargo,
    fechaIntento: cargoRow.fecha_intento as string,
    fechaAcreditacion: (cargoRow.fecha_acreditacion as string | null) ?? null,
  });
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

/**
 * Sincroniza el monto recurrente del proveedor con el tier + seats actuales
 * de la org. Orquestación pura: lee tipo + members activos + suscripción,
 * decide con `decideSubscriptionAmountSync` y, si corresponde, hace
 * provider.updateSubscriptionAmount (PUT preapproval) + UPDATE monto_cents.
 *
 * Idempotente: si el monto ya coincide no toca MP ni la DB; repetirla con el
 * mismo estado es no-op.
 *
 * Orden de escritura: MP PRIMERO, fila local después. Si el PUT a MP falla,
 * la fila local queda con el monto viejo (consistente con lo que MP va a
 * debitar) y devolvemos err — el caller NO debe romper su flujo (los hooks de
 * seats la llaman fire-and-forget): el cron de reconciliación re-intenta el
 * sync en la próxima corrida y el OWNER también puede dispararlo desde
 * /configuracion/billing ("Actualizar monto"). Si en cambio falla el UPDATE
 * local post-PUT, el próximo sync detecta la diferencia y re-emite el PUT
 * (mismo valor → idempotente en MP) antes de reparar la fila.
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
    await getPaymentProvider().updateSubscriptionAmount(sub.mpPreapprovalId, decision.toCents);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("network", "No se pudo actualizar el monto de la suscripción en Mercado Pago.", msg);
  }

  const { error: updErr } = await supabase
    .from("suscripcion")
    .update({ monto_cents: decision.toCents })
    .eq("id", sub.id);
  if (updErr) {
    // MP ya quedó con el monto nuevo; el próximo sync repara la fila (ver doc).
    return err(
      "db_error",
      "El monto se actualizó en Mercado Pago pero no en la base; se repara en el próximo sync.",
      updErr.message,
    );
  }

  // Log estructurado sin PII (ids internos + montos, nunca email/nombres).
  console.log(
    `[billing] monto sync org=${organizationId} suscripcion=${sub.id} tipo=${expected.data.tipo} seats=${expected.data.seats} antes=${decision.fromCents} despues=${decision.toCents}`,
  );

  return ok({
    synced: true,
    skippedReason: null,
    fromCents: decision.fromCents,
    toCents: decision.toCents,
  });
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
        console.warn(
          `[billing] sync monto (${trigger}) org=${organizationId} falló: ${res.error.message}`,
        );
      }
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[billing] sync monto (${trigger}) org=${organizationId} tiró: ${msg}`);
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
 *       - si orgCreatedAt + 7d > now → permitido (grace).
 *       - si no → bloqueado.
 */
export function computeAccessGate(
  organizationCreatedAt: string,
  subscription: SuscripcionRow | null,
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
