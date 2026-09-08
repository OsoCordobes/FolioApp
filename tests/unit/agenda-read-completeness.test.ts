/* eslint-disable @typescript-eslint/no-explicit-any -- Exercise transpiled server modules with a controllable PostgREST transport. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { readCompleteCollection } from "../../lib/db/complete-collection";
import * as timelineCore from "../../lib/ficha/timeline-core";
import * as rango from "../../lib/agenda/rango-horario";

const org="synthetic-org",patient="synthetic-patient";
const row=(i:number)=>({id:`turno-${String(i).padStart(5,"0")}`,organization_id:org,paciente_id:patient,profesional_id:"member",inicio:"2026-09-08T13:00:00Z",duracion_min:30,estado:"CERRADO",origen:"MANUAL",paciente_tipo:"ACTIVO",servicio_nombre:"Consulta",modalidad:"telemedicina"});
type Call={table:string;service:boolean;from:number;to:number;orders:string[];filters:Array<[string,unknown]>;columns:string};
function fixture(data:Record<string,any[]>, failure?:(call:Call)=>boolean, denied=false){
 const calls:Call[]=[];let serviceCreated=0;
 const client=(service:boolean)=>({from(table:string){
  const c:Call={table,service,from:0,to:999,orders:[],filters:[],columns:"*"};let count=false,single=false;
  const q:any={select(columns:string,opts?:{count?:string}){c.columns=columns;count=opts?.count==="exact";return q;},
   eq(key:string,value:unknown){c.filters.push([key,value]);return q;},in(key:string,values:unknown[]){c.filters.push([key,values]);return q;},
   gte(){return q;},lt(){return q;},lte(){return q;},order(key:string){c.orders.push(key);return q;},
   range(from:number,to:number){c.from=from;c.to=to;return q;},limit(n:number){c.to=n-1;return q;},maybeSingle(){single=true;return q;},
   then(resolve:any,reject:any){calls.push({...c});
    if(failure?.(c))return Promise.resolve({data:null,error:{message:"SECRET SDK BODY"},count:null}).then(resolve,reject);
    if(c.filters.some(([,v])=>Array.isArray(v)&&v.length>200))return Promise.resolve({data:null,error:{message:"URI too long"},count:null}).then(resolve,reject);
    let rows=data[table]??[];
    for(const [key,value] of c.filters) rows=rows.filter(r=>Array.isArray(value)?value.includes(r[key]):r[key]===value);
    const total=rows.length;rows=rows.slice(c.from,Math.min(c.to+1,c.from+1000));
    if(c.columns!=="*"){const keys=c.columns.split(",").map(v=>v.trim());rows=rows.map(r=>Object.fromEntries(Object.entries(r).filter(([key])=>keys.includes(key))));}
    return Promise.resolve({data:single?(rows[0]??null):rows,error:null,count:count?total:null}).then(resolve,reject);
   }};return q;
 }});
 const imports:Record<string,unknown>={
  "@/lib/observability/safe-log":{safeLog(){}},"@/lib/crypto":{decryptColumn:()=>null,tryDecrypt:()=>null},
  "@/lib/auth/capabilities":{capabilitiesFor:()=>({canReadClinical:true})},"./session":{getActiveSession:async()=>denied?{ok:false,error:{code:"forbidden",message:"Denied"}}:{ok:true,data:{role:"OWNER",esColegiado:true}}},
  "./active-context":{getActiveContext:async()=>({ok:true,data:{session:{role:denied?"ASISTENTE":"OWNER",memberId:"member"},organization:{id:org}}})},
  "./errors":{ok:(data:unknown)=>({ok:true,data}),err:(code:string,message:string)=>({ok:false,error:{code,message}})},
  "./complete-collection":{readCompleteCollection},"./confirmado-via":{loadConfirmadoViaByTurnoId:async()=>({})},"./cancelado-por-paciente":{loadCanceladoPorPacienteIds:async()=>new Set()},
  "@/lib/types":{normalizeModalidad:(v:unknown)=>v==="telemedicina"?"telemedicina":"presencial"},"@/lib/agenda/rango-horario":rango,"@/lib/ficha/timeline-core":timelineCore,
  "@/lib/supabase/server":{createSupabaseServerClient:async()=>client(false),createSupabaseServiceClient:()=>{serviceCreated++;return client(true);}},
 };
 const load=(file:string)=>{const exports:Record<string,(...args:any[])=>Promise<any>>={};runInNewContext(ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Intl,Map,Set,require(name:string){if(name in imports)return imports[name];throw Error(name);}});return exports;};
 return {load,calls,get serviceCreated(){return serviceCreated;}};
}
const day={organizationId:org,fechaIso:"2026-09-08",timezone:"America/Argentina/Cordoba"};
const week={organizationId:org,weekStartIso:"2026-09-07",timezone:day.timezone};
const month={organizationId:org,monthIso:"2026-09",timezone:day.timezone};

test("day/week/month return all 1,001 visible appointments with a stable unique order",async()=>{
 for(const [file,method,input] of [["hoy","getDashboardHoy",day],["calendario","getCalendarioSemana",week],["calendario","getCalendarioMes",month]] as const){
  const f=fixture({turno_extendido:Array.from({length:1001},(_,i)=>row(i))});
  const result=await f.load(`lib/db/${file}.ts`)[method](input);
  assert.equal(result.ok,true);assert.equal(result.data.turnos.length,1001,method);
  assert.ok(f.calls.filter(c=>c.table==="turno_extendido").every(c=>c.orders.join(",")==="inicio,id"));
 }
});
test("day/week/month reject second-page failures without returning partial records or SDK content",async()=>{
 for(const [file,method,input] of [["hoy","getDashboardHoy",day],["calendario","getCalendarioSemana",week],["calendario","getCalendarioMes",month]] as const){
  const f=fixture({turno_extendido:Array.from({length:1001},(_,i)=>row(i))},c=>c.table==="turno_extendido"&&c.from>0);
  const result=await f.load(`lib/db/${file}.ts`)[method](input);assert.equal(result.ok,false,method);assert.equal(JSON.stringify(result).includes("SECRET"),false);
 }
});
test("failed post-visit lookup never claims the existing note is absent",async()=>{
 const f=fixture({turno_extendido:[row(1)]},c=>c.table==="sesion");
 assert.equal((await f.load("lib/db/hoy.ts").getDashboardHoy(day)).ok,false);
});
test("all post-visit rows survive chunking and failed later chunks reject the whole response",async()=>{
 const turnos=Array.from({length:1001},(_,i)=>row(i)),sesion=turnos.map(t=>({id:`s-${t.id}`,turno_id:t.id,organization_id:org,soap_s_cifrado:"cipher"}));
 const f=fixture({turno_extendido:turnos,sesion});const r=await f.load("lib/db/hoy.ts").getDashboardHoy(day);
 assert.equal(r.ok,true);assert.equal(r.data.turnos.filter((t:any)=>t.postVisita.guardada).length,1001);
 const broken=fixture({turno_extendido:turnos,sesion},c=>c.table==="sesion"&&c.filters.some(([,ids])=>Array.isArray(ids)&&ids.includes(turnos[500].id)));
 assert.equal((await broken.load("lib/db/hoy.ts").getDashboardHoy(day)).ok,false);
});
test("availability failures are errors, never guessed closed days",async()=>{
 const f=fixture({},c=>c.table==="disponibilidad_profesional");assert.equal((await f.load("lib/db/calendario.ts").getCalendarioSemana(week)).ok,false);
});
test("requests, blocks and availability each paginate past 1,000",async()=>{
 const source=Array.from({length:1001},(_,i)=>({...row(i),estado:"PENDIENTE",canal:"WEB",recibido_ts:"2026-09-08T12:00:00Z",dia_semana:1,hora_inicio:"09:00",hora_fin:"09:30",vigencia_desde:"2026-01-01",vigencia_hasta:null,activa:true}));
 const f=fixture({pedido:source,bloqueo:source,disponibilidad_profesional:source});const r=await f.load("lib/db/calendario.ts").getCalendarioSemana(week);
 assert.equal(r.ok,true);assert.equal(r.data.pedidos.length,1001);assert.equal(r.data.bloqueos.length,1001);
 for(const table of ["pedido","bloqueo","disponibilidad_profesional"])assert.ok(f.calls.some(c=>c.table===table&&c.from===1000),table);
});
test("monthly projection preserves telemedicine",async()=>{
 const f=fixture({turno_extendido:[row(1)]});assert.equal((await f.load("lib/db/calendario.ts").getCalendarioMes(month)).data.turnos[0].modalidad,"telemedicina");
});
test("later request/block/availability pages cannot become a partial calendar success",async()=>{
 const rows=Array.from({length:1001},(_,i)=>({...row(i),estado:"PENDIENTE",canal:"WEB",recibido_ts:"2026-09-08T12:00:00Z",activa:true}));
 for(const table of ["pedido","bloqueo","disponibilidad_profesional"]){
  const f=fixture({[table]:rows},c=>c.table===table&&c.from>0);
  assert.equal((await f.load("lib/db/calendario.ts").getCalendarioSemana(week)).ok,false,table);
 }
});
test("session failures and denied patients cannot escalate into a privileged timeline read",async()=>{
 for(const table of ["paciente","sesion"]){const f=fixture({paciente:[{id:patient,organization_id:org}]},c=>c.table===table);assert.equal((await f.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient)).ok,false);assert.equal(f.serviceCreated,0);}
 const denied=fixture({},undefined,true);assert.equal((await denied.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient)).ok,false);assert.equal(denied.serviceCreated,0);
});
test("timeline paginates RLS-visible sessions and audit events while excluding foreign records",async()=>{
 const sesion=Array.from({length:1001},(_,i)=>({id:`s-${i}`,paciente_id:patient,organization_id:org}));
 const audit_log=sesion.map((s,i)=>({id:String(i+1),organization_id:org,ts:"2026-09-08T12:00:00Z",action:"sesion.update",resource_type:"sesion",resource_id:s.id,actor_id:null,payload:{before:{soap_s_cifrado:"secret-before"},after:{soap_s_cifrado:"secret-after"}}}));
 audit_log.push({...audit_log[0],id:"9000",resource_id:"not-visible"});
 const f=fixture({paciente:[{id:patient,organization_id:org}],sesion,audit_log});const r=await f.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient);
 assert.equal(r.ok,true);assert.equal(r.data.length,1001);assert.equal(JSON.stringify(r).includes("secret"),false);
 assert.ok(f.calls.filter(c=>c.table==="audit_log").every(c=>c.filters.some(([key,value])=>key==="organization_id"&&value===org)));
});

test("timeline reads all event pages for one resource, orders ties, and stops on a failed page",async()=>{
 const audit_log=Array.from({length:1001},(_,i)=>({id:String(i+1),organization_id:org,ts:"2026-09-08T12:00:00Z",action:"paciente.update",resource_type:"paciente",resource_id:patient,actor_id:null,payload:{}}));
 const source={paciente:[{id:patient,organization_id:org}],audit_log};
 const f=fixture(source),r=await f.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient);
 assert.equal(r.ok,true);assert.equal(r.data.reduce((n:number,e:any)=>n+e.agrupados,0),1001);assert.equal(r.data[0].id,"1001");
 assert.ok(f.calls.some(c=>c.table==="audit_log"&&c.from===1000));
 const failed=fixture(source,c=>c.table==="audit_log"&&c.from>0);
 const failure=await failed.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient);assert.equal(failure.ok,false);assert.equal(JSON.stringify(failure).includes("SECRET"),false);
});
test("timeline revalidates RLS scope after reading privileged events",async()=>{
 let scopeReads=0;
 const f=fixture({paciente:[{id:patient,organization_id:org}]},c=>c.table==="sesion"&&++scopeReads>1);
 const result=await f.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient);assert.equal(result.ok,false);assert.equal(f.serviceCreated,1);
});
test("timeline reports an explicit limit instead of returning a truncated success",async()=>{
 const audit_log=Array.from({length:10001},(_,i)=>({id:String(i+1),organization_id:org,resource_id:patient}));
 const f=fixture({paciente:[{id:patient,organization_id:org}],audit_log});
 const r=await f.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient);assert.equal(r.ok,false);assert.match(r.error.message,/10\.000/);
});
test("transport exceptions remain sanitized Result errors",async()=>{
 for(const [file,method,input] of [["hoy","getDashboardHoy",day],["calendario","getCalendarioSemana",week],["calendario","getCalendarioMes",month],["ficha-timeline","getFichaTimeline",patient]] as const){
  const f=fixture({},()=>{throw Error("SECRET SDK transport");});const r=await f.load(`lib/db/${file}.ts`)[method](input);assert.equal(r.ok,false);assert.equal(JSON.stringify(r).includes("SECRET"),false);
 }
});
test("actor lookup failure cannot claim the timeline was read successfully",async()=>{
 const f=fixture({paciente:[{id:patient,organization_id:org}],audit_log:[{id:"1",organization_id:org,resource_id:patient,actor_id:"actor",ts:"2026-09-08T12:00:00Z",action:"paciente.update"}]},c=>c.table==="profile");
 assert.equal((await f.load("lib/db/ficha-timeline.ts").getFichaTimeline(patient)).ok,false);
});
test("a failed clinical session check stops agenda queries",async()=>{
 for(const [file,method,input] of [["hoy","getDashboardHoy",day],["calendario","getCalendarioSemana",week],["calendario","getCalendarioMes",month]] as const){
  const f=fixture({},undefined,true);assert.equal((await f.load(`lib/db/${file}.ts`)[method](input)).ok,false);assert.equal(f.calls.length,0);
 }
});
