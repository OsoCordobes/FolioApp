/**
 * Folio · /pacientes (Server Component).
 *
 * Lista todos los pacientes de la org logueada usando la vista
 * `paciente_directorio_lite` (M14). Desencripta PII server-side y construye
 * el shape view-friendly para la tabla del directorio.
 *
 * El filtrado y la búsqueda libre son client-side sobre la lista cargada.
 * Para org con muchos pacientes (>500) habrá que paginar y filtrar en server;
 * por ahora el MVP no lo necesita.
 *
 * Query params:
 *   ?q=<texto> — preescribe la búsqueda inicial (viene del search del sidebar).
 */

import { PacientesDir } from "@/components/pacientes/pacientes-dir";
import { getActiveContext } from "@/lib/db/active-context";
import { getPacientesDirectorio } from "@/lib/db/pacientes-dir";
import { resolveEspecialidadEfectiva, type EspecialidadSlug } from "@/lib/especialidades/meta";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function PacientesPage({ searchParams }: PageProps) {
  const result = await getPacientesDirectorio();
  if (!result.ok) {
    throw new Error(`No se pudo cargar el directorio: ${result.error.message}`);
  }

  // Workstream 5 · especialidad EFECTIVA del usuario (member.especialidad ??
  // organization.especialidad) → decide qué campos avanzados muestra el alta. El
  // ActiveContext trae la de la org; la del member se lee acá por su memberId.
  // Si el contexto falla degradamos a quiropraxia (el modal igual nunca bloquea
  // el alta). En CLINICA el alta deja elegir la especialidad del intake avanzado.
  let especialidad: EspecialidadSlug = "quiropraxia";
  let permiteElegirEspecialidad = false;
  const ctx = await getActiveContext();
  if (ctx.ok) {
    const supabase = await createSupabaseServerClient();
    const { data: memberRow } = await supabase
      .from("member")
      .select("especialidad")
      .eq("id", ctx.data.session.memberId)
      .maybeSingle();
    especialidad = resolveEspecialidadEfectiva(
      (memberRow as { especialidad: string | null } | null)?.especialidad ?? null,
      ctx.data.organization.especialidad,
    );
    permiteElegirEspecialidad = ctx.data.organization.tipo === "CLINICA";
  }

  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  return (
    <PacientesDir
      pacientes={result.data}
      initialQuery={initialQuery}
      especialidad={especialidad}
      permiteElegirEspecialidad={permiteElegirEspecialidad}
    />
  );
}
