import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cordobaDate,
  instrumentPopulationEligibility,
  POPULATION_BLOCK_MESSAGE,
} from "@/lib/instrumentos/population-policy";
import { err, ok } from "./errors";

/** Read DOB through the patient's actual identity and active tenant under RLS. */
export async function readInstrumentPopulation(
  client: SupabaseClient,
  pacienteId: string,
  organizationId: string,
  encounter: string | Date,
) {
  const { data, error } = await client
    .from("paciente")
    .select("id, identidad:identidad_id(fecha_nacimiento, deleted_at)")
    .eq("id", pacienteId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data)
    return err(
      "forbidden",
      "No pudimos verificar la población del instrumento para este paciente.",
    );
  const identity = Array.isArray(data.identidad)
    ? data.identidad[0]
    : data.identidad;
  const dob = identity?.deleted_at === null ? identity?.fecha_nacimiento : null;
  const today = cordobaDate(new Date());
  const context = {
    fechaNacimiento:
      typeof dob === "string" && today && dob <= today ? dob : null,
    fechaAtencion: cordobaDate(encounter),
  };
  return ok({ context, ...instrumentPopulationEligibility(context) });
}

export { POPULATION_BLOCK_MESSAGE };
