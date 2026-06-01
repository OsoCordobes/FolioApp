/**
 * Folio · helpers de datos para la suscripción mensual MP (M19).
 *
 * Capa entre el data layer y los handlers de la API/Server Actions:
 *   - loadSubscriptionForOrg()      · Server Components (RLS-aware, solo OWNER ve)
 *   - createPendingSubscription()   · Server Action al iniciar activación
 *   - markSubscriptionFromMp()      · Webhook handler (service client, bypassa RLS)
 *   - recordChargeAttempt()         · Webhook handler — INSERT idempotente
 *   - markSubscriptionCancelled()   · Cancelación manual + sync con MP
 *   - computeAccessGate()           · Pura: decide si bloquear acceso a la app
 *
 * Source of truth del estado: MP webhook → DB. La UI solo lee.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

import {
  cancelPreapproval,
  createPreapproval,
  mapPreapprovalStatus,
  MP_PLAN_PRICE_CENTS,
  type MpAuthorizedPayment,
  type MpPreapproval,
} from "@/lib/mercadopago/client";

import { err, ok, type Result } from "./errors";

// ─── Tipos públicos ────────────────────────────────────────────────────────

export type EstadoSuscripcion =
  | "PENDIENTE_ACTIVACION"
  | "ACTIVA"
  | "PAUSADA"
  | "CANCELADA"
  | "MOROSA";

export type EstadoCargo = "PENDIENTE" | "APROBADO" | "RECHAZADO" | "REFUNDED";

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

  // 1. Crear preapproval en MP.
  let preapproval: MpPreapproval;
  try {
    preapproval = await createPreapproval({
      payerEmail: input.payerEmail,
      externalReference: `org_${input.organizationId}`,
      backUrl: `${input.appUrl}/configuracion/billing?activation=ok`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("network", "No se pudo iniciar el cobro en Mercado Pago.", msg);
  }

  // 2. Upsert local. UNIQUE(organization_id) garantiza una sola fila.
  const upsertPayload = {
    organization_id: input.organizationId,
    mp_preapproval_id: preapproval.id,
    payer_email: input.payerEmail,
    monto_cents: MP_PLAN_PRICE_CENTS,
    moneda: "ARS",
    estado: mapPreapprovalStatus(preapproval.status),
    ultimo_error: null,
    fecha_cancelacion: null,
    // M-E: reseteamos el watermark monotónico (CR-3) al escribir un nuevo
    // mp_preapproval_id. Si no, applyMpPreapprovalUpdate compararía el
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
    initPoint: preapproval.init_point,
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
    await cancelPreapproval(existing.data.mpPreapprovalId);
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
 * Aplica un update de preapproval que recibimos por webhook (o por lazy reconcile).
 * Idempotente: actualizar dos veces con el mismo payload deja la fila igual.
 */
export async function applyMpPreapprovalUpdate(
  preapproval: MpPreapproval,
): Promise<Result<SuscripcionRow | null>> {
  const supabase = createSupabaseServiceClient();

  const newEstado = mapPreapprovalStatus(preapproval.status);

  // CR-3 (orden no monotónico): MP no garantiza el orden de entrega de los
  // webhooks. Leemos el estado actual + el último last_modified aplicado y
  // SOLO escribimos si el evento entrante es más nuevo. Así un `authorized`
  // stale/reenviado no resucita una suscripción CANCELADA.
  const { data: current, error: curErr } = await supabase
    .from("suscripcion")
    .select("fecha_activacion, mp_last_modified, estado")
    .eq("mp_preapproval_id", preapproval.id)
    .maybeSingle();
  if (curErr) return err("db_error", "Error leyendo suscripción.", curErr.message);
  if (!current) return ok(null);

  const incomingModified = preapproval.last_modified
    ? new Date(preapproval.last_modified).getTime()
    : null;
  const storedModified =
    (current as { mp_last_modified?: string | null }).mp_last_modified
      ? new Date((current as { mp_last_modified: string }).mp_last_modified).getTime()
      : null;

  // Si tenemos un last_modified guardado y el entrante NO es estrictamente más
  // nuevo (o no trae last_modified), descartamos el evento como stale.
  if (storedModified !== null && (incomingModified === null || incomingModified <= storedModified)) {
    console.warn(
      `[mp] preapproval ${preapproval.id}: evento stale descartado (incoming=${preapproval.last_modified ?? "null"} <= stored).`,
    );
    // No tocamos la fila. Devolvemos null (no es un error; el caller solo loguea).
    return ok(null);
  }

  const patch: Record<string, unknown> = {
    estado: newEstado,
    proxima_cobro: preapproval.next_payment_date ?? null,
    mp_last_modified: preapproval.last_modified ?? null,
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
    .eq("mp_preapproval_id", preapproval.id)
    .select("*")
    .maybeSingle();

  if (error) return err("db_error", "Error aplicando update MP.", error.message);
  return ok(data ? mapSuscripcion(data as SuscripcionDbRow) : null);
}

/**
 * Registra un intento de cobro recibido por webhook.
 * Idempotente vía UNIQUE(mp_payment_id) — INSERT que choca por conflict
 * se ignora silenciosamente y devolvemos la fila existente.
 */
export async function recordChargeAttempt(input: {
  preapprovalId: string;
  authorizedPayment: MpAuthorizedPayment;
  rawPayload: unknown;
}): Promise<Result<CargoRow | null>> {
  const supabase = createSupabaseServiceClient();

  // Resolver suscripcion local por preapprovalId.
  const { data: sus, error: susErr } = await supabase
    .from("suscripcion")
    .select("id, estado")
    .eq("mp_preapproval_id", input.preapprovalId)
    .maybeSingle();
  if (susErr) return err("db_error", "Error buscando suscripción.", susErr.message);
  // M-BILL-1: la suscripción puede no estar linkeada aún si el webhook de cargo
  // llega antes que el de preapproval. Devolvemos not_found para que el route
  // responda 5xx y MP reintente (no perdemos el primer cobro).
  if (!sus) return err("not_found", `Suscripción no existe para preapproval ${input.preapprovalId}.`);

  const currentEstado = (sus as { estado: EstadoSuscripcion }).estado;

  const ap = input.authorizedPayment;
  // Solo registramos cargos que ya tienen payment asociado. Los "scheduled" sin payment
  // todavía no son cobros — los ignoramos.
  if (!ap.payment) {
    return ok(null);
  }

  const mpPaymentId = String(ap.payment.id);
  const estado = mapPaymentStatus(ap.payment.status);

  // M-BILL-2: validar moneda y monto contra el plan canónico (MP_PLAN_PRICE_CENTS).
  // Un cargo en moneda distinta de ARS, o con un monto que se desvía más de 1
  // centavo del esperado, NO debe activar/recuperar la suscripción: lo
  // registramos pero marcamos warning para revisión manual.
  const montoCents = Math.round(ap.transaction_amount * 100);
  const currencyOk = ap.currency_id === "ARS";
  const amountOk = Math.abs(montoCents - MP_PLAN_PRICE_CENTS) <= 1;
  const montoWarning = !currencyOk
    ? `Cargo en moneda inesperada (${ap.currency_id}); esperado ARS.`
    : !amountOk
      ? `Monto inesperado (${montoCents / 100} ${ap.currency_id}); esperado ${MP_PLAN_PRICE_CENTS / 100} ARS.`
      : null;

  // INSERT idempotente. `select` + ausencia de error nos dice si creó fila nueva
  // (data presente) vs duplicado (23505 → data null). En duplicado SALTEAMOS la
  // mutación de estado de la suscripción (CR-4): re-entregas viejas no deben
  // pisar el estado actual.
  const { data: inserted, error: insErr } = await supabase
    .from("cargo_suscripcion")
    .insert({
      suscripcion_id: sus.id,
      mp_payment_id: mpPaymentId,
      mp_authorized_payment_id: String(ap.id),
      monto_cents: montoCents,
      estado,
      // L-B: fecha_intento es NOT NULL. ap.debit_date puede venir null en
      // payloads de cobro rechazado → un INSERT con null tiraría 500 y MP
      // reintentaría infinito. Caemos a date_created y, en última instancia, now.
      fecha_intento: ap.debit_date ?? ap.date_created ?? new Date().toISOString(),
      fecha_acreditacion: estado === "APROBADO" ? new Date().toISOString() : null,
      raw_payload: input.rawPayload as object,
    })
    .select("id")
    .maybeSingle();

  // 23505 = unique_violation → ya lo procesamos antes (idempotencia OK).
  if (insErr && !insErr.message.includes("duplicate key")) {
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
        ultimo_error: ap.payment.status_detail ?? "Cobro rechazado por Mercado Pago.",
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

function mapPaymentStatus(mpStatus: string): EstadoCargo {
  switch (mpStatus) {
    case "approved":
      return "APROBADO";
    case "rejected":
      return "RECHAZADO";
    case "refunded":
      return "REFUNDED";
    default:
      return "PENDIENTE";
  }
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

// Expose constants for tests.
export const __testing = { GRACE_PERIOD_DAYS };
