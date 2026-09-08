import { z } from "zod";
import { decisionSchema, type DecisionMode } from "@/lib/consentimientos/decision";
import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveSession } from "./session";
import { err, ok } from "./errors";

const assessmentSchema = z.object({
  pacienteId:z.string().uuid(),plantillaId:z.string().uuid(),version:z.number().int().positive(),
  textoConfirmado:z.string().min(1).max(200000),vigenteHasta:z.string().datetime({offset:true}),
  decision:decisionSchema,
});
export interface AssessmentItem {id:string;modo:DecisionMode;createdAt:string;vigenteHasta:string;revocadoEn:string|null;fundamento:string;participacion:string;autorId:string;riesgo:string;version:number}
export async function createConsentAssessment(input:unknown){
  const parsed=assessmentSchema.safeParse(input);if(!parsed.success)return err("validation",parsed.error.issues[0]?.message??"Revisá la evaluación.");
  const session=await getActiveSession();if(!session.ok)return session;
  const client=await createSupabaseServerClient(),v=parsed.data;
  const {data,error}=await client.from("consentimiento_evaluacion").insert({organization_id:session.data.organizationId,paciente_id:v.pacienteId,
    plantilla_id:v.plantillaId,modo:v.decision.modo,riesgo:v.decision.riesgo,fundamento_cifrado:encryptColumn(v.decision.fundamento),
    participacion_cifrado:encryptColumn(v.decision.participacion),representante_id:v.decision.tutorId,texto_snapshot:v.textoConfirmado,
    version_snapshot:v.version,tipo:"GENERAL",evaluado_por:session.data.memberId,vigente_hasta:v.vigenteHasta,
  }).select("id").single();
  if(error||!data)return err("validation","No pudimos registrar la evaluación. Revisá plantilla vigente, paciente, representación y plazo.");
  return ok({id:data.id as string});
}
export async function listConsentAssessments(pacienteId:string){
  if(!z.string().uuid().safeParse(pacienteId).success)return err("validation","Paciente inválido.");
  const session=await getActiveSession();if(!session.ok)return session;
  const client=await createSupabaseServerClient();
  const {data,error}=await client.from("consentimiento_evaluacion").select("id,modo,created_at,vigente_hasta,revocado_en,fundamento_cifrado,participacion_cifrado,evaluado_por,riesgo,version_snapshot").eq("organization_id",session.data.organizationId).eq("paciente_id",pacienteId).order("created_at",{ascending:false});
  if(error)return err("db_error","No pudimos cargar las evaluaciones. Reintentá.");
  const items:AssessmentItem[]=[];
  for(const v of data??[]){
    const fundamento=tryDecrypt(v.fundamento_cifrado,"consent.assessment.reason"),participacion=tryDecrypt(v.participacion_cifrado,"consent.assessment.participation");
    if(!fundamento||!participacion)return err("db_error","No pudimos leer una evaluación completa. Pedí su revisión antes de atribuir una firma.");
    items.push({id:v.id,modo:v.modo,createdAt:v.created_at,vigenteHasta:v.vigente_hasta,revocadoEn:v.revocado_en,fundamento,participacion,autorId:v.evaluado_por,riesgo:v.riesgo,version:v.version_snapshot});
  }
  return ok(items);
}
export async function revokeConsentAssessment(id:string,pacienteId:string,motivo:string){
  if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(pacienteId).success||typeof motivo!=="string"||motivo.trim().length<10)return err("validation","Indicá una evaluación y el motivo de revisión.");
  const session=await getActiveSession();if(!session.ok)return session;
  const client=await createSupabaseServerClient();
  const {data,error}=await client.from("consentimiento_evaluacion").update({revocado_en:new Date().toISOString(),revocacion_motivo_cifrado:encryptColumn(motivo)})
    .eq("id",id).eq("paciente_id",pacienteId).eq("organization_id",session.data.organizationId).is("revocado_en",null).select("id").maybeSingle();
  if(error||!data)return err("conflict","La evaluación cambió. Recargá antes de continuar.");return ok(undefined);
}
