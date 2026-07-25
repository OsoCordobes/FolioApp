/**
 * Folio · lectura batch de "esta cancelación la hizo el paciente" (M91).
 *
 * Gemela de `lib/db/confirmado-via.ts`, pero la fuente es el LOG, no una
 * columna del turno: M91 hace que las cancelaciones del paciente (1-click del
 * email y self-service del portal) queden con `transicion.trigger_origin =
 * 'paciente'`. Leer de ahí evita una columna espejo `turno.cancelado_via`, que
 * además el guard anti-tampering de M84 rechazaría en el path del portal
 * (compara la fila completa menos `estado`).
 *
 * RLS: `transicion_select_scoped` (M09) scopea vía un EXISTS sobre `turno`, así
 * que con el client del caller el staff ve exactamente las transiciones de los
 * turnos que ya puede ver. Fail-soft: el chip es cosmético, un error acá no
 * tumba la agenda.
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Devuelve el subconjunto de `turnoIds` cuya cancelación originó el paciente.
 * Ids sin fila, cancelados por staff o todavía no cancelados quedan afuera.
 * `[]` → `Set` vacío sin round-trip.
 */
export async function loadCanceladoPorPacienteIds(
  client: ServerClient,
  turnoIds: string[],
): Promise<Set<string>> {
  if (turnoIds.length === 0) return new Set();

  const { data, error } = await client
    .from("transicion")
    .select("turno_id")
    .in("turno_id", turnoIds)
    .eq("to_estado", "CANCELADO")
    .eq("trigger_origin", "paciente");

  if (error) {
    console.warn(`[turnos] cancelado_por_paciente batch falló: ${error.message}`);
    return new Set();
  }

  // La state machine (M09) no permite salir de CANCELADO, así que hay a lo sumo
  // una fila por turno — el Set igual deduplica sin costo.
  return new Set((data ?? []).map((row) => (row as { turno_id: string }).turno_id));
}
