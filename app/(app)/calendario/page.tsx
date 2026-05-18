/**
 * Folio · /calendario (Server Component).
 *
 * Query params:
 *   ?w=YYYY-MM-DD — lunes anchor de la semana a mostrar. Default: lunes de hoy.
 *
 * El query param se valida (regex YYYY-MM-DD); cualquier valor mal formado
 * cae al lunes-de-hoy. La navegación entre semanas usa links <Link href="?w=..." />
 * (SSR puro, sin client state, sin push global).
 */

import { Calendario } from "@/components/calendario/calendario";
import { getActiveContext } from "@/lib/db/active-context";
import { getCalendarioSemana, getMondayOfWeekInTz, shiftWeek } from "@/lib/db/calendario";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ w?: string }>;
}

export default async function CalendarioPage({ searchParams }: PageProps) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /calendario: ${ctx.error.message}`);
  }

  const tz = ctx.data.organization.timezone || "America/Argentina/Cordoba";
  const params = await searchParams;
  const requestedWeek = params.w && /^\d{4}-\d{2}-\d{2}$/.test(params.w) ? params.w : null;
  const weekStartIso = getMondayOfWeekInTz(requestedWeek, tz);
  const hoyWeekStartIso = getMondayOfWeekInTz(null, tz);
  const prevWeekIso = shiftWeek(weekStartIso, -1);
  const nextWeekIso = shiftWeek(weekStartIso, +1);

  const data = await getCalendarioSemana({
    organizationId: ctx.data.organization.id,
    weekStartIso,
    timezone: tz,
  });

  if (!data.ok) {
    throw new Error(`Error cargando calendario: ${data.error.message}`);
  }

  return (
    <Calendario
      turnos={data.data.turnos}
      bloqueos={data.data.bloqueos}
      pedidos={data.data.pedidos}
      pacientes={data.data.pacientes}
      weekDates={data.data.weekDates}
      weekRangeLabel={data.data.weekRangeLabel}
      hoyIso={data.data.hoyIso}
      nowHHMM={data.data.nowHHMM}
      weekStartIso={data.data.weekStartIso}
      prevWeekIso={prevWeekIso}
      nextWeekIso={nextWeekIso}
      hoyWeekStartIso={hoyWeekStartIso}
    />
  );
}
