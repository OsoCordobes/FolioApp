import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {runInNewContext} from "node:vm";
import ts from "typescript";
const actual=createRequire(import.meta.url);
const id="10600000-0000-4000-8000-000000000010";
test("writer hash distinguishes omitted scores (preserve) from explicit null (clear)",async()=>{
 const hashes:string[]=[];
 const client={rpc:async(_name:string,args:Record<string,unknown>)=>{hashes.push(String(args.p_request_hash));return{error:null,data:{id,revision:2,updatedAt:"2026-09-08T12:00:00Z",closed:false,operationId:id}};}};
 const file="lib/db/sesiones.ts",exports:Record<string,(input:unknown)=>Promise<unknown>>={};
 const mocks:Record<string,unknown>={"@/lib/crypto":{},"@/lib/supabase/server":{createSupabaseServerClient:async()=>client},"./session":{getActiveSession:async()=>({ok:true,data:{organizationId:id}})}};
 runInNewContext(ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>name in mocks?mocks[name]:actual(name.startsWith("@/")?resolve(name.slice(2)):name.startsWith(".")?resolve(dirname(file),name):name)});
 const base={turnoId:id,pacienteId:id,operacionId:id,revisionEsperada:1,intencion:"SAVE"};
 await exports.upsertSesion(base);await exports.upsertSesion({...base,evaAntes:null});await exports.upsertSesion({...base,evaDespues:null});
 assert.equal(new Set(hashes).size,3,"Preserve and clear are distinct write intents");
});

test("writer derives commit context from scoped server rows, not caller metadata, and preserves conflict",async()=>{
 const calls:Record<string,unknown>[]=[];
 const rows:Record<string,unknown>={turno:{organization_id:id,paciente_id:id,profesional_id:id,inicio:"2026-09-08T12:00:00Z"},member:{especialidad:"psicologia"},organization:{especialidad:"quiropraxia"},paciente:{identidad_id:id,identidad:{id,fecha_nacimiento:"1990-01-01",deleted_at:null}},sesion:null};
 const client={rpc:async(_name:string,args:Record<string,unknown>)=>{calls.push(args);return args.p_data===null?{data:null,error:null}:{data:null,error:{code:"40001",message:"Synthetic context conflict"}};},from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,is:()=>q,maybeSingle:async()=>({data:rows[table],error:null})};return q;
 }};
 const file="lib/db/sesiones.ts",exports:Record<string,(input:unknown)=>Promise<{ok:boolean;error?:{code:string}}>>={};
 const mocks:Record<string,unknown>={"@/lib/crypto":{encryptColumn:(value:unknown)=>value==null?null:"synthetic"},"@/lib/supabase/server":{createSupabaseServerClient:async()=>client},"./session":{getActiveSession:async()=>({ok:true,data:{organizationId:id,memberId:id}})}};
 runInNewContext(ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>name in mocks?mocks[name]:actual(name.startsWith("@/")?resolve(name.slice(2)):name.startsWith(".")?resolve(dirname(file),name):name)});
 const result=await exports.upsertSesion({turnoId:id,pacienteId:id,operacionId:id,revisionEsperada:0,intencion:"SAVE",soap:{s:"Synthetic note"},p_context:{profesional_id:"forged",fecha_nacimiento:"2015-01-01"}});
 assert.equal(result.error?.code,"conflict");assert.equal(calls.length,2);
 const context=calls[1].p_context as Record<string,unknown>;
 assert.equal(context.profesional_id,id);assert.equal(context.member_especialidad,"psicologia");assert.equal(context.inicio,"2026-09-08T12:00:00Z");assert.equal(context.fecha_nacimiento,"1990-01-01");
});
