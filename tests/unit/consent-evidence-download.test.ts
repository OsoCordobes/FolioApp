import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import test from "node:test";
import ts from "typescript";
const actual=createRequire(import.meta.url);
const id="10300000-0000-4000-8000-000000000070";
function fixture(options:{denied?:boolean;missing?:boolean;lookupError?:boolean;throws?:boolean;hash?:string;pathValid?:boolean;patientDenied?:boolean;deferDownload?:boolean}={}){
 const calls:string[]=[]; const bytes=new Uint8Array([1,2,3]);
 const row={organization_id:"org",paciente_id:"patient",firma_storage_path:"consentimientos-firmados/org/patient/old.pdf",participantes:[{path:"consentimientos-firmados/org/patient/new.png",sha256:options.hash??createHash("sha256").update(bytes).digest("hex")}]};
 const state={row,denied:options.denied??false,missing:options.missing??false,lookupError:options.lookupError??false,patientDenied:options.patientDenied??false,userId:"reader-1"};
 let markDownloadStarted=()=>{};const downloadStarted=new Promise<void>(resolve=>{markDownloadStarted=resolve;});
 let releaseDownload=()=>{};const downloadGate=options.deferDownload?new Promise<void>(resolve=>{releaseDownload=resolve;}):Promise.resolve();
 const client={from(table:string){calls.push(table);const q={select:()=>q,eq:()=>q,is:()=>q,maybeSingle:async()=>{if(options.throws)throw Error("private transport credential detail");return{data:state.missing||(table==="paciente"&&state.patientDenied)?null:table==="paciente"?{id:state.row.paciente_id}:structuredClone(state.row),error:state.lookupError?{}:null};}};return q;}};
 const exports:{GET?:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>}={};
 const js=ts.transpileModule(readFileSync("app/api/consentimientos/[id]/firma/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(js,{exports,Response,Request,URL,Uint8Array,require:(name:string)=>{
  if(name==="next/server")return {NextResponse:{json:(data:unknown,init:ResponseInit)=>Response.json(data,init)}};
  if(name==="@/lib/auth/mfa-access")return {verifyMfaSession:async()=>{calls.push("mfa");return state.denied?{ok:false,error:{code:"mfa_required"}}:{ok:true,data:{user:{id:state.userId}}};}};
  if(name==="@/lib/db/portal-consentimientos")return {firmaPathMatchesFicha:()=>options.pathValid!==false};
  if(name==="@/lib/consentimientos/helpers")return {pathSinBucket:(v:string)=>v.slice(25)};
  if(name==="@/lib/storage/clinical-files")return {inspectClinicalFile:()=>({ok:true,data:{mime:"image/png",extension:"png"}})};
  if(name==="@/lib/supabase/server")return {createSupabaseServerClient:async()=>client,createSupabaseServiceClient:()=>{calls.push("service");return {storage:{from:()=>({download:async()=>{markDownloadStarted();await downloadGate;return {data:new Blob([bytes]),error:null};}})}};}};
  return actual(name);
 }});
 return {calls,state,downloadStarted,releaseDownload,run:(index=0)=>exports.GET!(new Request("https://test.invalid/api/consentimientos/"+id+"/firma?participante="+index),{params:Promise.resolve({id})})};
}

test("signature evidence refuses bytes when MFA is revoked while Storage is pending",async()=>{
 const f=fixture({deferDownload:true});const response=f.run();await f.downloadStarted;
 f.state.denied=true;f.releaseDownload();const result=await response;
 assert.equal(result.status,403);assert.match(result.headers.get("cache-control")!,/no-store/);
 assert.equal(result.headers.get("content-type")?.includes("application/json"),true);
});
test("signature evidence refuses bytes when access or evidence changes during Storage",async()=>{
 const changes:[string,(f:ReturnType<typeof fixture>)=>void][]=[
  ["consent access",f=>{f.state.missing=true;}],
  ["patient access",f=>{f.state.patientDenied=true;}],
  ["lookup error",f=>{f.state.lookupError=true;}],
  ["principal",f=>{f.state.userId="reader-2";}],
  ["organization",f=>{f.state.row.organization_id="other-org";}],
  ["patient",f=>{f.state.row.paciente_id="other-patient";}],
  ["path",f=>{f.state.row.participantes[0].path="consentimientos-firmados/org/patient/other.png";}],
  ["hash",f=>{f.state.row.participantes[0].sha256="a".repeat(64);}]
 ];
 for(const [label,change] of changes){
  const f=fixture({deferDownload:true});const response=f.run();await f.downloadStarted;
  change(f);f.releaseDownload();const result=await response;
  assert.ok(result.status>=400,label);assert.match(result.headers.get("cache-control")!,/no-store/,label);
  assert.equal(result.headers.get("content-type")?.includes("application/json"),true,label);
  assert.notDeepEqual(new Uint8Array(await result.arrayBuffer()),new Uint8Array([1,2,3]),label);
 }
});
test("signature evidence rechecks MFA and current row permissions before privileged Storage",async()=>{
 for(const opts of [{denied:true},{missing:true},{lookupError:true},{pathValid:false},{patientDenied:true}]){const f=fixture(opts),r=await f.run();assert.ok(r.status>=400);assert.match(r.headers.get("cache-control")!,/no-store/);assert.ok(!f.calls.includes("service"));}
});
test("signature evidence detects changed bytes and returns no drawing",async()=>{const f=fixture({hash:"a".repeat(64)}),r=await f.run();assert.equal(r.status,422);assert.match(r.headers.get("cache-control")!,/no-store/);});
test("current portal and professional readers keep access to participant and legacy evidence",async()=>{
 for(const reader of ["portal-reader","professional-reader"]){
  const f=fixture();f.state.userId=reader;
  f.state.row.participantes.push({path:"consentimientos-firmados/org/patient/second.png",sha256:f.state.row.participantes[0].sha256});
  for(const index of [0,1]){const result=await f.run(index);assert.equal(result.status,200,`${reader}:${index}`);assert.equal(result.headers.get("content-type"),"image/png");}
  f.state.row.participantes=[];
  const legacy=await f.run();assert.equal(legacy.status,200,`${reader}:legacy`);
  assert.match(legacy.headers.get("cache-control")!,/no-store/);
  assert.deepEqual(f.calls,Array(3).fill(["mfa","consentimiento","paciente","service","mfa","consentimiento","paciente"]).flat());
 }
});
test("unexpected signature transport failures remain sanitized and private",async()=>{const f=fixture({throws:true}),r=await f.run();assert.equal(r.status,503);assert.match(r.headers.get("cache-control")!,/no-store/);assert.doesNotMatch(await r.text(),/credential|transport/);assert.ok(!f.calls.includes("service"));});
