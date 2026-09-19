import { createHash,randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { inspectClinicalFile } from "@/lib/storage/clinical-files";
import { getActiveSession } from "@/lib/db/session";
import { getPacienteSession } from "@/lib/db/paciente-session";
import { err,ok } from "@/lib/db/errors";
import { argentinaDate,representationAllows,signatureParticipants,type DecisionMode } from "./decision";
import { buildFirmaStoragePath,pathSinBucket } from "./helpers";

/** Authenticated server boundary. Each uploaded drawing is evidence, not a
 * certified digital signature or an automated finding of legal capacity. */
export async function uploadReviewedConsent(form:FormData,audience:"staff"|"portal"){
  const ids=z.object({pacienteId:z.string().uuid(),plantillaId:z.string().uuid(),evaluacionId:z.string().uuid()}).safeParse({
    pacienteId:form.get("pacienteId"),plantillaId:form.get("plantillaId"),evaluacionId:form.get("evaluacionId"),
  });
  if(!ids.success)return err("validation","Primero registrá la evaluación profesional de este consentimiento.");
  const v=ids.data;
  let org:string;
  if(audience==="staff"){
    const session=await getActiveSession();if(!session.ok)return session;
    if(!["OWNER","PROFESIONAL"].includes(session.data.role)&&!(session.data.role==="DIRECTOR"&&session.data.esColegiado))return err("forbidden","La firma requiere revisión clínica.");
    org=session.data.organizationId;
  }else{
    const session=await getPacienteSession();if(!session.ok)return session;
    const ficha=session.data.pacientes.find(p=>p.pacienteId===v.pacienteId);
    if(!ficha)return err("forbidden","La ficha no está vinculada a tu cuenta.");org=ficha.organizationId;
  }
  const client=await createSupabaseServerClient();
  const {data:ev,error:evError}=await client.from("consentimiento_evaluacion").select("id,modo,tipo,representante_id,revocado_en,vigente_hasta")
    .eq("id",v.evaluacionId).eq("paciente_id",v.pacienteId).eq("plantilla_id",v.plantillaId).eq("organization_id",org).maybeSingle();
  if(evError)return err("db_error","No pudimos verificar la evaluación. No se registró ninguna firma.");
  if(!ev||ev.modo==="PENDIENTE"||ev.revocado_en||new Date(ev.vigente_hasta).getTime()<=Date.now()||(audience==="portal"&&ev.modo!=="AUTONOMO"))return err("forbidden","La evaluación requiere revisión profesional antes de firmar.");
  if(ev.representante_id){
    const {data:r,error}=await client.from("tutor_legal").select("estado_verificacion,vigencia_desde,vigencia_hasta,revocado_en,alcances,identidad_verificada,vinculo_verificado")
      .eq("id",ev.representante_id).eq("paciente_id",v.pacienteId).eq("organization_id",org).maybeSingle();
    if(error)return err("db_error","No pudimos verificar la representación. Reintentá; no se atribuyó ninguna firma.");
    if(!r||!representationAllows({estado:r.estado_verificacion,vigenciaDesde:r.vigencia_desde,vigenciaHasta:r.vigencia_hasta,revocadoEn:r.revocado_en,alcances:r.alcances,identidadVerificada:r.identidad_verificada,vinculoVerificado:r.vinculo_verificado},"CONSENTIMIENTO",argentinaDate()))return err("forbidden","La representación no está verificada, vigente o autorizada para consentir.");
  }
  const {data:existing,error:readError}=await client.from("consentimiento").select("id").eq("evaluacion_id",ev.id).maybeSingle();
  if(readError)return err("db_error","No pudimos comprobar si la firma ya quedó registrada.");
  if(existing)return ok({consentimientoId:existing.id as string});
  const roles=signatureParticipants(ev.modo as DecisionMode);
  if(roles.length===0)return err("validation","La evaluación todavía está pendiente.");
  const prepared:Array<{rol:string;path:string;sha256:string;bytes:Uint8Array}>=[];
  for(let i=0;i<roles.length;i++){
    const file=form.get(i===0?"file":"fileRepresentante");
    if(!(file instanceof Blob)||file.size===0||file.size>5*1024*1024)return err("validation","Falta una firma válida de hasta 5 MB de uno de los participantes.");
    const bytes=new Uint8Array(await file.arrayBuffer());
    const inspected=inspectClinicalFile(bytes,5*1024*1024);
    if(!inspected.ok||inspected.data.mime!=="image/png")return err("validation","Cada firma debe ser una imagen PNG válida de hasta 5 MB.");
    prepared.push({rol:roles[i],path:buildFirmaStoragePath({organizationId:org,pacienteId:v.pacienteId,archivoUuid:randomUUID()}),sha256:createHash("sha256").update(bytes).digest("hex"),bytes});
  }
  for(const part of prepared){
    const {error}=await client.storage.from("consentimientos-firmados").upload(pathSinBucket(part.path),part.bytes,{contentType:"image/png",upsert:false});
    if(error)return err("db_error","No pudimos conservar toda la evidencia. No se confirmó el consentimiento.");
  }
  const h=await headers();
  const {data,error}=await client.from("consentimiento").insert({organization_id:org,paciente_id:v.pacienteId,plantilla_id:v.plantillaId,
    tipo:ev.tipo,evaluacion_id:ev.id,firma_storage_path:prepared[0].path,participantes:prepared.map(({rol,path,sha256})=>({rol,path,sha256})),
    ip:h.get("x-forwarded-for")?.split(",")[0]?.trim()??null,user_agent:h.get("user-agent"),
  }).select("id").single();
  // Preserve objects on an uncertain response: deleting them could erase a
  // committed signature. A retry consults the unique evaluation link first.
  if(error||!data)return err("conflict","No pudimos confirmar el registro. Recargá para comprobar el resultado antes de repetir.");
  return ok({consentimientoId:data.id as string});
}
