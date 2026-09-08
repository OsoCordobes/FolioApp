import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import test from "node:test";
import ts from "typescript";
const actual=createRequire(import.meta.url);
const id="10300000-0000-4000-8000-000000000070";
function fixture(options:{denied?:boolean;missing?:boolean;lookupError?:boolean;throws?:boolean;hash?:string;pathValid?:boolean;patientDenied?:boolean}={}){
 const calls:string[]=[]; const bytes=new Uint8Array([1,2,3]);
 const row={organization_id:"org",paciente_id:"patient",firma_storage_path:"consentimientos-firmados/org/patient/old.pdf",participantes:[{path:"consentimientos-firmados/org/patient/new.png",sha256:options.hash??createHash("sha256").update(bytes).digest("hex")}]};
 const client={from(table:string){calls.push(table);const q={select:()=>q,eq:()=>q,is:()=>q,maybeSingle:async()=>{if(options.throws)throw Error("private transport credential detail");return{data:options.missing||(table==="paciente"&&options.patientDenied)?null:row,error:options.lookupError?{}:null};}};return q;}};
 const exports:{GET?:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>}={};
 const js=ts.transpileModule(readFileSync("app/api/consentimientos/[id]/firma/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(js,{exports,Response,Request,URL,Uint8Array,require:(name:string)=>{
  if(name==="next/server")return {NextResponse:{json:(data:unknown,init:ResponseInit)=>Response.json(data,init)}};
  if(name==="@/lib/auth/mfa-access")return {verifyMfaSession:async()=>{calls.push("mfa");return options.denied?{ok:false,error:{code:"mfa_required"}}:{ok:true};}};
  if(name==="@/lib/db/portal-consentimientos")return {firmaPathMatchesFicha:()=>options.pathValid!==false};
  if(name==="@/lib/consentimientos/helpers")return {pathSinBucket:(v:string)=>v.slice(25)};
  if(name==="@/lib/storage/clinical-files")return {inspectClinicalFile:()=>({ok:true,data:{mime:"image/png",extension:"png"}})};
  if(name==="@/lib/supabase/server")return {createSupabaseServerClient:async()=>client,createSupabaseServiceClient:()=>{calls.push("service");return {storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null})})}};}};
  return actual(name);
 }});
 return {calls,run:()=>exports.GET!(new Request("https://test.invalid/api/consentimientos/"+id+"/firma"),{params:Promise.resolve({id})})};
}
test("signature evidence rechecks MFA and current row permissions before privileged Storage",async()=>{
 for(const opts of [{denied:true},{missing:true},{lookupError:true},{pathValid:false},{patientDenied:true}]){const f=fixture(opts),r=await f.run();assert.ok(r.status>=400);assert.match(r.headers.get("cache-control")!,/no-store/);assert.ok(!f.calls.includes("service"));}
});
test("signature evidence detects changed bytes and returns no drawing",async()=>{const f=fixture({hash:"a".repeat(64)}),r=await f.run();assert.equal(r.status,422);assert.match(r.headers.get("cache-control")!,/no-store/);});
test("signature evidence successful read revalidates both guards on every request",async()=>{const f=fixture();for(let i=0;i<2;i++){const r=await f.run();assert.equal(r.status,200);assert.equal(r.headers.get("content-type"),"image/png");assert.match(r.headers.get("cache-control")!,/no-store/);}assert.deepEqual(f.calls,["mfa","consentimiento","paciente","service","mfa","consentimiento","paciente","service"]);});
test("unexpected signature transport failures remain sanitized and private",async()=>{const f=fixture({throws:true}),r=await f.run();assert.equal(r.status,503);assert.match(r.headers.get("cache-control")!,/no-store/);assert.doesNotMatch(await r.text(),/credential|transport/);assert.ok(!f.calls.includes("service"));});
