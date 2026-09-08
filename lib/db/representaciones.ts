import { z } from "zod";
import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import { argentinaDate, representationAllows } from "@/lib/consentimientos/decision";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveSession } from "./session";
import { err, ok } from "./errors";

export const representationSchema = z.object({
  pacienteId: z.string().uuid(), nombre: z.string().trim().min(3).max(150), documento: z.string().trim().min(5).max(40),
  telefono: z.string().trim().min(6).max(40), vinculo: z.enum(["MADRE","PADRE","ABUELO","OTRO"]),
  desde: z.string().date(), hasta: z.string().date(),
  evidencia: z.string().trim().min(20).max(2000), restricciones: z.string().trim().min(3).max(2000),
  alcances: z.array(z.enum(["CONSENTIMIENTO","AGENDA","ENTREGA_REVISADA"])).min(1),
}).refine(v=>v.hasta>=v.desde,{message:"La fecha final debe ser posterior al inicio."});
export interface RepresentationItem {
  id: string; nombre: string; documento: string; vinculo: string; estado: string; desde: string | null; hasta: string | null;
  alcances: string[]; restricciones: string; evidencia: string; vigenteParaConsentir: boolean;
}
export async function listRepresentaciones(pacienteId: string) {
  if(!z.string().uuid().safeParse(pacienteId).success) return err("validation","Paciente inválido.");
  const session=await getActiveSession();if(!session.ok)return session;
  const client=await createSupabaseServerClient();
  const {data,error}=await client.from("tutor_legal").select("id,nombre_cifrado,numero_doc_cifrado,vinculo,estado_verificacion,vigencia_desde,vigencia_hasta,alcances,restricciones_cifrado,evidencia_verificacion_cifrado,revocado_en,identidad_verificada,vinculo_verificado")
    .eq("organization_id",session.data.organizationId).eq("paciente_id",pacienteId).order("created_at",{ascending:false});
  if(error)return err("db_error","No pudimos consultar las representaciones. No se habilitará la firma hasta verificarlo.");
  const items:RepresentationItem[]=[];
  for(const row of data??[]){
    const nombre=tryDecrypt(row.nombre_cifrado,"representation.name");
    const documento=tryDecrypt(row.numero_doc_cifrado,"representation.document");
    if(!nombre||!documento)return err("db_error","Una identidad no se pudo leer. Revisala antes de atribuir una firma.");
    if(row.estado_verificacion==="VERIFICADA"&&(!tryDecrypt(row.restricciones_cifrado,"representation.restrictions")||!tryDecrypt(row.evidencia_verificacion_cifrado,"representation.evidence")))return err("db_error","No pudimos leer la acreditación completa. Revisala antes de firmar.");
    items.push({id:row.id,nombre,documento,vinculo:row.vinculo,estado:row.estado_verificacion,desde:row.vigencia_desde,hasta:row.vigencia_hasta,alcances:row.alcances,
      restricciones:row.restricciones_cifrado?tryDecrypt(row.restricciones_cifrado,"representation.restrictions")??"No se pudo leer; requiere revisión":"Sin revisión registrada",
      evidencia:row.evidencia_verificacion_cifrado?tryDecrypt(row.evidencia_verificacion_cifrado,"representation.evidence")??"No se pudo leer; requiere revisión":"Sin acreditación registrada",
      vigenteParaConsentir:representationAllows({estado:row.estado_verificacion,vigenciaDesde:row.vigencia_desde,vigenciaHasta:row.vigencia_hasta,revocadoEn:row.revocado_en,alcances:row.alcances,identidadVerificada:row.identidad_verificada,vinculoVerificado:row.vinculo_verificado},"CONSENTIMIENTO",argentinaDate())});
  }
  return ok(items);
}
export async function createRepresentacion(input:unknown){
  const parsed=representationSchema.safeParse(input);if(!parsed.success)return err("validation",parsed.error.issues[0]?.message??"Revisá los datos.");
  const session=await getActiveSession();if(!session.ok)return session;
  const client=await createSupabaseServerClient(); const v=parsed.data;
  const {data,error}=await client.from("tutor_legal").insert({organization_id:session.data.organizationId,paciente_id:v.pacienteId,
    nombre_cifrado:encryptColumn(v.nombre),numero_doc_cifrado:encryptColumn(v.documento),telefono_cifrado:encryptColumn(v.telefono),vinculo:v.vinculo,
    es_principal:false,vigencia_desde:v.desde,vigencia_hasta:v.hasta,evidencia_verificacion_cifrado:encryptColumn(v.evidencia),restricciones_cifrado:encryptColumn(v.restricciones),alcances:v.alcances,
  }).select("id").single();
  if(error||!data)return err("db_error","No pudimos guardar la representación pendiente.");return ok({id:data.id});
}
export async function reviewRepresentacion(input:{id:string;pacienteId:string;accion:"VERIFICAR"|"REVOCAR";motivo:string;identidad?:boolean;vinculo?:boolean}){
  const parsed=z.object({id:z.string().uuid(),pacienteId:z.string().uuid(),accion:z.enum(["VERIFICAR","REVOCAR"]),motivo:z.string().trim().min(20).max(2000),identidad:z.boolean().optional(),vinculo:z.boolean().optional()}).safeParse(input);
  if(!parsed.success)return err("validation","Revisá la representación y registrá un fundamento de entre 20 y 2000 caracteres.");
  input=parsed.data;
  if(input.accion==="VERIFICAR"&&(!input.identidad||!input.vinculo))return err("validation","Comprobá por separado la identidad y el vínculo acreditado.");
  const session=await getActiveSession();if(!session.ok)return session;
  const client=await createSupabaseServerClient();
  const update=input.accion==="VERIFICAR"?{estado_verificacion:"VERIFICADA",identidad_verificada:true,vinculo_verificado:true,evidencia_verificacion_cifrado:encryptColumn(input.motivo)}:
    {estado_verificacion:"REVOCADA",revocacion_motivo_cifrado:encryptColumn(input.motivo)};
  const {data,error}=await client.from("tutor_legal").update(update).eq("id",input.id).eq("paciente_id",input.pacienteId).eq("organization_id",session.data.organizationId)
    .eq("estado_verificacion",input.accion==="VERIFICAR"?"PENDIENTE":"VERIFICADA").select("id").maybeSingle();
  if(error||!data)return err("conflict","La representación cambió o no cumple las condiciones. Recargá y revisala.");return ok(undefined);
}
