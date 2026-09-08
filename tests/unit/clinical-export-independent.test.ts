import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { encryptColumn } from '../../lib/crypto';
import { buildClinicalExport } from '../../lib/patient/clinical-export';
import type { createSupabaseServerClient } from '../../lib/supabase/server';
type Row={id:string}&Record<string,unknown>;
const org='cc000000-0000-4000-8000-000000000001',patient='cc000000-0000-4000-8000-000000000002',sessionId='cc000000-0000-4000-8000-000000000003';
function clinicalClient(rows:Record<string,Row[]>){return {from(table:string){const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,range:()=>q,then:(f:(v:unknown)=>unknown)=>Promise.resolve(f({data:rows[table]??[],count:(rows[table]??[]).length,error:null}))};return q;}} as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>;}
const scoped=(row:Row)=>({organization_id:org,paciente_id:patient,...row});
for(const category of ['instrument','assessment','snapshot','document'])test(`non-null empty ciphertext in ${category} cannot be relabeled absent`,async()=>{
 const rows:Record<string,Row[]>={};
 if(category==='instrument')rows.instrumento_respuesta=[scoped({id:'i',instrumento_id:'old',instrumento_version:1,respuestas_cifrado:'\\x'})];
 if(category==='assessment')rows.consentimiento_evaluacion=[scoped({id:'a',fundamento_cifrado:'\\x'})];
 if(category==='snapshot')rows.consentimiento_evaluacion=[scoped({id:'a',paciente_identidad_snapshot:{nombre_cifrado:'\\x'}})];
 if(category==='document')rows.documento_clinico=[scoped({id:'d',storage_bucket:'documentos-clinicos',storage_path:`documentos-clinicos/${org}/${patient}/test.pdf`,descripcion_cifrado:'\\x'})];
 assert.equal((await buildClinicalExport(clinicalClient(rows),org,patient)).ok,false);
});
test('unknown identity snapshot fields are not serialized as raw ciphertext or opaque objects',async()=>{
 const snapshot={id:'identity',nombre_cifrado:encryptColumn('Nombre original'),unexpected:{token:'SECRET',nested_cifrado:'SECRET'}};
 const r=await buildClinicalExport(clinicalClient({consentimiento_evaluacion:[scoped({id:'a',paciente_identidad_snapshot:snapshot})]}),org,patient);
 assert.equal(r.ok,false,'unknown snapshot schema must require review instead of claiming complete evidence');
});
for(const table of ['instrumento_respuesta','consentimiento_evaluacion'])test(`wrong patient ${table} row cannot enter the inventory`,async()=>{
 const row=scoped({id:'i',paciente_id:'other',instrumento_id:'old',instrumento_version:1,respuestas_cifrado:null});
 assert.equal((await buildClinicalExport(clinicalClient({[table]:[row]}),org,patient)).ok,false);
});
const nativeRequire=createRequire(import.meta.url);
function routeFixture(kind:'json'|'pdf',failure:string){
 let phase='initial';let auditCalls=0;const original={userId:'actor',memberId:'member',organizationId:org,role:'OWNER',esColegiado:true,email:'test@example.invalid',emailVerified:true,isInternalAccount:false};
 const current=()=>{if(phase==='finished'){if(failure==='mfa')return {ok:false,error:{code:'mfa_required',message:'MFA requerida'}};if(failure==='role')return {ok:true,data:{...original,role:'PROFESIONAL'}};if(failure==='member')return {ok:false,error:{code:'no_org',message:'Sin acceso'}};if(failure==='actor')return {ok:true,data:{...original,userId:'other'}};}return {ok:true,data:original};};
 const db={from(table:string){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:phase==='finished'&&failure==='patient'?null:table==='sesion'?{id:sessionId,paciente_id:patient,organization_id:org}:{id:patient,organization_id:org},error:null})};return q;}};
 const fixtureFicha={paciente:{nombre:'Synthetic',edad:30,genero:'',motivo:''},plan:{turnoActivo:null,toolHistorial:[],soap:{subjetivo:'',objetivo:'',analisis:'',plan:''},sesiones:[]},notas:[]};
 const overrides:Record<string,unknown>={
  'next/server':{NextResponse:Response},'next/headers':{headers:async()=>new Map()},
  '@/lib/db/active-context':{getActiveContext:async()=>({ok:true,data:{session:original,organization:{id:org,nombre:'Synthetic',especialidad:'quiropraxia',timezone:'America/Argentina/Cordoba'},profile:{nombre:'Tester',apellido:null,matricula:null}}})},
  '@/lib/db/session':{getActiveSession:async()=>current()},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>db},
  '@/lib/patient/export-builder':{buildPatientExport:async()=>{if(failure==='transport')throw Error('SECRET transport');return {ok:true,data:{ok:true,synthetic:true}};}},
  '@/lib/db/paciente-ficha':{getPacienteFicha:async()=>({ok:true,data:fixtureFicha})},
  '@/lib/patient/export-instruments':{readExportInstruments:async()=>({ok:true,data:[]})},
  '@/lib/pdf/ficha-pdf':{buildFichaPdf:async()=>{if(failure==='transport')throw Error('SECRET renderer');return Buffer.from('%PDF synthetic');}},
  '@/lib/db/audit':{writeAuditEntry:async()=>{auditCalls++;phase='finished';return {ok:true};}},
 };
 const load=(file:string):Record<string,unknown>=>{const exports={};const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;runInNewContext(js,{exports,require:(name:string)=>{if(name in overrides)return overrides[name];const mapped=name.startsWith('@/')?resolve(name.slice(2)):name.startsWith('.')?resolve(dirname(file),name):null;if(mapped&&mapped.includes(`${resolve('lib/patient')}`))return load(mapped.endsWith('.ts')?mapped:mapped+'.ts');return nativeRequire(mapped??name);},Buffer,Uint8Array,URL,Request,Response,Date});return exports;};
 const file=kind==='json'?'app/api/patient/export/route.ts':'app/api/pacientes/[id]/ficha-pdf/route.ts';
 const get=load(file).GET as (request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>;
 return {run:()=>get(new Request(`http://localhost/export?paciente=${patient}`),{params:Promise.resolve({id:patient})}),getAuditCalls:()=>auditCalls};
}
for(const kind of ['json','pdf'] as const)for(const failure of ['role','member','mfa','actor','patient','transport'])test(`${kind} refuses ${failure} before releasing prepared clinical bytes`,async()=>{
 const f=routeFixture(kind,failure);const response=await f.run();assert.notEqual(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!String(await response.text()).includes('SECRET'));if(failure!=='transport')assert.equal(f.getAuditCalls(),1);
});
for(const kind of ['json','pdf'] as const)test(`${kind} preserves valid authorized delivery`,async()=>{const r=await routeFixture(kind,'none').run();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');});

test('missing or malformed exact count never certifies an empty clinical collection',async()=>{
 const {readCompleteCollection}=await import('../../lib/db/complete-collection');
 for(const count of [undefined,NaN,Infinity,-1]){const result=await readCompleteCollection(async()=>({data:[],error:null,count:count as number}));assert.notEqual(result.error,null);}
});
test('an amendment outside the requested patient sessions fails instead of becoming an empty correction list',async()=>{
 const {readEnmiendas}=await import('../../lib/db/enmiendas');
 const client=clinicalClient({sesion_enmienda:[{id:'e1',sesion_id:'other-patient-session',autor_id:'m',created_at:'2026-09-08',motivo:'Synthetic',texto_correccion_cifrado:encryptColumn('Corrección sintética')}]});
 assert.equal((await readEnmiendas(client,org,[sessionId])).ok,false);
});
