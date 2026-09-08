import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import * as mfa from "../../lib/auth/mfa-access";
import * as routes from "../../lib/auth/route-decision";
import * as results from "../../lib/db/errors";
import { redirectWithCookies, jsonWithCookies } from "../../lib/supabase/middleware";

const denied = {required:true,allowed:false,isStaff:true,hasVerifiedFactor:true,sessionValid:false};

function loadModule(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: never[]) => Promise<unknown>> = {};
  const compiled = ts.transpileModule(readFileSync(file,"utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  runInNewContext(compiled, {exports,process:{env:{NEXT_PUBLIC_SUPABASE_URL:"https://synthetic.invalid"}},require:(name:string)=>{
    if (!(name in dependencies)) throw new Error(`Unexpected boundary dependency: ${name}`);
    return dependencies[name];
  }});
  return exports;
}

function middlewareFixture(status=denied, policyError=false) {
  const response=NextResponse.next();
  response.cookies.set("synthetic-refresh","rotated",{httpOnly:true,sameSite:"lax",path:"/"});
  const calls:string[]=[];
  const client={rpc:async()=>{calls.push("policy");return {data:status,error:policyError?{message:"PRIVATE_PROVIDER_DETAIL"}:null};}};
  const loaded=loadModule("middleware.ts",{
    "@/lib/auth/mfa-access":mfa,"@/lib/auth/route-decision":routes,
    "@/lib/supabase/middleware":{
      updateSupabaseSession:async()=>({response,user:{id:"dual-user"},supabase:client}),
      redirectWithCookies,jsonWithCookies,
      resolveAudience:async()=>{calls.push("audience");return {isMember:true,isPortalAccount:true};},
    },
  });
  return {calls,async run(path:string){return await loaded.middleware(new NextRequest(`https://folio.invalid${path}`) as never) as NextResponse;}};
}

test("actual middleware rejects a dual portal account before audience lookup and preserves rotated cookies",async()=>{
  const fixture=middlewareFixture();const response=await fixture.run("/portal/consentimientos");
  assert.equal(response.status,307);assert.equal(new URL(response.headers.get("location")!).pathname,"/seguridad/mfa");
  assert.equal(response.cookies.get("synthetic-refresh")?.value,"rotated");
  assert.deepEqual(fixture.calls,["policy"]);
});

test("actual middleware denies API requests and sanitizes failed authorization without dropping cookies",async()=>{
  for(const error of [false,true]){
    const fixture=middlewareFixture(denied,error);const response=await fixture.run("/api/me/export");
    assert.equal(response.status,error?503:403);assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal(response.cookies.get("synthetic-refresh")?.value,"rotated");
    assert.ok(!(await response.text()).includes("PRIVATE_PROVIDER_DETAIL"));assert.deepEqual(fixture.calls,["policy"]);
  }
});

test("preparation disabled preserves ordinary navigation and recovery is reachable during policy outage",async()=>{
  const fixture=middlewareFixture({...denied,required:false,allowed:true});
  assert.equal((await fixture.run("/hoy")).status,200);
  for(const path of ["/seguridad/mfa","/seguridad/mfa/recuperar","/reset-password","/api/auth/signout"]){
    const recovery=middlewareFixture(denied,true);assert.equal((await recovery.run(path)).status,200);assert.deepEqual(recovery.calls,[]);
  }
});

for(const [file,method] of [
  ["lib/db/session.ts","getActiveSession"],
  ["lib/db/session.ts","listUserMemberships"],
  ["lib/db/session.ts","setActiveOrg"],
  ["lib/db/paciente-session.ts","getPacienteSession"],
]){
  test(`direct ${method} cannot bypass MFA through a selected org or patient account`,async()=>{
    const calls:string[]=[];
    const client={
      auth:{getUser:async()=>{calls.push("user");return {data:{user:{id:"dual-user"}},error:null};}},
      rpc:async()=>{calls.push("policy");return {data:denied,error:null};},
      from:()=>{throw new Error("Database data reached before MFA");},
    };
    const loaded=loadModule(file,{
      "next/headers":{cookies:()=>{throw new Error("Cookie selection reached before MFA");}},
      "@/lib/auth/mfa-access":mfa,"./errors":results,"@/lib/portal/portal-booking":{},
      "@/lib/supabase/server":{createSupabaseServerClient:async()=>client,createSupabaseServiceClient:()=>{throw new Error("Service role reached before MFA");}},
    });
    const result=await loaded[method]("10100000-0000-4000-8000-000000000010" as never) as {ok:boolean;error:{code:string}};
    assert.equal(result.ok,false);assert.equal(result.error.code,"mfa_required");assert.deepEqual(calls,["user","policy"]);
  });
}
