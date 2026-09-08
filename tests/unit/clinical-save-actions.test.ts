import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {randomUUID} from "node:crypto";
import ts from "typescript";
const actual=createRequire(import.meta.url);
// Actual server action bodies, with only persistence/framework boundaries replaced.
function fixture(){
 const writes:Record<string,unknown>[]=[];const followups:unknown[]=[];
 let result:unknown={ok:false,error:{code:"conflict",message:"Changed"}};
 let throws=false;let followupFails=false;
 const exports:Record<string,(input:unknown)=>Promise<{ok:boolean;error?:{code:string};data?:{cerrado:boolean;aviso?:string}}>>={};
 const source=ts.transpileModule(readFileSync("app/(app)/pacientes/actions.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(source,{exports,require:(name:string)=>{
  if(name==="zod")return actual(name);
  if(name==="next/cache")return {revalidatePath:()=>{}};
  if(name==="@/lib/db/sesiones")return {upsertSesion:async(input:Record<string,unknown>)=>{writes.push(input);if(throws)throw Error("transport detail must not escape");return result;}};
  if(name==="@/lib/db/turnos")return {transitionTurno:async(input:unknown)=>{followups.push(input);if(followupFails)throw Error("provider detail");return {ok:true,data:{pagoRegistrado:true}};}};
  if(["@/lib/db/errors","@/lib/especialidades/draft","@/lib/especialidades/meta","@/lib/especialidades/psicologia/schema"].includes(name))return actual(resolve(name.slice(2)));
  return {};
 }});
 const input={turnoId:randomUUID(),pacienteId:randomUUID(),operacionId:randomUUID(),revisionEsperada:0,soap:{subjetivo:"synthetic",objetivo:"",analisis:"",plan:""}};
 return {input,writes,followups,save:exports.saveSesionFichaAction,close:exports.saveSesionYCerrarAction,setResult:(value:unknown)=>{result=value;},failTransport:()=>{throws=true;},failFollowup:()=>{followupFails=true;}};
}
test("close rejects absent revision and never starts persistence or scheduling",async()=>{
 const f=fixture();const result=await f.close({...f.input,revisionEsperada:undefined});assert.equal(result.error?.code,"validation");assert.equal(f.writes.length,0);assert.equal(f.followups.length,0);
});
test("save and close conflict cannot trigger a scheduling side effect",async()=>{
 const f=fixture();assert.equal((await f.close(f.input)).error?.code,"conflict");assert.equal(f.writes[0].intencion,"CLOSE");assert.equal(f.writes[0].revisionEsperada,0);assert.equal(f.writes[0].operacionId,f.input.operacionId);assert.equal(f.followups.length,0);
 await f.save({...f.input,autosave:true});assert.equal(f.writes[1].intencion,"AUTOSAVE");assert.equal(f.followups.length,0);
});
test("uncertain transport returns recoverable network result without pretending close succeeded",async()=>{
 const f=fixture();f.failTransport();assert.equal((await f.close(f.input)).error?.code,"network");assert.equal(f.followups.length,0);
});
test("committed atomic close remains successful when later payment followup fails",async()=>{
 const f=fixture();f.setResult({ok:true,data:{id:randomUUID(),revision:1,updatedAt:"2026-09-08T18:00:00Z",operationId:f.input.operacionId,closed:true}});f.failFollowup();const result=await f.close(f.input);assert.equal(result.ok,true);assert.equal(result.data?.cerrado,true);assert.match(result.data?.aviso??"",/guardada y cerrada/);assert.equal(f.followups.length,1);
});
