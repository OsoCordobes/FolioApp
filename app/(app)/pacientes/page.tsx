/** Bounded, exact-search directory; authorization and aggregation stay server-side. */
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
  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  const result = await getPacientesDirectorio({ query: initialQuery });
  if (!result.ok) {
    throw new Error("No se pudo cargar el directorio.");
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

  return (
    <PacientesDir
      initialPage={result.data}
      initialQuery={initialQuery}
      especialidad={especialidad}
      permiteElegirEspecialidad={permiteElegirEspecialidad}
    />
  );
}
