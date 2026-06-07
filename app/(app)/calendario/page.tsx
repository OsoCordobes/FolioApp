/**
 * Folio · /calendario (Server Component).
 *
 * Query params:
 *   ?w=YYYY-MM-DD — lunes anchor de la semana a mostrar. Default: lunes de hoy.
 *   ?mes=YYYY-MM  — mes a mostrar en la vista mensual. Default: mes de hoy.
 *   ?vista=mes    — abre el calendario directo en la vista mensual (lo usa la
 *                   navegación de meses para preservar la pestaña activa).
 *
 * Los query params se validan (regex); cualquier valor mal formado cae al
 * default. La navegación (semanas/meses) usa <Link href="?..." /> (SSR puro,
 * sin client state global). Se fetchea tanto la semana como el mes en cada
 * request para que el toggle Semana/Mes (client state) no requiera round-trip.
 */

import { Calendario } from "@/components/calendario/calendario";
import { getActiveContext } from "@/lib/db/active-context";
import {
  formatMonthLabel,
  getCalendarioMes,
  getCalendarioSemana,
  getMondayOfWeekInTz,
  monthAnchorInTz,
  shiftMonth,
  shiftWeek,
} from "@/lib/db/calendario";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ w?: string; mes?: string; vista?: string }>;
}

export default async function CalendarioPage({ searchParams }: PageProps) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /calendario: ${ctx.error.message}`);
  }

  const tz = ctx.data.organization.timezone || "America/Argentina/Cordoba";
  const params = await searchParams;

  // ── Semana ──
  const requestedWeek = params.w && /^\d{4}-\d{2}-\d{2}$/.test(params.w) ? params.w : null;
  const weekStartIso = getMondayOfWeekInTz(requestedWeek, tz);
  const hoyWeekStartIso = getMondayOfWeekInTz(null, tz);
  const prevWeekIso = shiftWeek(weekStartIso, -1);
  const nextWeekIso = shiftWeek(weekStartIso, +1);

  // ── Mes ──
  const monthIso = monthAnchorInTz(params.mes ?? null, tz);
  const hoyMonthIso = monthAnchorInTz(null, tz);
  const prevMonthIso = shiftMonth(monthIso, -1);
  const nextMonthIso = shiftMonth(monthIso, +1);

  const initialVista = params.vista === "mes" ? "mes" : "semana";

  const [data, mesData] = await Promise.all([
    getCalendarioSemana({
      organizationId: ctx.data.organization.id,
      weekStartIso,
      timezone: tz,
    }),
    getCalendarioMes({
      organizationId: ctx.data.organization.id,
      monthIso,
      timezone: tz,
    }),
  ]);

  if (!data.ok) {
    throw new Error(`Error cargando calendario: ${data.error.message}`);
  }
  if (!mesData.ok) {
    throw new Error(`Error cargando vista mensual: ${mesData.error.message}`);
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
      initialVista={initialVista}
      mesGrid={mesData.data.grid}
      mesTurnos={mesData.data.turnos}
      mesPacientes={mesData.data.pacientes}
      mesLabel={formatMonthLabel(monthIso)}
      mesHoyIso={mesData.data.hoyIso}
      prevMonthIso={prevMonthIso}
      nextMonthIso={nextMonthIso}
      hoyMonthIso={hoyMonthIso}
    />
  );
}
