/**
 * Folio · lectura batch de `turno.confirmado_via` (M90 · F7b).
 *
 * Los fetchers de agenda (/hoy, /calendario) leen la vista `turno_extendido`,
 * que NO expone `confirmado_via`: la vista se redefinió por última vez en M72
 * y M90 solo agregó la columna a la TABLA `turno` (este PR no escribe
 * migraciones, así que no puede redefinir la vista). Seleccionarla desde la
 * vista fallaría en runtime (42703) — el client `<any>` no lo detecta en
 * compile time.
 *
 * Solución: un SELECT batch directo a `turno` (columna verificada en
 * supabase/migrations/20260725000092_M90_…) con el client del caller — la RLS
 * de `turno` scopea igual que la vista (security_invoker). Fail-soft: el chip
 * "Confirmó el paciente" es cosmético; un error acá no tumba la agenda.
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";

import type { ConfirmadoVia } from "@/lib/types";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Devuelve `turno.id → confirmado_via` para los ids pedidos. Ids sin fila,
 * con valor NULL (filas pre-M90) o con valor desconocido no aparecen en el
 * mapa. `[]` → `{}` sin round-trip.
 */
export async function loadConfirmadoViaByTurnoId(
  client: ServerClient,
  turnoIds: string[],
): Promise<Record<string, ConfirmadoVia>> {
  if (turnoIds.length === 0) return {};

  const { data, error } = await client
    .from("turno")
    .select("id, confirmado_via")
    .in("id", turnoIds);

  if (error) {
    console.warn(`[turnos] confirmado_via batch falló: ${error.message}`);
    return {};
  }

  const out: Record<string, ConfirmadoVia> = {};
  for (const row of (data ?? []) as Array<{ id: string; confirmado_via: string | null }>) {
    if (row.confirmado_via === "paciente" || row.confirmado_via === "manual") {
      out[row.id] = row.confirmado_via;
    }
  }
  return out;
}
