/**
 * Folio · /calendario (Server Component).
 *
 * Query params:
 *   ?w=YYYY-MM-DD — lunes anchor de la semana a mostrar. Default: lunes de hoy.
 *   ?mes=YYYY-MM  — mes a mostrar en la vista mensual. Default: mes de hoy.
 *   ?vista=mes    — abre el calendario directo en la vista mensual (lo usa la
 *                   navegación de meses para preservar la pestaña activa).
 *   ?prof=uuid    — filtra la agenda al profesional indicado (modo clínica).
 *                   Solo lo honra un rol con actsAcrossProfessionals; un
 *                   PROFESIONAL ve SIEMPRE su propia agenda
 *                   (ver lib/agenda/profesional.ts).
 *
 * Los query params se validan (regex / pertenencia); cualquier valor mal
 * formado cae al default. La navegación (semanas/meses/profesional) usa
 * <Link href="?..." /> (SSR puro, sin client state global). Se fetchea tanto
 * la semana como el mes en cada request para que el toggle Semana/Mes (client
 * state) no requiera round-trip.
 */

import { Calendario } from "@/components/calendario/calendario";
import { resolveAgendaProfesional, type ProfesionalLite } from "@/lib/agenda/profesional";
import { capabilitiesFor } from "@/lib/auth/capabilities";
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
import { listProfesionalesLite } from "@/lib/db/members";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ w?: string; mes?: string; vista?: string; prof?: string }>;
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

  // ── Dimensión profesional (modo clínica) ──
  // Si la lectura de colegiados falla, degradamos al comportamiento histórico
  // (org-wide, sin selector) con un warn — nunca tiramos la agenda abajo.
  const profsRes = await listProfesionalesLite(ctx.data.organization.id);
  if (!profsRes.ok) {
    console.warn(`[calendario] listProfesionalesLite falló: ${profsRes.error.message}`);
  }
  const profesionales: ProfesionalLite[] = profsRes.ok ? profsRes.data : [];
  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  const { selectorVisible, profesionalIdEfectivo, mostrarAtribucion } = resolveAgendaProfesional({
    actsAcrossProfessionals: caps.actsAcrossProfessionals,
    sessionMemberId: ctx.data.session.memberId,
    profParam: params.prof ?? null,
    profesionales,
  });
  const profesionalesNombreById = mostrarAtribucion
    ? Object.fromEntries(profesionales.map((p) => [p.id, p.displayName]))
    : undefined;

  const [data, mesData] = await Promise.all([
    getCalendarioSemana({
      organizationId: ctx.data.organization.id,
      weekStartIso,
      timezone: tz,
      profesionalId: profesionalIdEfectivo,
      profesionalesNombreById,
    }),
    getCalendarioMes({
      organizationId: ctx.data.organization.id,
      monthIso,
      timezone: tz,
      profesionalId: profesionalIdEfectivo,
      profesionalesNombreById,
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
      diasCerrados={data.data.diasCerrados}
      capacidadDiaMin={data.data.capacidadDiaMin}
      weekRangeLabel={data.data.weekRangeLabel}
      hoyIso={data.data.hoyIso}
      nowHHMM={data.data.nowHHMM}
      weekStartIso={data.data.weekStartIso}
      prevWeekIso={prevWeekIso}
      nextWeekIso={nextWeekIso}
      hoyWeekStartIso={hoyWeekStartIso}
      initialVista={initialVista}
      organizationId={ctx.data.organization.id}
      mesGrid={mesData.data.grid}
      mesTurnos={mesData.data.turnos}
      mesPacientes={mesData.data.pacientes}
      mesLabel={formatMonthLabel(monthIso)}
      mesHoyIso={mesData.data.hoyIso}
      monthIso={monthIso}
      prevMonthIso={prevMonthIso}
      nextMonthIso={nextMonthIso}
      hoyMonthIso={hoyMonthIso}
      profesionales={selectorVisible ? profesionales : []}
      profActivo={selectorVisible ? profesionalIdEfectivo : null}
    />
  );
}
