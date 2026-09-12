import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {Client} from 'pg';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {combineChunks,stringFromBase64URL} from '@supabase/ssr';
import type {Page,Browser,BrowserContext} from '@playwright/test';
import {expect} from './local-test';
import {assertClinicalDatabase,clinicalConfig,totp} from '../../scripts/testing/clinical-config.mjs';
import {assertIntegratedPolicies,authenticateRegistered,CleanupRegistry} from './clinical-safety';

export type ClinicalSpecialty='quiropraxia'|'cardiologia'|'psicologia';
export type CaseRole='OWNER'|'ASISTENTE'|'COORDINADOR';
export interface ClinicalAccount {specialty:ClinicalSpecialty;role:CaseRole;userId:string;organizationId:string;memberId:string;serviceId:string;email:string;password:string;secret:string;client:SupabaseClient;}
export interface ClinicalFixture {
 db:Client;admin:SupabaseClient;owner:ClinicalAccount;reception?:ClinicalAccount;foreign?:ClinicalAccount;accounts:ClinicalAccount[];
 runId:string;supabaseUrl:string;anonKey:string;cleanup:CleanupRegistry;
 newPage:(browser:Browser)=>Promise<Page>;closeContext:(context:BrowserContext)=>Promise<void>;
 rememberToken:(token:string)=>void;close:()=>Promise<void>;
}
const syntheticKey=Buffer.alloc(32,37);
function encryptSynthetic(text:string):Buffer {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',syntheticKey,iv);
 const encrypted=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);
}
export function decryptSynthetic(value:Buffer|string|null):string|null {
 if(value===null)return null;
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(value.replace(/^\\x/,''),'hex');
 const decipher=createDecipheriv('aes-256-gcm',syntheticKey,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
 return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
}
const requestOptions={auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}};
export function requireSuccess(error:unknown,step:string):void {if(error)throw new Error(`Local clinical fixture failed: ${step}.`);}
async function enroll(client:SupabaseClient):Promise<string> {
 const result=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic integration authenticator'});
 requireSuccess(result.error,'TOTP enrollment');assert.ok(result.data?.type==='totp');
 const secret=result.data.totp.secret;
 const challenge=await client.auth.mfa.challenge({factorId:result.data.id});requireSuccess(challenge.error,'TOTP challenge');assert.ok(challenge.data);
 const verified=await client.auth.mfa.verify({factorId:result.data.id,challengeId:challenge.data.id,code:totp(secret)});requireSuccess(verified.error,'TOTP verification');return secret;
}
export async function assertPolicies(db:Client):Promise<void> {
 const {rows}=await db.query(`SELECT
  (SELECT application_ready FROM folio_mfa_private.policy WHERE singleton) AS mfa_ready,
  (SELECT staff_enforce_after IS NOT NULL AND staff_enforce_after<=now() FROM folio_mfa_private.policy WHERE singleton) AS mfa_enforced,
  (SELECT enabled FROM folio_attachments_private.policy WHERE singleton) AS attachments,
  (SELECT enabled_at IS NOT NULL FROM folio_instrument_private.population_policy WHERE singleton) AS population,
  (SELECT enabled_at IS NOT NULL FROM folio_session_private.policy WHERE singleton) AS sessions,
  (SELECT enabled_at IS NOT NULL FROM folio_availability_private.policy WHERE singleton) AS availability,
  (SELECT enforced FROM folio_consent_private.policy WHERE singleton) AS representatives,
  (SELECT enabled_at IS NOT NULL FROM folio_close_private.policy WHERE singleton) AS atomic_close,
  (SELECT enabled_at IS NOT NULL FROM folio_settlement_private.policy WHERE singleton) AS payment_settlement`);
 assertIntegratedPolicies(rows[0]);
}
function tokenClaims(token:string):{sub:string;session_id:string;aal:string} {
 let value;try{value=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw Error('Malformed local browser session');}
 assert.ok(typeof value?.sub==='string'&&typeof value?.session_id==='string'&&['aal1','aal2'].includes(value?.aal),'Local session identity required');return value;
}
type CookieValue={name:string;value:string};
async function browserToken(fixture:Pick<ClinicalFixture,'supabaseUrl'>,cookies:CookieValue[]):Promise<string|null> {
 const key=`sb-${new URL(fixture.supabaseUrl).hostname.split('.')[0]}-auth-token`;
 const encoded=await combineChunks(key,name=>cookies.find(c=>c.name===name)?.value);
 if(!encoded)return null;
 let value;try{value=JSON.parse(encoded.startsWith('base64-')?stringFromBase64URL(encoded.slice(7)):encoded);}catch{throw Error('Cannot decode local browser session');}
 assert.ok(typeof value?.access_token==='string','Browser access token missing');return value.access_token;
}
export function tokenClient(fixture:Pick<ClinicalFixture,'supabaseUrl'|'anonKey'>,token:string):SupabaseClient {
 return createClient(fixture.supabaseUrl,fixture.anonKey,{...requestOptions,global:{...requestOptions.global,headers:{Authorization:`Bearer ${token}`}}});
}

/** A case never enables policy or borrows accounts/data from another test. */
export async function createClinicalCaseFixture(options:{specialty?:ClinicalSpecialty;receptionRole?:'ASISTENTE'|'COORDINADOR';foreignOwner?:boolean}={}):Promise<ClinicalFixture> {
 const config=clinicalConfig(process.env);assert.equal(process.env.FOLIO_ENC_KEY,syntheticKey.toString('base64'),'Use isolated synthetic encryption');
 const db=new Client({connectionString:config.databaseUrl,connectionTimeoutMillis:8000,statement_timeout:15000,application_name:'folio-local-clinical-fixture'});
 await db.connect();const cleanup=new CleanupRegistry();cleanup.add('database',()=>db.end());
 try {
  const versions=(await readdir('supabase/migrations')).filter(name=>/^\d{14}_.+\.sql$/.test(name)).map(name=>name.slice(0,14));
  for(const required of ['20260908214500','20260912200817','20260912204646'])assert.ok(versions.includes(required),'Integrated migration repository required');
  const {rows}=await db.query(`SELECT current_setting('server_version_num')::int AS version,
   to_regclass('auth.schema_migrations') IS NOT NULL AND to_regclass('auth.mfa_challenges') IS NOT NULL AS real_auth,
   to_regclass('storage.migrations') IS NOT NULL AS real_storage,
   NOT EXISTS(SELECT 1 FROM unnest($1::text[]) v WHERE NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=v)) AS migrations_ready,
   (SELECT count(*) FROM public.organization WHERE NOT is_synthetic OR slug NOT LIKE 'folio-test-clinical-%') AS unsafe_organizations,
   (SELECT count(*) FROM auth.users WHERE coalesce(email,'') !~ '^folio-clinical-[a-z0-9-]+@example[.]test$') AS unsafe_auth_users`,[versions]);
  assertClinicalDatabase(rows[0]);await assertPolicies(db); // All nine gates before the first Auth/data write.
  const settings=await fetch(`${config.supabaseUrl}/auth/v1/settings`,{headers:{apikey:config.anonKey},signal:AbortSignal.timeout(8000)});
  assert.equal(settings.status,200);assert.equal((await settings.json()).external?.email,true);
  const admin=createClient(config.supabaseUrl,config.serviceKey,requestOptions),runId=randomUUID().replaceAll('-','').slice(0,14);
  const tokens=new Map<string,string>();
  const rememberToken=(token:string)=>{const claims=tokenClaims(token);tokens.set(claims.session_id,token);};
  async function revoke(token:string):Promise<void> {
   const claims=tokenClaims(token);const exists=await db.query('SELECT id FROM auth.sessions WHERE id=$1 AND user_id=$2',[claims.session_id,claims.sub]);
   if(exists.rowCount){const result=await admin.auth.admin.signOut(token,'local');requireSuccess(result.error,'owned session revocation');}
   const remains=await db.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[claims.session_id]);assert.equal(remains.rows[0].n,0,'Owned Auth session must be revoked');tokens.delete(claims.session_id);
  }
  cleanup.add('browser Auth sessions',async()=>{const errors=[];for(const token of [...tokens.values()])try{await revoke(token);}catch{errors.push('session');}if(errors.length)throw Error('Session revocation incomplete');});
  const accounts:ClinicalAccount[]=[];
  async function account(role:CaseRole,label:string,organizationId:string):Promise<ClinicalAccount> {
   const email=`folio-clinical-${runId}-${label}@example.test`,password=`Local-${randomBytes(24).toString('base64url')}!`;
   const created=await admin.auth.admin.createUser({email,password,email_confirm:true});requireSuccess(created.error,'synthetic Auth creation');assert.ok(created.data.user);
   const client=createClient(config.supabaseUrl,config.anonKey,requestOptions);
   const secret=await authenticateRegistered(cleanup,{
    login:async()=>{const result=await client.auth.signInWithPassword({email,password});requireSuccess(result.error,'password sign-in');},
    enroll:()=>enroll(client),revoke:async()=>{const session=await client.auth.getSession();if(session.data.session)await revoke(session.data.session.access_token);else {const remaining=await db.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1',[created.data.user!.id]);assert.equal(remaining.rows[0].n,0,'Unconfirmed login may have left an owned session');}},
   });
   const value:ClinicalAccount={role,specialty:label==='foreign'?'cardiologia':options.specialty??'quiropraxia',userId:created.data.user.id,organizationId,memberId:randomUUID(),serviceId:randomUUID(),email,password,secret,client};accounts.push(value);return value;
  }
  const owner=await account('OWNER','owner',randomUUID());
  const reception=options.receptionRole?await account(options.receptionRole,options.receptionRole.toLowerCase(),owner.organizationId):undefined;
  const foreign=options.foreignOwner?await account('OWNER','foreign',randomUUID()):undefined;
  await db.query('BEGIN');
  try {
   for(const person of accounts)await db.query(`INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,consent_pii_signed_at,consent_pii_text_version) VALUES($1,$2,$3,$4,now(),'synthetic-clinical.v1')`,[person.userId,person.email,encryptSynthetic('Personal E2E'),encryptSynthetic(person.role)]);
   for(const person of accounts.filter(a=>a.role==='OWNER')){
    await db.query(`INSERT INTO public.organization(id,slug,nombre,ciudad,provincia,timezone,especialidad,tipo,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing) VALUES($1,$2,'Consultorio sintético','Alta Gracia','Córdoba','America/Argentina/Cordoba',$3,$4,true,9,true,true,true,true)`,[person.organizationId,`folio-test-clinical-${runId}-${person===owner?'owner':'foreign'}`,person.specialty,person===owner&&reception?'CLINICA':'INDEPENDIENTE']);
   }
   for(const person of accounts)await db.query(`INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad,alcance,profesionales_gestionados) VALUES($1,$2,$3,$4,now(),$5,$6,$7,$8)`,[person.memberId,person.organizationId,person.userId,person.role,person.role==='OWNER',person.specialty,person.role==='OWNER'?'TODOS':'LISTA_PROFESIONALES',person.role==='OWNER'?[]:[owner.memberId]]);
   for(const person of accounts.filter(a=>a.role==='OWNER')){
    await db.query(`INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES($1,$2,'Consulta sintética','CONSULTA_INICIAL',30,3000000)`,[person.serviceId,person.organizationId]);
    await db.query('INSERT INTO public.servicio_profesional(organization_id,servicio_id,member_id) VALUES($1,$2,$3)',[person.organizationId,person.serviceId,person.memberId]);
   }
   await db.query('INSERT INTO public.paciente_cuenta(auth_user_id,email) VALUES($1,$2)',[owner.userId,owner.email]);await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
  for(const person of accounts){const status=await person.client.rpc('mfa_access_status');requireSuccess(status.error,'AAL2 gate');assert.deepEqual(status.data,{required:true,allowed:true,isStaff:true,hasVerifiedFactor:true,sessionValid:true});}
  const contexts=new Map<BrowserContext,()=>Promise<void>>();
  const fixture:ClinicalFixture={db,admin,owner,reception,foreign,accounts,runId,supabaseUrl:config.supabaseUrl,anonKey:config.anonKey,cleanup,rememberToken,
   newPage:async browser=>{
    const context=await browser.newContext({baseURL:config.appUrl,timezoneId:'Pacific/Auckland',serviceWorkers:'block'});let closed=false;
    const close=async()=>{if(closed)return;closed=true;try{const token=await browserToken(fixture,await context.cookies(config.appUrl));if(token)await revoke(token);}finally{await context.close();contexts.delete(context);}};
    contexts.set(context,close);cleanup.add('browser context/session',close);return context.newPage();
   },
   closeContext:async context=>{const close=contexts.get(context);assert.ok(close,'Unowned browser context');await close();},close:()=>cleanup.close(),
  };return fixture;
 }catch(error){try{await cleanup.close();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Clinical provisioning and cleanup failed');}throw error;}
}

export async function assertBrowserActor(fixture:ClinicalFixture,page:Page,account:ClinicalAccount,cookieHeader?:string):Promise<{client:SupabaseClient;userId:string;sessionId:string}> {
 const cookies=cookieHeader===undefined?await page.context().cookies('http://localhost:4420'):cookieHeader.split(';').map(part=>{const i=part.indexOf('=');return {name:part.slice(0,i).trim(),value:decodeURIComponent(part.slice(i+1).trim())};});
 const token=await browserToken(fixture,cookies);assert.ok(token,'Authenticated browser session required');fixture.rememberToken(token);
 const claims=tokenClaims(token),client=tokenClient(fixture,token);
 const user=await client.auth.getUser(token);requireSuccess(user.error,'browser Auth identity');assert.equal(user.data.user?.id,account.userId);assert.equal(claims.sub,account.userId);assert.equal(claims.aal,'aal2');
 const gate=await client.rpc('mfa_access_status');requireSuccess(gate.error,'browser AAL2 gate');assert.deepEqual(gate.data,{required:true,allowed:true,isStaff:true,hasVerifiedFactor:true,sessionValid:true});
 const member=await client.from('member').select('id,role,organization_id,profile_id').eq('id',account.memberId).single();requireSuccess(member.error,'browser member');assert.deepEqual(member.data,{id:account.memberId,role:account.role,organization_id:account.organizationId,profile_id:account.userId});
 if(account.role!=='OWNER'){const scope=await client.rpc('user_has_scope_over',{org:account.organizationId,target_member:fixture.owner.memberId});requireSuccess(scope.error,'browser reception scope');assert.equal(scope.data,true);}
 const active=await fixture.db.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1 AND user_id=$2',[claims.session_id,account.userId]);assert.equal(active.rows[0].n,1);
 return {client,userId:claims.sub,sessionId:claims.session_id};
}
/** Actual password + TOTP UI; no cookie or token injection. */
export async function loginClinical(fixture:ClinicalFixture,page:Page,account:ClinicalAccount,destination:'hoy'|'billing'='hoy'):Promise<void> {
 assert.equal(await browserToken(fixture,await page.context().cookies('http://localhost:4420')),null,'Login requires a fresh browser context');
 await page.context().addInitScript(()=>localStorage.setItem('folio.cookieConsent','denied'));
 await page.goto('/login');await page.locator('input[type=email]').fill(account.email);await page.locator('input[type=password]').fill(account.password);
 await page.getByRole('button',{name:'Ingresar a Folio',exact:true}).click();
 await page.waitForURL(/\/seguridad\/mfa(?:\?|$)/,{timeout:30000});
 const firstToken=await browserToken(fixture,await page.context().cookies('http://localhost:4420'));if(firstToken)fixture.rememberToken(firstToken);
 await expect(page.getByRole('heading',{name:'Verificación en dos pasos'})).toBeVisible();
 await page.getByLabel('Código de seis números').fill(totp(account.secret));await page.getByRole('button',{name:'Verificar código',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Verificación completada'})).toBeVisible({timeout:60000});
 await page.getByRole('link',{name:'Continuar',exact:true}).click();await page.waitForURL(destination==='hoy'?/\/hoy(?:\?|$)/:/\/configuracion\/billing(?:\?|$)/,{timeout:30000});
 await assertBrowserActor(fixture,page,account);
}
export function firstFactorClient(fixture:ClinicalFixture):SupabaseClient {
 const client=createClient(fixture.supabaseUrl,fixture.anonKey,requestOptions);
 fixture.cleanup.add('first-factor Auth session',async()=>{const session=await client.auth.getSession();const id=session.data.session?tokenClaims(session.data.session.access_token).session_id:null;const result=await client.auth.signOut({scope:'local'});requireSuccess(result.error,'first-factor signout');if(id){const remains=await fixture.db.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[id]);assert.equal(remains.rows[0].n,0);}});return client;
}
