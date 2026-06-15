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

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { PacienteDetalle } from "@/components/paciente/paciente-detalle";
import { getActiveContext } from "@/lib/db/active-context";
import { getPacienteFicha } from "@/lib/db/paciente-ficha";
import {
  ESPECIALIDAD_OVERRIDE_COOKIE,
  isEspecialidadSlug,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

// COORDINADOR fuera: no tiene acceso clínico (la RLS le niega la ficha), así
// que dejarlo pasar la allowlist terminaba en 404 desde el data layer en vez de
// un redirect limpio a /pacientes (audit L6). No hay fuga PHI — es UX.
const ROLES_PUEDEN_VER_PHI = new Set(["OWNER", "DIRECTOR", "PROFESIONAL"]);

export default async function PacientePage({ params }: PageProps) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar la ficha: ${ctx.error.message}`);
  }

  if (!ROLES_PUEDEN_VER_PHI.has(ctx.data.session.role)) {
    redirect("/pacientes");
  }

  // Override de especialidad SOLO para cuentas internas (is_internal_account):
  // deja previsualizar cualquier ficha clínica sin tocar la config real ni crear
  // varias cuentas. Una org normal nunca lo honra aunque tenga la cookie seteada.
  let especialidadOverride: EspecialidadSlug | null = null;
  if (ctx.data.organization.isInternalAccount) {
    const raw = (await cookies()).get(ESPECIALIDAD_OVERRIDE_COOKIE)?.value;
    if (raw && isEspecialidadSlug(raw)) especialidadOverride = raw;
  }

  const { id } = await params;
  const data = await getPacienteFicha(
    id,
    ctx.data.organization.id,
    ctx.data.organization.especialidad,
    especialidadOverride,
  );

  if (!data.ok) {
    if (data.error.code === "not_found") notFound();
    throw new Error(`Error cargando ficha: ${data.error.message}`);
  }

  // M55 · especialidad ACTIVA del slot clínico: la EFECTIVA del profesional
  // del turno en curso (member.especialidad ?? org) — espejo de lo que el
  // writer deriva al guardar. Sin turno en curso, la de la org (histórico).
  // El override interno (si existe) manda sobre todo.
  const especialidad =
    especialidadOverride ??
    data.data.plan.turnoActivo?.especialidad ??
    ctx.data.organization.especialidad;

  return (
    <PacienteDetalle
      paciente={data.data.paciente}
      plan={data.data.plan}
      cumple={data.data.cumple}
      especialidad={especialidad}
      intakeAvanzado={data.data.intakeAvanzado}
    />
  );
}
