/**
 * Folio · bloqueos manuales de agenda (vacaciones, congreso, licencia).
 *
 * Hasta D1 la tabla `bloqueo` (M09) SOLO la escribía el sync de Google, y ahí
 * los eventos de día completo se descartaban: no había ninguna forma de
 * marcar una ausencia dentro de Folio. Con `auto_confirmar_reservas` en true
 * (el default), cada paciente que reservaba durante las vacaciones del médico
 * quedaba CONFIRMADO.
 *
 * Este módulo es el camino manual: un rango [desde, hasta) → N filas de
 * `bloqueo` con origen='manual', una por día local (ver
 * lib/agenda/bloqueo-rango.ts: el CHECK bloqueo_duracion_valid corta en 1440'
 * y tanto la grilla como la disponibilidad filtran por `inicio` en rango).
 *
 * Permisos: la RLS de M09 es el gate real. `bloqueo_write_admin` deja
 * BORRAR/editar solo a OWNER/DIRECTOR o al dueño de la agenda; el INSERT
 * queda abierto a la org (recepción marca la ausencia del médico, que es el
 * flujo real del mostrador). Por eso el borrado detecta "0 filas afectadas" y
 * lo reporta como permiso insuficiente en vez de mentir un ok.
 */

import { z } from "zod";

import {
  MAX_SEGMENTOS_BLOQUEO,
  esFechaIso,
  partirRangoEnBloqueos,
  rangoDeDiasCompletos,
} from "@/lib/agenda/bloqueo-rango";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { decideProfesionalDestino } from "./profesional-destino";
import { getActiveSession } from "./session";

/** Título por defecto cuando no se escribe motivo (la grilla muestra esto). */
export const TITULO_BLOQUEO_DEFAULT = "Bloqueado";
const MAX_TITULO_LEN = 200;

const TZ_FALLBACK = "America/Argentina/Cordoba";

export const MSG_ELEGIR_PROFESIONAL_BLOQUEO =
  "Elegí de qué profesional es la ausencia.";
export const MSG_PROFESIONAL_INVALIDO_BLOQUEO =
  "El profesional elegido no es un profesional activo de tu organización.";

const crearBloqueoSchema = z.object({
  /**
   * "dias"  → `desde`/`hasta` son "YYYY-MM-DD" y `hasta` es INCLUSIVO
   *           (del 20 al 27 = el 27 también está de vacaciones). Las
   *           medianoches se resuelven en la timezone de la ORG, no en la del
   *           browser: el bloqueo tiene que tapar el día del consultorio.
   * "horas" → `desde`/`hasta` son ISO con offset y `hasta` es EXCLUSIVO.
   */
  modo: z.enum(["dias", "horas"]),
  desde: z.string().min(1).max(40),
  hasta: z.string().min(1).max(40),
  motivo: z.string().max(300).optional().nullable(),
  profesionalId: z.string().uuid().optional().nullable(),
});

export type CrearBloqueoInput = z.infer<typeof crearBloqueoSchema>;

export interface CrearBloqueoResult {
  /** Ids de las filas creadas — una por día local. */
  ids: string[];
  /** Días que cubre el bloqueo (= ids.length). */
  dias: number;
  /**
   * Turnos vivos que quedaron DENTRO del rango bloqueado. No los tocamos (el
   * bloqueo no cancela a nadie), pero la UI tiene que avisar para reagendar:
   * un bloqueo silencioso sobre turnos existentes es peor que no tenerlo.
   */
  turnosEnRango: number;
}

/** Timezone de la org activa (fallback al default de M02). */
async function orgTimezone(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("organization")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data?.timezone) return TZ_FALLBACK;
  return data.timezone as string;
}

export async function crearBloqueo(input: CrearBloqueoInput): Promise<Result<CrearBloqueoResult>> {
  const parsed = crearBloqueoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del bloqueo inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const timeZone = await orgTimezone(supabase, session.data.organizationId);

  // ── Profesional destino ───────────────────────────────────────────────────
  // Misma decisión pura que los turnos (param explícito > sesión colegiada >
  // exigir elección), con copy propio: acá no se agenda a nadie, se marca una
  // ausencia.
  const decision = decideProfesionalDestino({
    profesionalIdParam: parsed.data.profesionalId ?? null,
    sessionMemberId: session.data.memberId,
    sessionEsColegiado: session.data.esColegiado,
  });
  if (decision.kind === "faltante") {
    return err("validation", MSG_ELEGIR_PROFESIONAL_BLOQUEO);
  }
  if (decision.validar) {
    const { data: miembro, error: miembroErr } = await supabase
      .from("member")
      .select("id")
      .eq("id", decision.profesionalId)
      .eq("organization_id", session.data.organizationId)
      .eq("es_colegiado", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (miembroErr) {
      const mapped = mapSupabaseError(miembroErr);
      return err(mapped.code, mapped.message, miembroErr.message);
    }
    if (!miembro) return err("validation", MSG_PROFESIONAL_INVALIDO_BLOQUEO);
  }
  const profesionalId = decision.profesionalId;

  // ── Rango → tramos por día ────────────────────────────────────────────────
  const rango = resolverRango(parsed.data, timeZone);
  if (!rango.ok) return rango;

  const segmentos = partirRangoEnBloqueos({ ...rango.data, timeZone });
  if (segmentos.length === 0) {
    return err("validation", "El bloqueo tiene que terminar después de empezar.");
  }
  if (segmentos.length >= MAX_SEGMENTOS_BLOQUEO) {
    return err("validation", "El bloqueo no puede durar más de un año.");
  }

  const motivo = (parsed.data.motivo ?? "").trim().slice(0, MAX_TITULO_LEN);
  const titulo = motivo.length > 0 ? motivo : TITULO_BLOQUEO_DEFAULT;

  const { data, error } = await supabase
    .from("bloqueo")
    .insert(
      segmentos.map((seg) => ({
        organization_id: session.data.organizationId,
        profesional_id: profesionalId,
        inicio: new Date(seg.inicioMs).toISOString(),
        duracion_min: seg.duracionMin,
        titulo,
        origen: "manual",
      })),
    )
    .select("id");

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);

  // Turnos vivos que quedan dentro del rango: no se cancelan solos, pero la
  // UI tiene que decirlo (si no, el bloqueo tapa turnos ya prometidos).
  const { count, error: countErr } = await supabase
    .from("turno")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", session.data.organizationId)
    .eq("profesional_id", profesionalId)
    .in("estado", ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO"])
    .is("deleted_at", null)
    .gte("inicio", new Date(rango.data.desdeMs).toISOString())
    .lt("inicio", new Date(rango.data.hastaMs).toISOString());
  if (countErr) {
    // El bloqueo YA se creó: un conteo fallido no lo invalida.
    console.warn(`[bloqueos] conteo de turnos en rango falló: ${countErr.message}`);
  }

  return ok({ ids, dias: ids.length, turnosEnRango: count ?? 0 });
}

function resolverRango(
  input: CrearBloqueoInput,
  timeZone: string,
): Result<{ desdeMs: number; hastaMs: number }> {
  if (input.modo === "dias") {
    if (!esFechaIso(input.desde) || !esFechaIso(input.hasta)) {
      return err("validation", "Las fechas del bloqueo son inválidas.");
    }
    const rango = rangoDeDiasCompletos(input.desde, input.hasta, timeZone);
    if (!rango) {
      return err("validation", "La fecha de fin no puede ser anterior a la de inicio.");
    }
    return ok(rango);
  }
  const desdeMs = Date.parse(input.desde);
  const hastaMs = Date.parse(input.hasta);
  if (Number.isNaN(desdeMs) || Number.isNaN(hastaMs)) {
    return err("validation", "Las fechas del bloqueo son inválidas.");
  }
  if (hastaMs <= desdeMs) {
    return err("validation", "El bloqueo tiene que terminar después de empezar.");
  }
  return ok({ desdeMs, hastaMs });
}

/**
 * Borra UN tramo (un día) de un bloqueo manual. Los de origen='google' no se
 * tocan desde acá: los manda el calendar del profesional y el próximo sync
 * los volvería a crear — se sacan marcando el evento "Libre" o borrándolo en
 * Google.
 *
 * La RLS filtra (no falla) lo que el rol no puede borrar, así que 0 filas
 * afectadas significa "no existe o no te corresponde": lo reportamos, no lo
 * disfrazamos de éxito.
 */
export async function eliminarBloqueoManual(bloqueoId: string): Promise<Result<void>> {
  const parsed = z.string().uuid().safeParse(bloqueoId);
  if (!parsed.success) return err("validation", "Bloqueo inválido.");

  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bloqueo")
    .delete()
    .eq("id", parsed.data)
    .eq("organization_id", session.data.organizationId)
    .eq("origen", "manual")
    .select("id");

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }
  if (((data ?? []) as unknown[]).length === 0) {
    return err(
      "forbidden",
      "No se pudo quitar el bloqueo: solo la dirección o el propio profesional pueden hacerlo.",
    );
  }
  return ok(undefined);
}
