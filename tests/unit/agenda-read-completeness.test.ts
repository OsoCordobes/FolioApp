/* eslint-disable @typescript-eslint/no-explicit-any -- Exercise transpiled server modules with a controllable PostgREST transport. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { readCompleteCollection } from "../../lib/db/complete-collection";
import * as timelineCore from "../../lib/ficha/timeline-core";
import * as rango from "../../lib/agenda/rango-horario";
import * as closeContract from "../../lib/turnos/close-contract";
import { capabilitiesFor, type Role } from "../../lib/auth/capabilities";

const org="synthetic-org",patient="synthetic-patient";
const row=(i:number)=>({id:`turno-${String(i).padStart(5,"0")}`,organization_id:org,paciente_id:patient,profesional_id:"member",inicio:"2026-09-08T13:00:00Z",duracion_min:30,estado:"CERRADO",origen:"MANUAL",paciente_tipo:"ACTIVO",servicio_nombre:"Consulta",modalidad:"telemedicina"});
type Call={table:string;service:boolean;from:number;to:number;orders:string[];filters:Array<[string,unknown]>;columns:string};
function fixture(data:Record<string,any[]>, failure?:(call:Call)=>boolean, denied=false, role:Role="OWNER"){
 const calls:Call[]=[],rpcCalls:{name:string;args:Record<string,unknown>;count?:string}[]=[];let serviceCreated=0;
 const client=(service:boolean)=>{const api:any={from(table:string){
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
 },rpc(name:string,args:Record<string,unknown>,opts?:{count?:string}){rpcCalls.push({name,args,count:opts?.count});return api.from(name).select("*",opts);}};return api;};
 const imports:Record<string,unknown>={
  "@/lib/turnos/close-contract":closeContract,
  "@/lib/observability/safe-log":{safeLog(){}},"@/lib/crypto":{decryptColumn:()=>null,tryDecrypt:()=>null},
  "@/lib/auth/capabilities":{capabilitiesFor},"./session":{getActiveSession:async()=>denied?{ok:false,error:{code:"forbidden",message:"Denied"}}:{ok:true,data:{role,esColegiado:role==="OWNER"}}},
  "./active-context":{getActiveContext:async()=>({ok:true,data:{session:{role:denied?"ASISTENTE":"OWNER",memberId:"member"},organization:{id:org}}})},
  "./errors":{ok:(data:unknown)=>({ok:true,data}),err:(code:string,message:string)=>({ok:false,error:{code,message}})},
  "./complete-collection":{readCompleteCollection},"./confirmado-via":{loadConfirmadoViaByTurnoId:async()=>({})},"./cancelado-por-paciente":{loadCanceladoPorPacienteIds:async()=>new Set()},
  "@/lib/types":{normalizeModalidad:(v:unknown)=>v==="telemedicina"?"telemedicina":"presencial"},"@/lib/agenda/rango-horario":rango,"@/lib/ficha/timeline-core":timelineCore,
  "@/lib/supabase/server":{createSupabaseServerClient:async()=>client(false),createSupabaseServiceClient:()=>{serviceCreated++;return client(true);}},
 };
 const load=(file:string)=>{const exports:Record<string,(...args:any[])=>Promise<any>>={};runInNewContext(ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Intl,Map,Set,require(name:string){if(name in imports)return imports[name];throw Error(name);}});return exports;};
 return {load,calls,rpcCalls,get serviceCreated(){return serviceCreated;}};
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


test("agenda reads payment freshness in batches and replaces the entire older view snapshot",async()=>{
 const turnos=Array.from({length:201},(_,i)=>({...row(i),pago_id:`12000000-0000-4000-8000-${String(i).padStart(12,"0")}`,pago_estado:"PENDIENTE",pago_monto_cents:100,pago_pagado_ts:null}));
 const pago=turnos.map(t=>({id:t.pago_id,turno_id:t.id,monto_cents:17500,metodo:"TRANSFERENCIA",estado:"PAGADO",pagado_ts:"2026-09-12T12:00:00Z",updated_at:"2026-09-12T12:01:00Z"}));
 const f=fixture({turno_extendido:turnos,pago});const result=await f.load("lib/db/hoy.ts").getDashboardHoy(day);
 assert.equal(result.ok,true);assert.equal(f.calls.filter(c=>c.table==="pago").length,2);
 assert.equal(result.data.turnos[0].cobro.id,pago[0].id);assert.equal(result.data.turnos[0].cobro.updatedAt,pago[0].updated_at);
 assert.equal(result.data.turnos[0].cobro.montoCents,17500);assert.equal(result.data.turnos[0].cobro.estado,"pagado");
 for(const rows of [[],[{...pago[0],turno_id:"wrong-turno"}],[{...pago[0],updated_at:null}]]){
  const broken=fixture({turno_extendido:[turnos[0]],pago:rows});assert.equal((await broken.load("lib/db/hoy.ts").getDashboardHoy(day)).ok,false);
 }
 const denied=fixture({turno_extendido:[turnos[0]],pago},c=>c.table==="pago");assert.equal((await denied.load("lib/db/hoy.ts").getDashboardHoy(day)).ok,false);
});

for(const role of ["ASISTENTE","COORDINADOR"] as const)test(`Hoy ${role} reads the entire operational agenda without querying the clinical view or sessions`,async()=>{
 const rows=Array.from({length:1001},(_,i)=>({...row(i),paciente_tipo:null,paciente_tags:null,paciente_alerta_alergia:false,nota_reserva_cifrado:null,precio_cents:null,pago_id:null}));
 const f=fixture({agenda_recepcion_dia:rows},undefined,false,role);
 const result=await f.load("lib/db/hoy.ts").getDashboardHoy({...day,profesionalId:"member"});
 assert.equal(result.ok,true);assert.equal(result.data.turnos.length,1001);
 assert.ok(result.data.turnos.every((turno:any)=>turno.postVisita.guardada===false&&turno.cobro.montoCents===null&&turno.notaReserva===null));
 assert.equal(f.rpcCalls.length,3);assert.ok(f.rpcCalls.every(call=>call.name==="agenda_recepcion_dia"&&call.count==="exact"&&call.args.p_org===org&&call.args.p_fecha===day.fechaIso&&call.args.p_profesional==="member"));
 assert.ok(f.calls.every(call=>call.table==="agenda_recepcion_dia"&&call.orders.join(",")==="inicio,id"&&!call.service));assert.equal(f.serviceCreated,0);
});

for(const role of ["ASISTENTE","COORDINADOR"] as const)test(`Hoy ${role} refuses a partial or denied operational agenda without falling back to privileged or clinical reads`,async()=>{
 for(const lateFailure of [false,true]){
  const f=fixture({agenda_recepcion_dia:Array.from({length:1001},(_,i)=>row(i))},call=>call.table==="agenda_recepcion_dia"&&(!lateFailure||call.from>0),false,role);
  const result=await f.load("lib/db/hoy.ts").getDashboardHoy(day);
  assert.equal(result.ok,false);assert.ok(f.calls.every(call=>call.table==="agenda_recepcion_dia"));assert.equal(f.serviceCreated,0);
 }
});

test("Hoy ASISTENTE still verifies the complete current payment after its operational agenda read",async()=>{
 const id="12000000-0000-4000-8000-000000000001",turno={...row(1),pago_id:id,pago_estado:"PENDIENTE",pago_monto_cents:100,pago_pagado_ts:null};
 const pago={id,turno_id:turno.id,monto_cents:17500,metodo:"TRANSFERENCIA",estado:"PAGADO",pagado_ts:"2026-09-13T04:00:00Z",updated_at:"2026-09-13T04:01:00Z"};
 const f=fixture({agenda_recepcion_dia:[turno],pago:[pago]},undefined,false,"ASISTENTE");
 const result=await f.load("lib/db/hoy.ts").getDashboardHoy(day);
 assert.equal(result.ok,true);assert.equal(result.data.turnos[0].cobro.id,id);assert.equal(result.data.turnos[0].cobro.estado,"pagado");assert.equal(result.data.turnos[0].cobro.updatedAt,pago.updated_at);
 assert.ok(f.calls.every(call=>["agenda_recepcion_dia","pago"].includes(call.table)));assert.equal(f.serviceCreated,0);
 const missing=fixture({agenda_recepcion_dia:[turno],pago:[]},undefined,false,"ASISTENTE");assert.equal((await missing.load("lib/db/hoy.ts").getDashboardHoy(day)).ok,false);
});
