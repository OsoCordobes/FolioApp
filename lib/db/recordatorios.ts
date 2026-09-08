/**
 * Folio · helpers para `recordatorio_job` (cola de mensajes programados).
 *
 * Cuando un turno se crea/confirma, llamamos `scheduleRecordatoriosForTurno`
 * que crea las 2 filas (CONFIRMACION_24H y RECORDATORIO_2H) con
 * `scheduled_ts` = inicio - 24h / inicio - 2h. La UNIQUE (turno_id, tipo)
 * evita duplicados.
 *
 * M100 claims due work with a two-minute lease and a guarded completion RPC.
 * Provider acceptance is separate from delivered; expired/blocked work is terminal.
 *
 * POST_VISITA se schedulea aparte: cuando un turno transiciona a CERRADO,
 * scheduled_ts = closed_ts + 2h.
 */

import type { SendEmailResult } from "@/lib/email/client";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";

type RecordatorioTipo = "CONFIRMACION_24H" | "RECORDATORIO_2H" | "POST_VISITA";

/**
 * Decisión pura del claim CAS del dispatcher (espejo de `decidePedidoCas`
 * en lib/db/pedidos.ts). El claim se hace con un UPDATE guardado
 * (`.is('enviado_ts', null).eq('intentos', <valor leído>)`) que devuelve las
 * filas afectadas. Esta función traduce ese resultado a una decisión
 * testeable sin DB:
 *   - error de DB        → "db_error"
 *   - 0 filas            → "skip" (otra invocación lo claimeó o ya se envió)
 *   - exactamente 1 fila → "claimed"
 *   - >1 fila            → "claimed" (no debería pasar; el id es PK único)
 */
export function decideClaimRecordatorio(
  rowsAffected: number,
  hadError: boolean,
): "claimed" | "skip" | "db_error" {
  if (hadError) return "db_error";
  if (rowsAffected < 1) return "skip";
  return "claimed";
}

/** Synthetic fixtures never send externally; a compensated account is not a fixture. */
export function decideSkipRecordatorioOrgSintetica(
  isSynthetic: boolean | null | undefined,
): boolean {
  return isSynthetic === true;
}

/** Canal efectivo de un recordatorio — espejo del CHECK de M67. */
export type CanalRecordatorio = "whatsapp" | "email" | "ninguno";

/**
 * Decisión pura del canal de envío de un recordatorio (M67). Sin I/O — el
 * dispatcher la consulta en dos momentos:
 *
 *   1. ANTES de enviar (sin `resultadoWhatsApp`): con teléfono normalizable
 *      a E.164 la respuesta es "whatsapp" (canal primario); sin teléfono
 *      utilizable cae directo a "email" si hay email, o "ninguno".
 *   2. DESPUÉS de un envío WhatsApp fallido (`resultadoWhatsApp: "fallo"`):
 *      "email" si hay email para el fallback, "ninguno" si tampoco hay.
 *
 * Reglas:
 *   - WhatsApp OK → "whatsapp" (el fallback nunca pisa un éxito).
 *   - Sin teléfono válido, `resultadoWhatsApp` se ignora (no se pudo haber
 *     intentado WhatsApp sin destino) → email/ninguno según `emailPresente`.
 *   - "ninguno" = sin canal de contacto; el caller registra el error
 *     definitivo y consume presupuesto de intentos como siempre.
 */
export function decideCanalRecordatorio(input: {
  telefonoValido: boolean;
  emailPresente: boolean;
  resultadoWhatsApp?: "ok" | "fallo";
}): CanalRecordatorio {
  if (input.telefonoValido && input.resultadoWhatsApp !== "fallo") {
    return "whatsapp";
  }
  return input.emailPresente ? "email" : "ninguno";
}

/** Efecto de un intento de envío por email sobre la fila `recordatorio_job`. */
export interface MarcaEmailRecordatorio {
  /** true → setear enviado_ts (el job no se vuelve a pickear). */
  marcarEnviado: boolean;
  /** Texto para error_msg (null = envío real OK, sin nada que aclarar). */
  errorMsg: string | null;
}

/** Compatibility mapping: only provider acceptance marks enviado_ts; delivery remains unconfirmed. */
export function decideMarcaEmailRecordatorio(
  resultado: SendEmailResult,
): MarcaEmailRecordatorio {
  switch (resultado.status) {
    case "sent":
      return { marcarEnviado: true, errorMsg: null };
    case "simulated":
      return {
        marcarEnviado: false,
        errorMsg: "envío simulado (sin RESEND_API_KEY) — el paciente NO recibió el email",
      };
    case "blocked":
    case "queued":
    case "uncertain":
      return { marcarEnviado: false, errorMsg: resultado.detail };
    case "failed":
      return { marcarEnviado: false, errorMsg: `envío email falló: ${resultado.detail}` };
  }
}

interface ScheduleInput {
  organizationId: string;
  turnoId: string;
  inicio: Date;                                 // datetime del turno
}

/**
 * Schedulea CONFIRMACION_24H y RECORDATORIO_2H para un turno. Idempotente
 * gracias al UNIQUE (turno_id, tipo) — re-ejecutar es no-op.
 *
 * Si scheduled_ts ya pasó (turno reservado para muy pronto), igual lo crea
 * y el cron lo enviará en la próxima pasada (con un cap de "no enviar si
 * scheduled_ts es <30min en el pasado" en el dispatcher).
 */
export async function scheduleRecordatoriosForTurno(
  input: ScheduleInput,
): Promise<Result<void>> {
  const service = createSupabaseServiceClient();
  const rows = [
    {
      organization_id: input.organizationId,
      turno_id: input.turnoId,
      tipo: "CONFIRMACION_24H" satisfies RecordatorioTipo,
      scheduled_ts: new Date(input.inicio.getTime() - 24 * 60 * 60_000).toISOString(),
    },
    {
      organization_id: input.organizationId,
      turno_id: input.turnoId,
      tipo: "RECORDATORIO_2H" satisfies RecordatorioTipo,
      scheduled_ts: new Date(input.inicio.getTime() - 2 * 60 * 60_000).toISOString(),
    },
  ];

  const { error } = await service
    .from("recordatorio_job")
    .upsert(rows, { onConflict: "turno_id,tipo", ignoreDuplicates: true });

  if (error) {
    return err("db_error", "No se pudo programar los recordatorios.", error.message);
  }
  return ok(undefined);
}

/** Schedulea POST_VISITA para 2h después de un cierre de turno. */
export async function schedulePostVisitaForTurno(input: {
  organizationId: string;
  turnoId: string;
  closedAt: Date;
}): Promise<Result<void>> {
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("recordatorio_job")
    .upsert(
      {
        organization_id: input.organizationId,
        turno_id: input.turnoId,
        tipo: "POST_VISITA" satisfies RecordatorioTipo,
        scheduled_ts: new Date(input.closedAt.getTime() + 2 * 60 * 60_000).toISOString(),
      },
      { onConflict: "turno_id,tipo", ignoreDuplicates: true },
    );

  if (error) {
    return err("db_error", "No se pudo programar el post-visita.", error.message);
  }
  return ok(undefined);
}

/**
 * Cancela recordatorios pendientes de un turno (cuando se cancela/reagenda).
 * Retiene el historial y la frontera de envío incierto, también si el job tenía lease.
 */
export async function cancelRecordatoriosForTurno(turnoId: string): Promise<Result<void>> {
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("recordatorio_job")
    .update({ delivery_state: "terminal", error_msg: "appointment_cancelled", lease_token: null, lease_until: null })
    .eq("turno_id", turnoId)
    .is("enviado_ts", null);

  if (error) {
    return err("db_error", "No se pudo cancelar los recordatorios.", error.message);
  }
  return ok(undefined);
}
