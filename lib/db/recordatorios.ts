/**
 * Folio · helpers para `recordatorio_job` (cola de mensajes programados).
 *
 * Cuando un turno se crea/confirma, llamamos `scheduleRecordatoriosForTurno`
 * que crea las 2 filas (CONFIRMACION_24H y RECORDATORIO_2H) con
 * `scheduled_ts` = inicio - 24h / inicio - 2h. La UNIQUE (turno_id, tipo)
 * evita duplicados.
 *
 * El dispatcher F9 (/api/cron/dispatch-recordatorios) levanta los `enviado_ts
 * IS NULL AND scheduled_ts <= now() AND intentos < 5`, claimea cada job con
 * un CAS sobre `intentos` (incrementa al INICIAR el intento — ver
 * `decideClaimRecordatorio`) y los envía via WhatsApp Cloud (templates
 * aprobados en F6). Marca enviado_ts en éxito o error_msg en falla.
 *
 * POST_VISITA se schedulea aparte: cuando un turno transiciona a CERRADO,
 * scheduled_ts = closed_ts + 2h.
 */

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
 * No borra los ya enviados; solo deja sin efecto los pending.
 */
export async function cancelRecordatoriosForTurno(turnoId: string): Promise<Result<void>> {
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("recordatorio_job")
    .delete()
    .eq("turno_id", turnoId)
    .is("enviado_ts", null);

  if (error) {
    return err("db_error", "No se pudo cancelar los recordatorios.", error.message);
  }
  return ok(undefined);
}
