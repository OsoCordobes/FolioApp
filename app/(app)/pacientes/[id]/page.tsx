/**
 * Folio · /pacientes/[id] (Server Component).
 *
 * Lee `paciente_completo` (M14) + últimas sesiones para construir la ficha.
 * Desencripta PII server-side, mapea a los shapes del Client Component
 * (`paciente` + `plan` + `cumple`) y los pasa por Context.
 *
 * Role gating:
 *   - ASISTENTE → redirige a /pacientes (la ficha contiene PHI sensible).
 *   - PROFESIONAL/DIRECTOR/OWNER/COORDINADOR colegiado → render completo.
 *   - COORDINADOR no colegiado → tab "Información" visible, "Plan/Sesiones"
 *     se gating en el cliente. Por ahora siempre se gating en server (todo o
 *     nada); refinamiento granular en sprint posterior.
 *
 * El permiso fino sobre `paciente` lo aplica RLS (caja_fuerte_profesional)
 * en la DB — esta función ya falla con not_found si no hay acceso.
 */

import { notFound, redirect } from "next/navigation";

import { PacienteDetalle } from "@/components/paciente/paciente-detalle";
import { getActiveContext } from "@/lib/db/active-context";
import { getPacienteFicha } from "@/lib/db/paciente-ficha";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const ROLES_PUEDEN_VER_PHI = new Set(["OWNER", "DIRECTOR", "PROFESIONAL", "COORDINADOR"]);

export default async function PacientePage({ params }: PageProps) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar la ficha: ${ctx.error.message}`);
  }

  if (!ROLES_PUEDEN_VER_PHI.has(ctx.data.session.role)) {
    redirect("/pacientes");
  }

  const { id } = await params;
  const data = await getPacienteFicha(id, ctx.data.organization.id);

  if (!data.ok) {
    if (data.error.code === "not_found") notFound();
    throw new Error(`Error cargando ficha: ${data.error.message}`);
  }

  return (
    <PacienteDetalle
      paciente={data.data.paciente}
      plan={data.data.plan}
      cumple={data.data.cumple}
      especialidad={ctx.data.organization.especialidad}
    />
  );
}
