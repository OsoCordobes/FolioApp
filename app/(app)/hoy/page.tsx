/**
 * Folio · /hoy — Dashboard del día (Server Component).
 *
 * Resuelve contexto (org + timezone), calcula "hoy" en zona horaria local,
 * lee `turno_extendido` + sesiones de la fecha, desencripta PII server-side
 * y pasa el shape view-friendly al Client Component `<Dashboard />`.
 */

import { getActiveContext } from "@/lib/db/active-context";
import { fechaHoyEnTz, getDashboardHoy } from "@/lib/db/hoy";

import { Dashboard } from "@/components/hoy/dashboard";

export const dynamic = "force-dynamic";

export default async function HoyPage() {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    // El layout padre ya gating; si llegamos acá, es db_error.
    throw new Error(`No se pudo cargar /hoy: ${ctx.error.message}`);
  }

  const timezone = ctx.data.organization.timezone || "America/Argentina/Buenos_Aires";
  const fechaIso = fechaHoyEnTz(timezone);

  const data = await getDashboardHoy({
    organizationId: ctx.data.organization.id,
    fechaIso,
    timezone,
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
    />
  );
}
