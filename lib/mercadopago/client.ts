/**
 * Folio · Mercado Pago REST client (Preapproval / Suscripciones).
 *
 * Wrapper directo sobre api.mercadopago.com (no usamos SDK oficial — la
 * superficie que necesitamos es chica: preapproval CRUD + GET authorized_payment).
 *
 * Modelo: Folio es merchant directo. El MP_ACCESS_TOKEN pertenece a Folio,
 * NO al profesional. El profesional autoriza una preapproval (suscripción
 * recurrente) que cobra 30.000 ARS/mes a la cuenta MP de Folio.
 *
 * Credenciales (Vercel env):
 *   - MP_ACCESS_TOKEN    — token de Folio (production)
 *   - MP_WEBHOOK_SECRET  — secret HMAC para validar webhooks (panel MP)
 *
 * Docs:
 *   - https://www.mercadopago.com.ar/developers/es/docs/subscriptions/landing
 *   - https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
 */

const API_BASE = "https://api.mercadopago.com";

/**
 * Precio del plan Folio en centavos ARS. Source of truth para crear preapproval.
 * Si cambia, también hay que actualizar:
 *   - NEXT_PUBLIC_MP_PLAN_PRICE_ARS (display)
 *   - suscripcion.monto_cents default en M19 (cosmético, no afecta runtime)
 *   - preapproval ya existentes en MP via PUT /preapproval/{id} (manual migration)
 */
export const MP_PLAN_PRICE_CENTS = 3000000;
export const MP_PLAN_PRICE_ARS = MP_PLAN_PRICE_CENTS / 100;
export const MP_PLAN_CURRENCY = "ARS";
export const MP_PLAN_REASON = "Folio - Plan Profesional";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} no configurada. Crear app en https://www.mercadopago.com.ar/developers/panel/app y setear en .env.local.`,
    );
  }
  return v;
}

interface MpApiError {
  message?: string;
  error?: string;
  status?: number;
  cause?: Array<{ code: string | number; description: string }>;
}

async function mpRequest<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const token = requireEnv("MP_ACCESS_TOKEN");
  const url = `${API_BASE}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    // MP recomienda X-Idempotency-Key en POST para evitar duplicados ante retry.
    headers["X-Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as MpApiError;
    const detail = json.cause?.[0]?.description ?? json.message ?? json.error ?? "unknown";
    throw new Error(`MP API ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

// ─── Preapproval (suscripción) ─────────────────────────────────────────────

export type MpPreapprovalStatus =
  | "pending"
  | "authorized"
  | "paused"
  | "cancelled"
  | "finished";

export interface MpPreapproval {
  id: string;
  status: MpPreapprovalStatus;
  init_point: string;
  preapproval_plan_id: string | null;
  payer_id: number | null;
  payer_email: string;
  back_url: string;
  external_reference: string | null;
  reason: string;
  date_created: string;
  last_modified: string;
  next_payment_date: string | null;
  auto_recurring: {
    frequency: number;
    frequency_type: "days" | "months";
    transaction_amount: number;
    currency_id: string;
    start_date?: string;
    end_date?: string;
  };
}

export interface CreatePreapprovalInput {
  payerEmail: string;
  externalReference: string;
  backUrl: string;
}

/**
 * Crea un preapproval "pending payments" (sin tokenizar tarjeta en frontend).
 * El usuario carga tarjeta en MP cuando lo redirigimos a init_point.
 *
 * Pasamos `status: "pending"` y MP devuelve un `init_point` al que redirigimos
 * el browser del usuario. Al volver, el webhook subscription_preapproval con
 * `status=authorized` confirma la activación.
 */
export async function createPreapproval(
  input: CreatePreapprovalInput,
): Promise<MpPreapproval> {
  const body = {
    reason: MP_PLAN_REASON,
    external_reference: input.externalReference,
    payer_email: input.payerEmail,
    auto_recurring: {
      frequency: 1,
      frequency_type: "months" as const,
      transaction_amount: MP_PLAN_PRICE_ARS,
      currency_id: MP_PLAN_CURRENCY,
    },
    back_url: input.backUrl,
    status: "pending" as const,
  };
  // Idempotency key con precisión de segundo: dos clicks accidentales del mismo
  // usuario dentro del mismo segundo colapsan a una sola preapproval (MP devuelve
  // la primera). Clicks separados por >=1s crean preapprovals independientes
  // (caso legítimo: usuario reintentó tras un error visible).
  const idemKey = `preapproval-${input.externalReference}-${Math.floor(Date.now() / 1000)}`;
  return mpRequest<MpPreapproval>("POST", "/preapproval", body, idemKey);
}

export async function getPreapproval(preapprovalId: string): Promise<MpPreapproval> {
  return mpRequest<MpPreapproval>("GET", `/preapproval/${preapprovalId}`);
}

export async function cancelPreapproval(preapprovalId: string): Promise<MpPreapproval> {
  return mpRequest<MpPreapproval>("PUT", `/preapproval/${preapprovalId}`, {
    status: "cancelled",
  });
}

export async function pausePreapproval(preapprovalId: string): Promise<MpPreapproval> {
  return mpRequest<MpPreapproval>("PUT", `/preapproval/${preapprovalId}`, {
    status: "paused",
  });
}

// ─── Authorized payment (cobro mensual recurrente) ─────────────────────────

export type MpAuthorizedPaymentStatus =
  | "scheduled"
  | "processed"
  | "rejected"
  | "recycling"
  | "cancelled";

export interface MpAuthorizedPayment {
  id: number;
  preapproval_id: string;
  status: MpAuthorizedPaymentStatus;
  // payment_id es el ID del payment final si status === "processed".
  // En "scheduled" o "rejected" puede ser null.
  payment: {
    id: number;
    status: "approved" | "rejected" | "in_process" | "refunded" | string;
    status_detail?: string;
  } | null;
  transaction_amount: number;
  currency_id: string;
  debit_date: string;
  date_created: string;
  last_modified: string;
}

export async function getAuthorizedPayment(
  authorizedPaymentId: string,
): Promise<MpAuthorizedPayment> {
  return mpRequest<MpAuthorizedPayment>(
    "GET",
    `/authorized_payments/${authorizedPaymentId}`,
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convierte el status de MP preapproval al enum interno de Folio (`estado_suscripcion`).
 * `pending` se mantiene como PENDIENTE_ACTIVACION (no como PENDIENTE) para evitar
 * colisión semántica con un estado de cobro.
 */
export function mapPreapprovalStatus(
  mpStatus: MpPreapprovalStatus,
): "PENDIENTE_ACTIVACION" | "ACTIVA" | "PAUSADA" | "CANCELADA" {
  switch (mpStatus) {
    case "pending":
      return "PENDIENTE_ACTIVACION";
    case "authorized":
      return "ACTIVA";
    case "paused":
      return "PAUSADA";
    case "cancelled":
    case "finished":
      return "CANCELADA";
  }
}
