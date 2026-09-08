import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {runInNewContext} from "node:vm";
import ts from "typescript";
const actual=createRequire(import.meta.url);
const id="11000000-0000-4000-8000-000000000001";
function load(file:string,mocks:Record<string,unknown>){const exports:Record<string,(...args:unknown[])=>Promise<unknown>>={};runInNewContext(ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,JSON,process:{env:{}},require:(name:string)=>name in mocks?mocks[name]:actual(name.startsWith("@/")?resolve(name.slice(2)):name.startsWith(".")?resolve(dirname(file),name):name)});return exports;}
test("promotion uses one atomic RPC and replay cannot create extra patients, reminders, or mails",async()=>{
 const calls:unknown[]=[];const effects:string[]=[];
 const client={rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return{error:null,data:{turnoId:id,pacienteId:id,reused:calls.length>1}};},from:()=>{throw Error("Nontransactional mutation attempted")}};
 const loaded=load("lib/db/pedidos.ts",{"@/lib/crypto":{encryptColumn:(v:unknown)=>v==null?null:"\\x01",blindIndex:()=>"hash",blindIndexPhone:()=>"hash"},"@/lib/after-response":{runAfterResponse:()=>effects.push("after")},"@/lib/email/notify":{},"@/lib/google/sync":{},"@/lib/observability/events":{trackEvent:{pacienteCreated:()=>effects.push("tracking")}},"./recordatorios":{},"./turnos":{checkSlotOcupado:async()=>false},"@/lib/supabase/server":{},"./session":{}});
 const input={pedidoId:id,organizationId:id,profesionalId:id,servicioId:id,fechaPropuesta:"2026-10-01T12:00:00Z",duracionMin:30,precioCents:100,canal:"WEB",nombre:"Synthetic Patient",telefono:"3515551100",email:null,motivo:null};
 const first=await loaded.promotePedidoToTurno(client,input),second=await loaded.promotePedidoToTurno(client,input);
 assert.deepEqual(first,second);assert.equal(calls.length,2);assert.equal((calls[0] as unknown[])[0],"promote_pedido_atomic");assert.equal(effects.length,0);
});

function publicAction(receipt:unknown=null,dbError:unknown=null){
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];let captcha=0;
 const query={select:()=>query,eq:()=>query,is:()=>query,maybeSingle:async()=>({data:{id},error:null})};
 const client={from:()=>query,rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return name==="public_booking_receipt"?{data:receipt,error:dbError}:{data:{id,autoConfirmado:true},error:dbError};}};
 const loaded=load("app/(public)/book/[slug]/actions.ts",{
  "next/headers":{headers:async()=>({get:()=>null})},"@/lib/crypto":{encryptColumn:(value:unknown)=>value?"\\x01":null},
  "@/lib/db/pedidos":{buildBookingIdentity:()=>({nombre_cifrado:"\\x01"})},"@/lib/db/profesional-destino":{resolveProfesionalPublico:async()=>({ok:true,data:id})},
  "@/lib/booking/availability":{},"@/lib/security/rate-limit":{limitByIp:async()=>({ok:true})},"@/lib/security/turnstile":{verifyTurnstile:async()=>{captcha++;return true}},"@/lib/supabase/server":{createSupabaseServiceClient:()=>client},
 });
 return{call:loaded.createPedidoPublico,calls,captcha:()=>captcha};
}
const publicInput={operacionId:id,orgSlug:"synthetic",servicioId:id,inicio:"2026-10-01T12:00:00Z",nombre:"Synthetic",telefono:"3515551100",consentAccepted:true,consentVersion:"synthetic-v1",captchaToken:"one-use"};
test("public action recovers a persisted receipt before a second one-use captcha",async()=>{const a=publicAction({id,autoConfirmado:true});const result=await a.call(publicInput) as {ok:boolean};assert.equal(result.ok,true);assert.equal(a.captcha(),0);assert.deepEqual(a.calls.map(c=>c.name),["public_booking_receipt"]);});
test("public action uses stable request hash independent from captcha and delegates the entire insert",async()=>{const a=publicAction();await a.call(publicInput);await a.call({...publicInput,captchaToken:"replacement"});assert.equal(a.calls[0].args.p_hash,a.calls[2].args.p_hash);assert.equal(a.calls[1].name,"submit_public_booking");assert.equal(a.calls[1].args.p_operation,id);});
test("public receipt database failure stops without captcha, fallback inserts or acknowledgement",async()=>{const a=publicAction(null,{code:"08006",message:"synthetic private SQL detail"});const result=await a.call(publicInput) as {ok:boolean};assert.equal(result.ok,false);assert.equal(a.captcha(),0);assert.equal(a.calls.length,1);assert.equal(JSON.stringify(result).includes("private SQL"),false);});

test("manual booking from a request forwards explicit repaired identity to atomic conversion before any write",async()=>{
 let converted:unknown;const np={nombre:"Synthetic",apellido:"Patient",telefono:"3515551100"};
 const loaded=load("app/(app)/hoy/actions.ts",{"next/cache":{revalidatePath:()=>{}},"@/lib/crypto":{},"@/lib/db/members":{},"@/lib/db/session":{getActiveSession:()=>{throw Error("Unexpected manual write path")}},"@/lib/db/pacientes":{},"@/lib/db/profesional-destino":{},"@/lib/db/turnos":{},"@/lib/supabase/server":{},"@/lib/db/pedidos":{aceptarPedidoConHorario:async(_id:string,input:unknown)=>{converted=input;return{ok:true,data:{turnoId:id,pacienteId:id}}}}});
 const result=await loaded.createTurnoAction({pedidoId:id,pacienteNuevo:np,servicioId:id,inicio:publicInput.inicio,duracionMin:30}) as {ok:boolean};assert.equal(result.ok,true);assert.equal(JSON.stringify((converted as {pacienteNuevo:unknown}).pacienteNuevo),JSON.stringify(np));
});

test("explicit manual first and last names retain compound given names",async()=>{
 const loaded=load("lib/db/pedidos.ts",{"@/lib/crypto":{encryptColumn:(v:unknown)=>v,blindIndex:()=>"hash",blindIndexPhone:()=>"hash"},"@/lib/supabase/server":{},"./session":{}});
 const identity=await loaded.buildBookingIdentity("Synthetic Compound Family","3515551100",null,id,{nombre:"Synthetic Compound",apellido:"Family"}) as {nombre_cifrado:string;apellido_cifrado:string};
 assert.equal(identity.nombre_cifrado,"Synthetic Compound");assert.equal(identity.apellido_cifrado,"Family");
});
