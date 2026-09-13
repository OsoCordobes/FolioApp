import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { firmaPathMatchesFicha } from "@/lib/db/portal-consentimientos";
import { pathSinBucket } from "@/lib/consentimientos/helpers";
import { inspectClinicalFile } from "@/lib/storage/clinical-files";
import { createSupabaseServerClient,createSupabaseServiceClient } from "@/lib/supabase/server";
export const dynamic="force-dynamic";
const privateHeaders={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"sandbox; default-src 'none'"};
const failure=(status:number)=>NextResponse.json({error:"No pudimos abrir esa evidencia. Verificá tu sesión y permisos."},{status,headers:privateHeaders});
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try {
  const {id}=await params; const index=Number(new URL(request.url).searchParams.get("participante")??"0");
  if(!z.string().uuid().safeParse(id).success||!Number.isInteger(index)||index<0||index>1)return failure(404);
  const client=await createSupabaseServerClient();const session=await verifyMfaSession(client);
  if(!session.ok)return failure(session.error.code==="auth_required"?401:403);
  const {data:row,error}=await client.from("consentimiento").select("organization_id,paciente_id,firma_storage_path,participantes").eq("id",id).maybeSingle();
  if(error)return failure(503);if(!row)return failure(404);
  const {data:patient,error:patientError}=await client.from("paciente").select("id").eq("id",row.paciente_id).eq("organization_id",row.organization_id).is("deleted_at",null).is("pseudonimizado_en",null).maybeSingle();
  if(patientError)return failure(503);if(!patient)return failure(404);
  const evidence=Array.isArray(row.participantes)?row.participantes[index]:null;
  const path=evidence?.path??(index===0?row.firma_storage_path:null);
  if(typeof path!=="string"||!firmaPathMatchesFicha(path,row.organization_id,row.paciente_id))return failure(404);
  const service=createSupabaseServiceClient();
  const {data:file,error:downloadError}=await service.storage.from("consentimientos-firmados").download(pathSinBucket(path));
  if(downloadError||!file||file.size>50*1024*1024)return failure(404);
  const bytes=new Uint8Array(await file.arrayBuffer());const type=inspectClinicalFile(bytes,50*1024*1024);
  if(!type.ok||!["image/png","application/pdf"].includes(type.data.mime))return failure(422);
  if(evidence?.sha256&&createHash("sha256").update(bytes).digest("hex")!==evidence.sha256)return failure(422);
  return new Response(bytes,{headers:{...privateHeaders,"Content-Type":type.data.mime,"Content-Disposition":`${type.data.mime==="image/png"?"inline":"attachment"}; filename="evidencia-consentimiento.${type.data.extension}"`}});
  } catch { return failure(503); }
}
