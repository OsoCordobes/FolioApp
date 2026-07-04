/**
 * Folio · registro claim-before-send de emails de lifecycle (M65).
 *
 * `recordEmailOnce` es el candado de idempotencia de los emails de ciclo de
 * vida de suscripción (lib/email/notify.ts): INSERTa en `email_notificacion`
 * ANTES de enviar. La UNIQUE(dedupe_key) de M65 es la garantía real:
 *
 *   - INSERT ok            → { inserted: true }  → el caller envía.
 *   - 23505 (dedupe choca) → { inserted: false } → skip silencioso: otro cron
 *     re-entrante / webhook reenviado ya claimeó este email. NO es un error.
 *   - cualquier otro error → err(db_error)       → el caller NO envía (sin
 *     claim confirmado preferimos un email faltante a uno duplicado).
 *
 * Trade-off documentado (at-most-once): si el envío falla DESPUÉS del claim,
 * el email no se reintenta. Aceptado para billing: todos estos emails tienen
 * un canal de recuperación (la UI de /configuracion/billing muestra el estado
 * real) y un duplicado de cobro/morosidad es peor que un faltante.
 *
 * Service-only, como el resto de los módulos de billing de lib/db: la tabla
 * es RLS deny-by-default y solo la opera service_role. El parámetro `client`
 * existe para inyectar un mock en tests (patrón findUserByEmail).
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

import { err, isUniqueViolation, ok, type Result } from "./errors";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export interface RecordEmailOnceInput {
  /** Clave de idempotencia, ej. `pago-fallido:{orgId}:{mpPaymentId}`. */
  dedupeKey: string;
  /** Tipo de email (trial_por_vencer, pago_fallido, ...). */
  tipo: string;
  organizationId: string;
  /** Email destino (payer_email del OWNER). */
  destinatario: string;
  /** Contexto no sensible para debug (montos, ids de payment, etc.). */
  meta?: Record<string, unknown> | null;
}

/**
 * Claim-before-send: reserva el derecho a enviar el email identificado por
 * `dedupeKey`. Devuelve `inserted: false` si ya estaba reservado (duplicado
 * benigno) — un cron re-entrante nunca duplica un envío.
 */
export async function recordEmailOnce(
  input: RecordEmailOnceInput,
  client?: ServiceClient,
): Promise<Result<{ inserted: boolean }>> {
  const supabase = client ?? createSupabaseServiceClient();

  const { error } = await supabase.from("email_notificacion").insert({
    organization_id: input.organizationId,
    tipo: input.tipo,
    dedupe_key: input.dedupeKey,
    destinatario: input.destinatario,
    meta: input.meta ?? null,
  });

  if (error) {
    // 23505 = otro proceso ya claimeó esta dedupe_key. Idempotencia OK.
    if (isUniqueViolation(error)) return ok({ inserted: false });
    return err("db_error", "Error registrando la notificación de email.", error.message);
  }
  return ok({ inserted: true });
}
