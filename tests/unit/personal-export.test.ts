import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { encryptColumn, decryptColumn } from '../../lib/crypto';
type Row = Record<string, unknown> & { id: string };
type Outcome = { ok: boolean; data?: { filename: string; payload: Record<string, unknown> }; error?: { code: string; message: string } };
const compile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness() {
 const tables:Record<string,Row[]>={profile:[{id:'actor',email:'owner@example.invalid',nombre_cifrado:'good',apellido_cifrado:null}],member:[],organization:[],integration:[],suscripcion:[],member_invitation:[]};
 const calls:Array<{table:string;client:string;from:number}> = []; let verifyCount=0;
 const control:{ beforeVerify?:(n:number)=>void; fail?:(table:string,from:number)=>'error'|'throw'|undefined; authErrorAt?:number; auditError?:boolean; ignoreFilters?:string; invalidCount?:boolean; realCrypto?:boolean; userId?:string }={};
 const client=(kind:string)=>({from:(table:string)=>{
  if(!(table in tables)&&table!=='audit_log')throw Error('Unexpected table '+table);
  const filters:Array<(r:Row)=>boolean>=[];let from=0,to=499;
  const response=()=>{calls.push({table,client:kind,from});const fail=control.fail?.(table,from);if(fail==='throw')throw Error('SECRET transport');if(fail==='error')return {data:null,count:null,error:{message:'SECRET provider'}};
   const rows=tables[table].filter(r=>control.ignoreFilters===table||filters.every(f=>f(r))).sort((a,b)=>a.id.localeCompare(b.id));return {data:structuredClone(rows.slice(from,to+1)),count:control.invalidCount?undefined:rows.length,error:null};};
  const q={select:()=>q,returns:()=>q,eq:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return q;},in:(key:string,values:unknown[])=>{assert.ok(values.length<=200);filters.push(r=>values.includes(r[key]));return q;},is:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return q;},order:()=>q,range:(a:number,b:number)=>{from=a;to=b;return q;},maybeSingle:async()=>{const r=response();return {...r,data:r.data?.[0]??null};},then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve().then(response).then(resolve,reject)};return q;
 }});
 const cache:Record<string,unknown>={};
 const imports:Record<string,unknown>={
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>client('user'),createSupabaseServiceClient:()=>client('service')},
  '@/lib/auth/mfa-access':{verifyMfaSession:async()=>{verifyCount++;control.beforeVerify?.(verifyCount);return control.authErrorAt===verifyCount?{ok:false,error:{code:'mfa_required',message:'Segundo factor requerido.'}}:{ok:true,data:{user:{id:control.userId??'actor'}}};}},
  '@/lib/crypto':{decryptColumn:(value:unknown)=>{if(control.realCrypto)return decryptColumn(value as string|null);if(value==='bad')throw Error('SECRET ciphertext');return value==='empty'?null:value==null?null:'Nombre';}},
  '@/lib/db/errors':{ok:(data:unknown)=>({ok:true,data}),err:(code:string,message:string)=>({ok:false,error:{code,message}})},
  '@/lib/db/audit':{writeAuditEntry:async()=>control.auditError?{ok:false,error:{code:'db_error',message:'SECRET audit'}}:{ok:true}},
  '@/lib/legal/versions':{PRIVACY_VERSION:'test',TERMS_VERSION:'test'},
  '@/lib/observability/safe-log':{safeLog:()=>{}},
 };
 const load=(name:string):unknown=>{if(name in imports)return imports[name];if(name in cache)return cache[name];const exports={};cache[name]=exports;runInNewContext(compile(name.replace('@/','')+'.ts'),{exports,require:load,Date,Buffer,Set,Map,JSON});return exports;};
 const run=()=> (load('@/lib/me/personal-export') as {exportPersonalData:()=>Promise<Outcome>}).exportPersonalData();
 const member=(id:string,org:string,extra:Record<string,unknown>={})=>{tables.member.push({id,profile_id:'actor',organization_id:org,role:'OWNER',accepted_at:'2026-01-01',invited_by_id:null,deleted_at:null,...extra});tables.organization.push({id:org,deleted_at:null,nombre:org,certificado_arca_cifrado:'SECRET certificate'});};
 member('m1','o1');return {tables,calls,control,run,member};
}
test('complete export reads 1001 own memberships and all integrations, with strict allowlists',async()=>{
 const h=harness();for(let i=2;i<=1001;i++)h.member('m'+i,'o'+i);
 h.tables.integration=h.tables.member.map(m=>({id:'i'+m.id,organization_id:m.organization_id,profesional_id:m.id,proveedor:'GOOGLE_CALENDAR',access_token_cifrado:'SECRET token'}));
 const result=await h.run();assert.equal(result.ok,true);const p=result.data!.payload;
 assert.equal((p.memberships as Row[]).length,1001);assert.equal((p.integraciones as Row[]).length,1001);assert.equal((p.members as Row[]).length,1001);assert.equal(p.format_version,2);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.ok(h.calls.some(c=>c.table==='member'&&c.from===1000));assert.equal((p.profile as Row).nombre,'Nombre');
});
test('integration collection over 1000 rows on one membership is complete',async()=>{const h=harness();h.tables.integration=Array.from({length:1001},(_,i)=>({id:'i'+i,organization_id:'o1',profesional_id:'m1'}));assert.equal(((await h.run()).data!.payload.integraciones as Row[]).length,1001);});
for(const kind of ['error','throw'] as const)test(`second page ${kind} never returns partial success`,async()=>{const h=harness();h.tables.integration=Array.from({length:1001},(_,i)=>({id:'i'+i,organization_id:'o1',profesional_id:'m1'}));h.control.fail=(table,from)=>table==='integration'&&from===500?kind:undefined;const r=await h.run();assert.equal(r.ok,false);assert.equal(r.data,undefined);assert.ok(!JSON.stringify(r).includes('SECRET'));});
for(const value of ['bad','empty'])test(`non-null undecipherable profile ${value} fails explicitly`,async()=>{const h=harness();h.tables.profile[0].nombre_cifrado=value;assert.equal((await h.run()).ok,false);});
test('revoked and unaccepted memberships retain personal history but exclude current organization and billing',async()=>{const h=harness();h.member('revoked','revoked-org',{deleted_at:'2026-01-01'});h.member('pending','pending-org',{accepted_at:null,invited_by_id:'inviter'});h.tables.suscripcion=[{id:'s1',organization_id:'o1'},{id:'s2',organization_id:'revoked-org'}];const p=(await h.run()).data!.payload;assert.equal((p.memberships as Row[]).length,3);assert.equal((p.members as Row[]).find(m=>m.id==='revoked')!.organization,null);assert.equal((p.members as Row[]).find(m=>m.id==='pending')!.organization,null);assert.equal(JSON.stringify((p.suscripciones as Row[]).map(s=>s.id)),JSON.stringify(['s1']));});
test('co-owner organization never grants ownership of another professional integration; professional role excludes billing',async()=>{const h=harness();h.member('professional','o2',{role:'PROFESIONAL'});h.tables.integration=[{id:'own',organization_id:'o1',profesional_id:'m1'},{id:'other',organization_id:'o1',profesional_id:'co-owner'}];h.tables.suscripcion=[{id:'s1',organization_id:'o1'},{id:'s2',organization_id:'o2'}];const p=(await h.run()).data!.payload;assert.equal(JSON.stringify((p.integraciones as Row[]).map(r=>r.id)),JSON.stringify(['own']));assert.equal(JSON.stringify((p.suscripciones as Row[]).map(r=>r.id)),JSON.stringify(['s1']));assert.ok(h.calls.filter(c=>['organization','suscripcion'].includes(c.table)).every(c=>c.client==='user'));});
for(const table of ['member','integration','organization','suscripcion'])test(`defensive ownership rejects cross-scope ${table} rows`,async()=>{const h=harness();h.control.ignoreFilters=table;h.tables[table].push({id:'foreign',profile_id:'other',organization_id:'other-org',profesional_id:'m1',deleted_at:null});assert.equal((await h.run()).ok,false);});
test('final revalidation rejects revoked membership or reassigned integration',async()=>{for(const target of ['member','integration']){const h=harness();h.tables.integration=[{id:'i1',organization_id:'o1',profesional_id:'m1'}];h.control.beforeVerify=n=>{if(n===2){if(target==='member')h.tables.member[0].deleted_at='2026-01-01';else h.tables.integration[0].profesional_id='other';}};assert.equal((await h.run()).ok,false);}});
test('MFA refusal at start or final check yields no downloadable data',async()=>{for(const authErrorAt of [1,2,3]){const h=harness();h.control.authErrorAt=authErrorAt;const r=await h.run();assert.equal(r.ok,false);assert.equal(r.data,undefined);if(authErrorAt===1)assert.equal(h.calls.length,0);}});
test('invitations are paginated, deduplicated and omit secrets with exact owner relation',async()=>{const h=harness();h.tables.member_invitation=Array.from({length:1001},(_,i)=>({id:'v'+i,organization_id:'o1',invited_by_member_id:'m1',accepted_by_profile_id:i===0?'actor':null,email:'test@example.invalid',token_hash:'SECRET'}));const p=(await h.run()).data!.payload;assert.equal((p.invitaciones as Row[]).length,1001);assert.ok(!JSON.stringify(p).includes('SECRET'));});
test('required profile and audit errors fail without leaking provider details',async()=>{for(const target of ['profile','audit']){const h=harness();if(target==='profile')h.control.fail=t=>t==='profile'?'error':undefined;else h.control.auditError=true;const r=await h.run();assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes('SECRET'));}});


test('missing exact counts cannot certify a complete download',async()=>{const h=harness();h.control.invalidCount=true;assert.equal((await h.run()).ok,false);});
test('real AEAD ciphertext decrypts and a modified authentication tag aborts',async()=>{const h=harness();h.control.realCrypto=true;const encrypted=encryptColumn('Nombre sintético')!;h.tables.profile[0].nombre_cifrado=encrypted;assert.equal(((await h.run()).data!.payload.profile as Row).nombre,'Nombre sintético');const bytes=Buffer.from(encrypted.slice(2),'hex');bytes[bytes.length-1]^=1;h.tables.profile[0].nombre_cifrado='\\x'+bytes.toString('hex');assert.equal((await h.run()).ok,false);});
test('changed verified user or role before delivery returns conflict',async()=>{for(const target of ['user','role']){const h=harness();h.control.beforeVerify=n=>{if(n===2){if(target==='user')h.control.userId='other-user';else h.tables.member[0].role='PROFESIONAL';}};const r=await h.run();assert.equal(r.ok,false);assert.equal(r.error?.code,'conflict');}});
for(const code of ['auth_required','mfa_required','conflict','db_error','validation'])test(`HTTP and action share one failure contract (${code})`,async()=>{
 const result={ok:false,error:{code,message:'Mensaje seguro'}};let calls=0;
 const shared={exportPersonalData:async()=>{calls++;return result;}};
 const action:Record<string,()=>Promise<{ok:boolean;error:string}>>={};
 runInNewContext(compile('app/(app)/configuracion/datos/actions.ts'),{exports:action,require:(name:string)=>name==='@/lib/me/personal-export'?shared:{}});
 assert.equal((await action.exportMyDataAction()).error,result.error.message);
 const route:Record<string,()=>Promise<{status:number;headers:Record<string,string>}>>={};
 runInNewContext(compile('app/api/me/export/route.ts'),{exports:route,require:(name:string)=>name==='@/lib/me/personal-export'?shared:{NextResponse:{json:(_body:unknown,options:unknown)=>options}}});
 const response=await route.GET();assert.equal(response.status,code==='auth_required'?401:code==='mfa_required'?403:code==='conflict'?409:code==='validation'?413:503);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(calls,2);
});
test('both successful wrappers preserve the shared filename and payload',async()=>{
 const payload={ok:true,format_version:2,profile:{id:'actor'},members:[],memberships:[]};const filename='folio-export-actor.json';const shared={exportPersonalData:async()=>({ok:true,data:{payload,filename}})};
 const action:Record<string,()=>Promise<{data:unknown;filename:string}>>={};runInNewContext(compile('app/(app)/configuracion/datos/actions.ts'),{exports:action,require:(name:string)=>name==='@/lib/me/personal-export'?shared:{}});
 assert.equal(JSON.stringify(await action.exportMyDataAction()),JSON.stringify({ok:true,filename,data:payload}));
 class Response {constructor(readonly body:string,readonly options:{headers:Record<string,string>}){}}
 const route:Record<string,()=>Promise<Response>>={};runInNewContext(compile('app/api/me/export/route.ts'),{exports:route,require:(name:string)=>name==='@/lib/me/personal-export'?shared:{NextResponse:Response}});
 const result=await route.GET();assert.deepEqual(JSON.parse(result.body),payload);assert.ok(result.options.headers['Content-Disposition'].includes(filename));assert.equal(result.options.headers['Cache-Control'],'no-store');
});

// Independent review: the final Auth/MFA check is also a permission boundary.
for (const target of ['revoked', 'owner-demoted'] as const) test(`independent: ${target} during final authorization never delivers current organization data`, async () => {
 const h = harness();
 h.tables.suscripcion = [{ id: 's1', organization_id: 'o1', monto_cents: 100 }];
 h.control.beforeVerify = n => { if (n === 3) { if (target === 'revoked') h.tables.member[0].deleted_at = '2026-09-08'; else h.tables.member[0].role = 'PROFESIONAL'; } };
 const result = await h.run();
 assert.equal(result.ok, false);
 assert.equal(result.data, undefined);
});

test('independent: oversized personal export fails with a safe message before either wrapper receives data', async () => {
 const h = harness();
 h.tables.organization[0].bio = 'synthetic '.repeat(600_000);
 const result = await h.run();
 assert.equal(result.ok, false);
 assert.equal(result.data, undefined);
 assert.ok(JSON.stringify(result).length < 1000);
});
