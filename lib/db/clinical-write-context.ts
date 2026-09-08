import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok } from "./errors";
import { resolveEspecialidadEfectiva } from "@/lib/especialidades/meta";
import { cordobaDate, instrumentPopulationEligibility } from "@/lib/instrumentos/population-policy";

/** Captured once before validation, then compared under database locks at commit.
 * This context is server-derived and is never accepted from the editor payload. */
export async function readClinicalWriteContext(client: SupabaseClient, organizationId: string, pacienteId: string, turno: {profesional_id: string|null; inicio: string}) {
 const [member,org,patient]=await Promise.all([
  turno.profesional_id ? client.from("member").select("especialidad").eq("id",turno.profesional_id).eq("organization_id",organizationId).maybeSingle() : Promise.resolve({data:null,error:null}),
  client.from("organization").select("especialidad").eq("id",organizationId).is("deleted_at",null).maybeSingle(),
  client.from("paciente").select("identidad_id,identidad:identidad_id(id,fecha_nacimiento,deleted_at)").eq("id",pacienteId).eq("organization_id",organizationId).is("deleted_at",null).maybeSingle(),
 ]);
 if(member.error||org.error||patient.error||!org.data||!patient.data||(turno.profesional_id&&!member.data))return err("forbidden","No pudimos verificar el contexto clínico actual. Conservá el borrador.");
 const identity=Array.isArray(patient.data.identidad)?patient.data.identidad[0]:patient.data.identidad;
 if(patient.data.identidad_id&&!identity)return err("forbidden","No pudimos verificar la identidad del paciente. Conservá el borrador.");
 const context={profesional_id:turno.profesional_id,inicio:turno.inicio,member_especialidad:member.data?.especialidad??null,organization_especialidad:org.data.especialidad??null,
  identity_id:patient.data.identidad_id??null,fecha_nacimiento:identity?.fecha_nacimiento??null,identity_deleted_at:identity?.deleted_at??null};
 const today=cordobaDate(new Date());
 const populationContext={fechaNacimiento:context.identity_deleted_at===null&&typeof context.fecha_nacimiento==="string"&&today&&context.fecha_nacimiento<=today?context.fecha_nacimiento:null,fechaAtencion:cordobaDate(turno.inicio)};
 return ok({context,specialty:resolveEspecialidadEfectiva(context.member_especialidad,context.organization_especialidad),population:{context:populationContext,...instrumentPopulationEligibility(populationContext)}});
}
