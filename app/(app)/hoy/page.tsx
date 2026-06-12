/**
 * Folio · /hoy — Dashboard del día (Server Component).
 *
 * Resuelve contexto (org + timezone), calcula "hoy" en zona horaria local,
 * lee `turno_extendido` + sesiones de la fecha, desencripta PII server-side
 * y pasa el shape view-friendly al Client Component `<Dashboard />`.
 *
 * Query params:
 *   ?prof=<memberId> — filtra la agenda al profesional indicado (modo
 *   clínica). Solo lo honra un rol con actsAcrossProfessionals; un
 *   PROFESIONAL ve SIEMPRE su propia agenda (ver lib/agenda/profesional.ts).
 */

import { resolveAgendaProfesional, type ProfesionalLite } from "@/lib/agenda/profesional";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { getActiveContext } from "@/lib/db/active-context";
import { fechaHoyEnTz, getDashboardHoy } from "@/lib/db/hoy";
import { listProfesionalesLite } from "@/lib/db/members";

import { Dashboard } from "@/components/hoy/dashboard";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ prof?: string }>;
}

export default async function HoyPage({ searchParams }: PageProps) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    // El layout padre ya gating; si llegamos acá, es db_error.
    throw new Error(`No se pudo cargar /hoy: ${ctx.error.message}`);
  }

  const timezone = ctx.data.organization.timezone || "America/Argentina/Buenos_Aires";
  const fechaIso = fechaHoyEnTz(timezone);
  const params = await searchParams;

  // Dimensión profesional (modo clínica). Si la lectura de colegiados falla,
  // degradamos al comportamiento histórico (org-wide, sin selector) con un
  // warn — nunca tiramos la agenda abajo por el filtro.
  const profsRes = await listProfesionalesLite();
  if (!profsRes.ok) {
    console.warn(`[hoy] listProfesionalesLite falló: ${profsRes.error.message}`);
  }
  const profesionales: ProfesionalLite[] = profsRes.ok ? profsRes.data : [];
  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  const { selectorVisible, profesionalIdEfectivo, mostrarAtribucion } = resolveAgendaProfesional({
    actsAcrossProfessionals: caps.actsAcrossProfessionals,
    sessionMemberId: ctx.data.session.memberId,
    profParam: params.prof ?? null,
    profesionales,
  });

  const data = await getDashboardHoy({
    organizationId: ctx.data.organization.id,
    fechaIso,
    timezone,
    profesionalId: profesionalIdEfectivo,
    profesionalesNombreById: mostrarAtribucion
      ? Object.fromEntries(profesionales.map((p) => [p.id, p.displayName]))
      : undefined,
  });

  if (!data.ok) {
    throw new Error(`Error cargando agenda: ${data.error.message}`);
  }

  return (
    <Dashboard
      initialTurnos={data.data.turnos}
      pacientes={data.data.pacientes}
      fechaIso={data.data.fechaIso}
      fechaLarga={data.data.fechaLarga}
      fechaAnio={data.data.fechaAnio}
      nowIso={new Date().toISOString()}
      timezone={timezone}
      organizationId={ctx.data.organization.id}
      profesionales={selectorVisible ? profesionales : []}
      profActivo={selectorVisible ? profesionalIdEfectivo : null}
    />
  );
}
