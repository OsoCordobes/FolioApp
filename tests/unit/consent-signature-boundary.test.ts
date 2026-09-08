import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {runInNewContext} from "node:vm";
import test from "node:test";
import ts from "typescript";
const actual=createRequire(import.meta.url);
const ids={pacienteId:"10300000-0000-4000-8000-000000000040",plantillaId:"10300000-0000-4000-8000-000000000050",evaluacionId:"10300000-0000-4000-8000-000000000070"};
const org="10300000-0000-4000-8000-000000000010";
function fixture(options:{modo?:string;lookupError?:string;revoked?:boolean;existing?:boolean}={}){
 const calls:string[]=[];const rows:Record<string,unknown>={consentimiento_evaluacion:{id:ids.evaluacionId,modo:options.modo??"AUTONOMO",tipo:"GENERAL",representante_id:options.modo==="ASISTIDO"?"rep":null,revocado_en:null,vigente_hasta:"2099-01-01"},
  tutor_legal:{estado_verificacion:options.revoked?"REVOCADA":"VERIFICADA",vigencia_desde:"2000-01-01",vigencia_hasta:"2099-01-01",revocado_en:null,alcances:["CONSENTIMIENTO"],identidad_verificada:true,vinculo_verificado:true},consentimiento:options.existing?{id:"existing"}:null};
 let inserted:Record<string,unknown>|null=null;
 const client={from(table:string){const query:Record<string,unknown>={};for(const method of ["select","eq","is"])query[method]=()=>query;
  query.insert=(value:Record<string,unknown>)=>{calls.push("insert");inserted=value;return query;};
  query.single=query.maybeSingle=async()=>{calls.push(table);return {data:inserted?{id:"new"}:rows[table],error:options.lookupError===table?{}:null};};return query;},
  storage:{from:()=>({upload:async()=>{calls.push("upload");return {error:null};}})}};
 const file="lib/consentimientos/signature-upload.ts", exports:{uploadReviewedConsent?:(form:FormData,audience:string)=>Promise<{ok:boolean;data?:unknown}>}={};
 const js=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(js,{exports,Blob,Buffer,FormData,Uint8Array,Date,require:(name:string)=>{
  if(name==="next/headers")return {headers:async()=>new Map()};
  if(name==="@/lib/db/session")return {getActiveSession:async()=>({ok:true,data:{role:"OWNER",organizationId:org}})};
  if(name==="@/lib/db/paciente-session")return {getPacienteSession:async()=>({ok:true,data:{pacientes:[{pacienteId:ids.pacienteId,organizationId:org}]}})};
  if(name==="@/lib/supabase/server")return {createSupabaseServerClient:async()=>client};
  if(name==="@/lib/storage/clinical-files")return {inspectClinicalFile:()=>({ok:true,data:{mime:"image/png"}})};
  return actual(name.startsWith("@/")?resolve(name.slice(2)):name.startsWith(".")?resolve(dirname(file),name):name);
 }});
 const form=new FormData();for(const [key,value] of Object.entries(ids))form.set(key,value);form.set("file",new Blob(["synthetic drawing"],{type:"image/png"}));
 return {calls,form,run:(audience="staff")=>exports.uploadReviewedConsent!(form,audience),getInserted:()=>inserted};
}
test("assessment and representative lookup errors stop before any upload or attribution",async()=>{
 for(const table of ["consentimiento_evaluacion","tutor_legal"]){const f=fixture({modo:"ASISTIDO",lookupError:table});assert.equal((await f.run()).ok,false);assert.ok(!f.calls.includes("upload"));assert.ok(!f.calls.includes("insert"));}
});
test("revoked representation and pending assessment cannot collect signatures",async()=>{
 for(const options of [{modo:"ASISTIDO",revoked:true},{modo:"PENDIENTE"}]){const f=fixture(options);assert.equal((await f.run()).ok,false);assert.ok(!f.calls.includes("upload"));}
});
test("portal cannot use an assisted assessment as autonomous consent",async()=>{const f=fixture({modo:"ASISTIDO"});assert.equal((await f.run("portal")).ok,false);assert.ok(!f.calls.includes("upload"));});
test("assisted consent requires both drawings before either is uploaded",async()=>{const f=fixture({modo:"ASISTIDO"});assert.equal((await f.run()).ok,false);assert.ok(!f.calls.includes("upload"));});
test("assisted consent preserves separate hashes, paths and participant roles",async()=>{
 const f=fixture({modo:"ASISTIDO"});f.form.set("fileRepresentante",new Blob(["representative drawing"],{type:"image/png"}));assert.equal((await f.run()).ok,true);
 assert.equal(f.calls.filter(v=>v==="upload").length,2);
 const parts=f.getInserted()!.participantes as Array<{rol:string;path:string;sha256:string}>;
 assert.deepEqual(Array.from(parts,p=>p.rol),["PACIENTE","REPRESENTANTE"]);assert.notEqual(parts[0].path,parts[1].path);assert.notEqual(parts[0].sha256,parts[1].sha256);
});
test("a lost-response retry returns the already recorded evaluation without replacing evidence",async()=>{const f=fixture({existing:true});assert.equal((await f.run()).ok,true);assert.ok(!f.calls.includes("upload"));assert.ok(!f.calls.includes("insert"));});
