import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as legacyPurge from '../../lib/me/account-purge';

function route(flag:string|undefined, failure=false, authorized=true, options:{count?:unknown}={count:1001}) {
 const calls:string[]=[];
 const service={from(table:string){calls.push(`from:${table}`);const q={
  select(){calls.push('select');return q;},eq(){return q;},lt(){return q;},not(){return q;},is(){return q;},in(){return q;},
  update(){calls.push('MUTATION');throw Error('unexpected write');},delete(){calls.push('MUTATION');throw Error('unexpected delete');},
  then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){return Promise.resolve({data:table==='profile'?[{id:'profile',deletion_requested_at:'2000-01-01'}]:[],count:options.count,error:failure?{message:'SYNTHETIC PRIVATE SDK DETAILS'}:null}).then(resolve,reject);}
 };return q;},rpc:async()=>{calls.push('RPC');throw Error('unexpected pseudonymization');},auth:{admin:{deleteUser:async()=>{calls.push('AUTH_DELETE');throw Error('unexpected Auth delete');}}}};
 const exports:{GET?:(request:unknown)=>Promise<{body:Record<string,unknown>,status:number}>}={};
 const imports:Record<string,unknown>={'next/server':{NextResponse:{json:(body:unknown,init?:{status:number})=>({body,status:init?.status??200})}},'@/lib/me/account-purge':legacyPurge,'@/lib/security/verify-bearer':{verifyBearer:()=>authorized},'@/lib/supabase/server':{createSupabaseServiceClient:()=>{calls.push('client');return service;}}};
 runInNewContext(ts.transpileModule(readFileSync('app/api/cron/account-purge/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,process:{env:{ACCOUNT_PURGE_ENABLED:flag}},require:(name:string)=>{if(name in imports)return imports[name];throw Error(name);}});
 return {calls,run:()=>exports.GET!({headers:{get:()=>null}})};
}
for(const flag of [undefined,'0','1'])test(`automatic purge stays closed regardless of legacy flag ${flag}`,async()=>{
 const r=route(flag),response=await r.run();assert.equal(response.status,200);
 assert.equal(response.body.mode,'review-only');assert.equal(response.body.status,'manual_review_required');assert.equal(response.body.automatic_purge,false);assert.equal(response.body.pending_count,1001);
 assert.deepEqual(r.calls,['client','from:profile','select']);
 assert.ok(!JSON.stringify(response.body).includes('2000-01-01'));assert.equal(response.body.results,undefined);
});
test('unauthorized calls do not even open a database client',async()=>{const r=route('1',false,false);assert.equal((await r.run()).status,401);assert.deepEqual(r.calls,[]);});
test('failed pending-count read is explicit and never exposes provider text or mutates',async()=>{
 const r=route('1',true),response=await r.run();assert.equal(response.status,500);assert.ok(!JSON.stringify(response).includes('SYNTHETIC PRIVATE SDK DETAILS'));assert.deepEqual(r.calls,['client','from:profile','select']);
});

for(const count of [undefined,null,-1,'1001',Number.NaN])test(`missing or invalid count is unavailable (${String(count)})`,async()=>{
 const r=route('1',false,true,{count}),response=await r.run();
 assert.equal(response.status,500);assert.equal(response.body.pending_count,undefined);assert.deepEqual(r.calls,['client','from:profile','select']);
});
test('deployment configuration contains no automatic account-purge schedule',()=>{
 const config=JSON.parse(readFileSync('vercel.json','utf8'));assert.ok(config.crons.every((entry:{path:string})=>entry.path!=='/api/cron/account-purge'));
});
