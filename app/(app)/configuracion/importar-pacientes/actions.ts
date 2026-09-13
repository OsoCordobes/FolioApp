"use server";
/** Reparse the CSV, then persist bounded, independently atomic row results. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { blindIndex, blindIndexPhone, encryptColumn } from "@/lib/crypto";
import { err, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";
import { claveDni,MAX_CSV_CHARS,MAX_FILAS_IMPORT,normalizarFilas,normalizarHuellaImportacion,parseCsv,previewFilas,resumirImportacion,type FilaNormalizada,type ImportResumen } from "@/lib/import/pacientes-csv";
import { normalizarCobertura } from "@/lib/pacientes/cobertura";
import { createSupabaseServerClient } from "@/lib/supabase/server";
const indice=z.number().int().min(0).max(500);
const schema=z.object({organizationId:z.string().uuid(),memberId:z.string().uuid(),operacionId:z.string().uuid(),csvText:z.string().min(1).max(MAX_CSV_CHARS),mapeo:z.object({nombre:indice,apellido:indice,telefono:indice,dni:indice.optional(),email:indice.optional(),fechaNacimiento:indice.optional(),obraSocial:indice.optional(),nroAfiliado:indice.optional()})});
export type ImportPacientesInput=z.infer<typeof schema>;
const rowSchema=z.object({fila:z.number().int().min(2).max(501),status:z.enum(["imported","review_dni","review_file","review_previous","invalid","failed"]),code:z.enum(["created","existing_dni","duplicate_in_file","previous_import","invalid_row","row_failed"])});
const statusSchema=z.object({id:z.string().uuid(),total:z.number().int().min(1).max(MAX_FILAS_IMPORT),rows:z.array(rowSchema).max(MAX_FILAS_IMPORT)});
const BATCH_ROWS=20;
function identity(data:FilaNormalizada,org:string){
 const coverage=normalizarCobertura({nombre:data.obraSocial,nroAfiliado:data.nroAfiliado});
 return {nombre_cifrado:encryptColumn(data.nombre),apellido_cifrado:encryptColumn(data.apellido),numero_doc_cifrado:encryptColumn(data.dni),email_cifrado:encryptColumn(data.email),telefono_cifrado:encryptColumn(data.telefono),fecha_nacimiento:data.fechaNacimiento,cobertura_nombre:coverage.nombre,cobertura_nro_afiliado_cifrado:encryptColumn(coverage.nroAfiliado),nombre_hash:blindIndex(`${data.nombre} ${data.apellido}`,org),dni_hash:blindIndex(claveDni(data.dni),org),telefono_hash:blindIndexPhone(data.telefono,org)};
}
export async function importarPacientesAction(input:ImportPacientesInput):Promise<Result<ImportResumen>>{
 const parsed=schema.safeParse(input);if(!parsed.success)return err("validation","El archivo o las columnas no son válidos.");
 const {csvText,mapeo,operacionId}=parsed.data;
 const indices=Object.values(mapeo).filter((v):v is number=>v!==undefined);
 if(new Set(indices).size!==indices.length)return err("validation","Cada campo necesita una columna distinta.");
 const session=await getActiveSession();if(!session.ok)return session;
 if(!capabilitiesFor(session.data.role,session.data.esColegiado).canCreatePacienteClinical)return err("forbidden","Tu rol no permite crear fichas clínicas. Pedile a un profesional o a dirección que importe el archivo.");
 if(parsed.data.organizationId!==session.data.organizationId||parsed.data.memberId!==session.data.memberId)return err("conflict","Cambió la sesión o el consultorio. Volvé al consultorio original para continuar esta importación.");
 const org=session.data.organizationId,csv=parseCsv(csvText);
 if(csv.error)return err("validation",csv.error);
 if(!csv.filas.length||csv.filas.length>MAX_FILAS_IMPORT)return err("validation",`El archivo debe tener entre 1 y ${MAX_FILAS_IMPORT} filas.`);
 if(indices.some(i=>i>=csv.headers.length))return err("validation","Las columnas no coinciden con el archivo.");
 const rows=previewFilas(normalizarFilas(csv.filas,mapeo));
 // Keyed fingerprints, not raw CSV or contact keys. Encryption randomness is excluded.
 try{
 const fingerprints=rows.map((row,index)=>blindIndex(JSON.stringify(row.ok?normalizarHuellaImportacion(row.data):Object.fromEntries(Object.entries(mapeo).map(([key,column])=>[key,column===undefined?null:csv.filas[index][column]?.trim()??""]))),org)!);
  const client=await createSupabaseServerClient();
  const began=await client.rpc("begin_patient_import",{p_org:org,p_operation:operacionId,p_hash:blindIndex(JSON.stringify({version:1,rows:fingerprints}),org),p_total:rows.length});
  if(began.error){const e=mapSupabaseError(began.error);return err(e.code,e.message);}
  if(!z.string().uuid().safeParse(began.data).success)return err("db_error","No pudimos recuperar la importación. Reintentá el mismo archivo.");
  const status=await client.rpc("patient_import_status",{p_org:org,p_run:began.data});
  if(status.error){const e=mapSupabaseError(status.error);return err(e.code,e.message);}
  const snapshot=statusSchema.safeParse(status.data);
  if(!snapshot.success||snapshot.data.id!==began.data||snapshot.data.total!==rows.length||new Set(snapshot.data.rows.map(r=>r.fila)).size!==snapshot.data.rows.length||snapshot.data.rows.some(r=>r.fila>rows.length+1))return err("db_error","No pudimos verificar el progreso. Reintentá el mismo archivo.");
  const receipts=[...snapshot.data.rows],finished=new Set(receipts.map(r=>r.fila));
  for(const row of rows.filter(r=>!finished.has(r.fila)).slice(0,BATCH_ROWS)){
   const dni=row.ok?claveDni(row.data.dni):null;
   const raw=row.ok&&mapeo.dni!==undefined?csv.filas[row.fila-2][mapeo.dni]?.trim():null;
   const variants=[blindIndex(dni,org),blindIndex(dni),blindIndex(raw??null,org),blindIndex(raw??null)].filter((v):v is string=>v!==null);
   const saved=await client.rpc("import_patient_row",{p_org:org,p_run:began.data,p_row:row.fila,p_hash:fingerprints[row.fila-2],p_data:row.ok?identity(row.data,org):null,p_disposition:row.preview==="invalid"?"invalid":row.preview==="duplicate_file"?"duplicate_file":"import",p_dni_variants:[...new Set(variants)]});
   if(saved.error){const e=mapSupabaseError(saved.error);return err(e.code,"La importación se interrumpió. Reintentá el mismo archivo para continuar desde lo guardado.");}
   const receipt=rowSchema.safeParse(saved.data);if(!receipt.success||receipt.data.fila!==row.fila)return err("db_error","Falta confirmar una fila. Reintentá el mismo archivo.");
   receipts.push(receipt.data);
  }
  const result=resumirImportacion(began.data,rows.length,receipts);
  if(result.importados)revalidatePath("/pacientes");
  return ok(result);
 }catch{return err("network","La respuesta se interrumpió. Volvé a confirmar el mismo archivo; las filas guardadas no se repiten.");}
}
