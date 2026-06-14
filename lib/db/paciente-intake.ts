/**
 * Folio · writer del intake avanzado por especialidad (Workstream 5, M60).
 *
 * La sección "Información avanzada (opcional)" del alta de paciente y su modal de
 * edición en la ficha guardan acá un JSON cifrado por (paciente, especialidad).
 * Los campos dependen de la especialidad: el shape lo define
 * getIntakeAvanzadoConfig(especialidad).schema (lib/especialidades), que también
 * usa el form para renderizarse.
 *
 * PHI/PII: `datos` puede contener antecedentes clínicos y datos sensibles → se
 * valida server-side contra el schema de ESA especialidad (sea cual sea el valor
 * del cliente) y se cifra AES-256-GCM app-side (encryptColumn) antes del upsert.
 * Nunca se loguea el contenido.
 *
 * Tenancy: el upsert se ancla al organization_id de la sesión activa; RLS
 * (paciente_intake_avanzado_insert/update_clinical, M60) + el trigger
 * paciente_intake_avanzado_same_org_guard cubren tenancy y coherencia
 * intake↔paciente. El INSERT está gateado por user_role_in IN (OWNER, PROFESIONAL,
 * DIRECTOR) — mismo predicado que el INSERT clínico de paciente (M03), así un
 * DIRECTOR no colegiado que puede crear el paciente también puede cargar el intake.
 *
 * Convenciones espejadas de lib/db/plan-tratamiento.ts.
 */

import { z } from "zod";

import { encryptColumn } from "@/lib/crypto";
import {
  getIntakeAvanzadoConfig,
  isEspecialidadSlug,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

export interface SavePacienteIntakeAvanzadoInput {
  pacienteId: string;
  especialidad: EspecialidadSlug;
  /** Opaco acá: lo valida el schema zod de la especialidad antes de cifrar. */
  datos: Record<string, unknown>;
}

// El shape de `datos` lo valida el schema de la especialidad (dinámico): este
// schema solo cubre lo estructural común (uuid del paciente, slug conocido).
const baseSchema = z.object({
  pacienteId: z.string().uuid(),
  especialidad: z.string().refine(isEspecialidadSlug, "Especialidad desconocida."),
  datos: z.record(z.string(), z.unknown()),
});

/**
 * Upsert del intake avanzado (1 por paciente+especialidad, M60). Valida `datos`
 * contra el schema de la especialidad server-side; si no pasa, devuelve un err
 * de validación SIN tocar la DB. El JSON validado se cifra antes del upsert.
 */
export async function savePacienteIntakeAvanzado(
  input: SavePacienteIntakeAvanzadoInput,
): Promise<Result<{ id: string }>> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del intake avanzado inválidos.", parsed.error.message);
  }
  const especialidad = parsed.data.especialidad as EspecialidadSlug;

  // Validación específica de la especialidad (server-side, sea cual sea el valor
  // del cliente). El schema NO es .strict: claves desconocidas se stripean.
  const config = getIntakeAvanzadoConfig(especialidad);
  const datosParsed = config.schema.safeParse(parsed.data.datos);
  if (!datosParsed.success) {
    return err("validation", "Los datos avanzados no son válidos para esta especialidad.");
  }

  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Upsert 1:1 por (paciente_id, especialidad) (UNIQUE en M60). El JSON validado
  // se serializa y cifra app-side (PHI). organization_id va en cada insert para
  // que la RLS (org activa) y el trigger same-org validen la fila.
  const { data, error } = await supabase
    .from("paciente_intake_avanzado")
    .upsert(
      {
        organization_id: session.data.organizationId,
        paciente_id: parsed.data.pacienteId,
        especialidad,
        datos_cifrado: encryptColumn(JSON.stringify(datosParsed.data)),
      },
      { onConflict: "paciente_id,especialidad" },
    )
    .select("id")
    .single();

  if (error || !data) {
    const mapped = error
      ? mapSupabaseError(error)
      : { code: "db_error" as const, message: "No se guardó el intake avanzado." };
    return err(mapped.code, mapped.message, error?.message);
  }

  return ok({ id: data.id });
}
