/**
 * Folio · writer del plan de tratamiento (M58).
 *
 * El card "Plan de tratamiento" de la ficha tenía el botón "Editar" como stub.
 * Esta función persiste los campos editables del plan en la tabla 1:1 por
 * paciente `plan_tratamiento` (M58) — genérica, sin nada específico de una
 * especialidad (eso vive en sesion.tool_data_cifrado).
 *
 * PHI: `diagnostico` y `notas` se cifran AES-256-GCM app-side (encryptColumn)
 * antes del upsert; el resto (sesiones objetivo, frecuencia, próximo control)
 * es no-PHI. Nunca se loguea el contenido.
 *
 * Tenancy: el upsert se ancla al `organization_id` de la sesión activa; RLS
 * (plan_tratamiento_insert/update_clinical, M58) + el trigger
 * plan_tratamiento_same_org_guard cubren tenancy y coherencia plan↔paciente.
 */

import { z } from "zod";

import { encryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

// ─── Schema Zod ─────────────────────────────────────────────────────────────

const savePlanTratamientoSchema = z.object({
  pacienteId: z.string().uuid(),
  // CHECK plan_tratamiento_sesiones_objetivo_valid: 0..1000 (o null).
  sesionesObjetivo: z.number().int().min(0).max(1000).nullable(),
  // CHECK plan_tratamiento_frecuencia_len: <= 60 (o null).
  frecuencia: z.string().max(60).nullable(),
  diagnostico: z.string().max(2000).nullable(),
  // Fecha 'YYYY-MM-DD' o null — la columna es `date`.
  proximoControl: z.string().date().nullable(),
  notas: z.string().max(5000).nullable(),
});

export type SavePlanTratamientoInput = z.infer<typeof savePlanTratamientoSchema>;

// ─── Upsert (1:1 por paciente) ───────────────────────────────────────────────

export async function savePlanTratamiento(
  input: SavePlanTratamientoInput,
): Promise<Result<{ id: string }>> {
  const parsed = savePlanTratamientoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del plan de tratamiento inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const d = parsed.data;

  // Upsert 1:1 por paciente_id (UNIQUE en M58). El organization_id va en cada
  // insert para que la RLS (org activa) y el trigger same-org validen la fila.
  const { data, error } = await supabase
    .from("plan_tratamiento")
    .upsert(
      {
        organization_id: session.data.organizationId,
        paciente_id: d.pacienteId,
        sesiones_objetivo: d.sesionesObjetivo,
        frecuencia: d.frecuencia,
        diagnostico_cifrado: encryptColumn(d.diagnostico ?? null),
        proximo_control: d.proximoControl || null,
        notas_cifrado: encryptColumn(d.notas ?? null),
      },
      { onConflict: "paciente_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    const mapped = error
      ? mapSupabaseError(error)
      : { code: "db_error" as const, message: "No se guardó el plan de tratamiento." };
    return err(mapped.code, mapped.message, error?.message);
  }

  return ok({ id: data.id });
}
