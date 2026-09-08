import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import type { FichaPdfData } from "../../lib/pdf/ficha-pdf";
const patient="11600000-0000-4000-8000-000000000002",sessionId="11600000-0000-4000-8000-000000000003";
function fixture(fail=false, revoked=false, initialRole="PROFESIONAL", colegiado=true, revokeSession=false, revokeColegiado=false) {
 let reads=0,contexts=0;let rendered:FichaPdfData|undefined;const audits:Record<string,unknown>[]=[];
 const client={from(table:string){let ids:string[]=[];const q={select(){return q},eq(){return q},is(){return q},order(){return q},in(_k:string,v:string[]){ids=v;return q},range(){return q},maybeSingle(){return Promise.resolve({data:{id:patient},error:null})},then(resolve:(x:unknown)=>unknown){const rows=table==='sesion'&&!(revokeSession&&contexts>1)?ids.map(id=>({id})):[];return Promise.resolve(resolve({data:rows,count:rows.length,error:null}))}};return q}};
 class NextResponse extends Response {static json(data:unknown,init?:ResponseInit){return new NextResponse(JSON.stringify(data),init)}}
 const ctx={session:{role:initialRole,esColegiado:colegiado,memberId:'member',userId:'user'},organization:{id:'org',especialidad:'quiropraxia',nombre:'Sintético',timezone:'America/Argentina/Cordoba'},profile:{nombre:'Test',apellido:'User',matricula:null}};
 const imports:Record<string,unknown>={
 'next/server':{NextResponse},'next/headers':{headers:async()=>new Headers()},
 '@/lib/db/active-context':{getActiveContext:async()=>{contexts++;return{ok:true,data:{...ctx,session:{...ctx.session,role:revoked&&contexts>1?'ASISTENTE':initialRole,esColegiado:revokeColegiado&&contexts>1?false:colegiado}}}}},
 '@/lib/db/audit':{writeAuditEntry:async(entry:Record<string,unknown>)=>{audits.push(entry)}},'@/lib/supabase/server':{createSupabaseServerClient:async()=>client},
 '@/lib/db/paciente-ficha':{getPacienteFicha:async()=>({ok:true,data:{paciente:{nombre:'Paciente sintético',edad:30,genero:'—',motivo:''},plan:{turnoActivo:null,toolHistorial:[]}}})},
 '@/lib/especialidades/meta':{ESPECIALIDADES_META:{quiropraxia:{nombre:'Quiropraxia',slug:'quiropraxia',resumenSesion:()=>''}},getEspecialidadMetaByToolId:()=>null},
 '@/lib/instrumentos':{getInstrumento:()=>null},
 '@/lib/pdf/ficha-pdf':{buildFichaPdf:async(data:FichaPdfData)=>{rendered=data;return Buffer.from('%PDF synthetic')}},
 '@/lib/pdf/history-reader':{PDF_MAX_BYTES:4194304,readPdfCollection:async(fetch:(a:number,b:number)=>Promise<{data:unknown}>)=>(await fetch(0,199)).data,
 readPdfHistory:async(_c:unknown,_o:string,_p:string,id:string|null)=>{reads++;if(fail)throw new Error('PRIVATE SYNTHETIC DETAIL');return Array.from({length:id?1:62},(_,i)=>({sesionId:id??`s${i}`,fecha:'2026-09-08',servicio:'Consulta',resumen:'Original',soap:{s:'original',o:'',a:'',p:''},enmiendas:[]}))}},
 };
 const exports:{GET?:(request:Request,args:{params:Promise<{id:string}>})=>Promise<Response>}={};
 runInNewContext(ts.transpileModule(readFileSync('app/api/pacientes/[id]/ficha-pdf/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,URL,Date,Intl,Set,Uint8Array,require:(name:string)=>{if(!(name in imports))throw new Error(name);return imports[name]}});
 return{run:(query='')=>exports.GET!(new Request(`http://127.0.0.1/api/pacientes/${patient}/ficha-pdf${query}`),{params:Promise.resolve({id:patient})}),rendered:()=>rendered,reads:()=>reads,audits};
}
test('PDF route sends every authorized session to renderer and labels restricted scope',async()=>{const f=fixture();const response=await f.run();assert.equal(response.status,200);assert.equal(f.rendered()?.evolucion.length,62);assert.match(f.rendered()?.alcance??'',/puede excluir registros/)});
test('PDF route punctual export includes exactly requested session',async()=>{const f=fixture();const response=await f.run(`?sesion=${sessionId}`);assert.equal(response.status,200);assert.equal(f.rendered()?.evolucion.length,1);assert.equal(f.rendered()?.resumenHerramienta,null)});
test('PDF route rejects malformed session rather than broadening to whole history',async()=>{const f=fixture();assert.equal((await f.run('?sesion=bad')).status,400);assert.equal(f.reads(),0)});
test('PDF route rejects 36-character malformed UUIDs before database reads',async()=>{for(const id of ['-'.repeat(36),'a'.repeat(36),'116000000000-4000-8000-000000000002']){const f=fixture();assert.equal((await f.run(`?sesion=${id}`)).status,400);assert.equal(f.reads(),0)}});
test('PDF route never falls back after missing/unreadable requested session',async()=>{const f=fixture(true);const r=await f.run(`?sesion=${sessionId}`);assert.equal(r.status,500);assert.equal(f.rendered(),undefined);assert.equal((await r.text()).includes('PRIVATE'),false)});
test('PDF route refuses bytes when clinical role is revoked after rendering',async()=>{const f=fixture(false,true);const r=await f.run();assert.equal(r.status,403);assert.equal(r.headers.get('Content-Disposition'),null);assert.equal(r.headers.get('Cache-Control'),'no-store')});
test('a denied prepared PDF never creates a successful-delivery audit',async()=>{const f=fixture(false,true);assert.equal((await f.run()).status,403);assert.equal(f.audits.length,1);assert.equal(f.audits[0].action,'paciente_ficha.export_pdf_prepared');assert.equal((f.audits[0].payload as Record<string,unknown>).delivery_confirmed,false)});

test('PDF rejects DIRECTOR without clinical qualification before reading the patient',async()=>{const f=fixture(false,false,'DIRECTOR',false);const r=await f.run();assert.equal(r.status,403);assert.equal(f.reads(),0);assert.equal(f.rendered(),undefined)});
test('PDF refuses prepared punctual bytes after that session is no longer readable under RLS',async()=>{const f=fixture(false,false,'PROFESIONAL',true,true);const r=await f.run(`?sesion=${sessionId}`);assert.equal(r.status,403);assert.equal(r.headers.get('Content-Disposition'),null);assert.equal(r.headers.get('Cache-Control'),'no-store')});
test('PDF refuses prepared bytes after director loses clinical qualification',async()=>{const f=fixture(false,false,'DIRECTOR',true,false,true);const r=await f.run();assert.equal(r.status,403);assert.equal(r.headers.get('Content-Disposition'),null)});
