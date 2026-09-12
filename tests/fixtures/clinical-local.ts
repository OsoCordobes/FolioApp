import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {Client} from 'pg';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {Page} from '@playwright/test';
import {expect} from './local-test';
import {assertClinicalDatabase,assertClinicalPolicies,clinicalConfig,totp} from '../../scripts/testing/clinical-config.mjs';

export type ClinicalSpecialty='quiropraxia'|'cardiologia'|'psicologia';
export interface ClinicalAccount {specialty:ClinicalSpecialty;userId:string;organizationId:string;memberId:string;serviceId:string;email:string;password:string;secret:string;client:SupabaseClient;}
export interface ClinicalFixture {db:Client;admin:SupabaseClient;accounts:ClinicalAccount[];runId:string;supabaseUrl:string;anonKey:string;close:()=>Promise<void>;}

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
function requireSuccess(error:unknown,step:string):void {if(error)throw new Error(`Local clinical fixture failed: ${step}. No production operation was attempted.`);}

async function enroll(client:SupabaseClient):Promise<string> {
 const result=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic integration authenticator'});
 requireSuccess(result.error,'TOTP enrollment (enable local enroll and verify)');
 assert.ok(result.data?.type==='totp');
 const secret=result.data.totp.secret;
 const challenge=await client.auth.mfa.challenge({factorId:result.data.id});requireSuccess(challenge.error,'TOTP challenge');assert.ok(challenge.data);
 const verified=await client.auth.mfa.verify({factorId:result.data.id,challengeId:challenge.data.id,code:totp(secret)});requireSuccess(verified.error,'TOTP verification');
 return secret;
}

export async function assertPolicies(db:Client):Promise<void> {
 const {rows}=await db.query(`SELECT
  (SELECT application_ready FROM folio_mfa_private.policy WHERE singleton) AS mfa_ready,
  (SELECT staff_enforce_after IS NOT NULL AND staff_enforce_after<=now() FROM folio_mfa_private.policy WHERE singleton) AS mfa_enforced,
  (SELECT enabled FROM folio_attachments_private.policy WHERE singleton) AS attachments,
  (SELECT enabled_at IS NOT NULL FROM folio_instrument_private.population_policy WHERE singleton) AS population,
  (SELECT enabled_at IS NOT NULL FROM folio_session_private.policy WHERE singleton) AS sessions,
  (SELECT enabled_at IS NOT NULL FROM folio_availability_private.policy WHERE singleton) AS availability,
  (SELECT enforced FROM folio_consent_private.policy WHERE singleton) AS representatives`);
 assertClinicalPolicies(rows[0]);
}

/** This creates only synthetic local fixtures; it never starts/resets a service. */
export async function createClinicalFixture():Promise<ClinicalFixture> {
 const config=clinicalConfig(process.env);
 assert.equal(process.env.FOLIO_ENC_KEY,syntheticKey.toString('base64'),'Use only the isolated test encryption key');
 const db=new Client({connectionString:config.databaseUrl,connectionTimeoutMillis:8000,statement_timeout:15000,application_name:'folio-local-clinical-fixture'});
 await db.connect();
 try {
  const versions=(await readdir('supabase/migrations')).filter(name=>/^\d{14}_.+\.sql$/.test(name)).map(name=>name.slice(0,14));
  assert.ok(versions.includes('20260908214500'),'The clinical fixture requires the complete current migration repository, including M116');
  const {rows}=await db.query(`SELECT current_setting('server_version_num')::int AS version,
   to_regclass('auth.schema_migrations') IS NOT NULL AND to_regclass('auth.mfa_challenges') IS NOT NULL AS real_auth,
   to_regclass('storage.migrations') IS NOT NULL AS real_storage,
   NOT EXISTS(SELECT 1 FROM unnest($1::text[]) v WHERE NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=v)) AS migrations_ready,
   (SELECT count(*) FROM public.organization WHERE NOT is_synthetic OR slug NOT LIKE 'folio-test-clinical-%') AS unsafe_organizations,
   (SELECT count(*) FROM auth.users WHERE coalesce(email,'') !~ '^folio-clinical-[a-z0-9-]+@example[.]test$') AS unsafe_auth_users`,[versions]);
  assertClinicalDatabase(rows[0]);
  const settings=await fetch(`${config.supabaseUrl}/auth/v1/settings`,{headers:{apikey:config.anonKey},signal:AbortSignal.timeout(8000)});
  assert.equal(settings.status,200,'Real local Supabase Auth must be reachable before fixture writes');
  const authSettings=await settings.json();
  assert.equal(authSettings.external?.email,true,'Local password authentication must be enabled');

  const admin=createClient(config.supabaseUrl,config.serviceKey,requestOptions);
  const runId=randomUUID().replaceAll('-','').slice(0,14);
  const accounts:ClinicalAccount[]=[];
  // Enroll before creating membership: a failed enrollment cannot leave an
  // active staff member blocking the next run's one-way enforcement step.
  for(const specialty of ['quiropraxia','cardiologia','psicologia'] as const){
   const email=`folio-clinical-${runId}-${specialty}@example.test`,password=`Local-${randomBytes(24).toString('base64url')}!`;
   const created=await admin.auth.admin.createUser({email,password,email_confirm:true});requireSuccess(created.error,'synthetic Auth user creation');assert.ok(created.data.user);
   const client=createClient(config.supabaseUrl,config.anonKey,requestOptions);
   const login=await client.auth.signInWithPassword({email,password});requireSuccess(login.error,'local password sign-in');
   const secret=await enroll(client);
   accounts.push({specialty,userId:created.data.user.id,organizationId:randomUUID(),memberId:randomUUID(),serviceId:randomUUID(),email,password,secret,client});
  }
  await db.query('BEGIN');
  try {
   for(const account of accounts){
    await db.query(`INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,consent_pii_signed_at,consent_pii_text_version)
     VALUES($1,$2,$3,$4,now(),'synthetic-clinical.v1')`,[account.userId,account.email,encryptSynthetic('Profesional E2E'),encryptSynthetic(account.specialty)]);
    await db.query(`INSERT INTO public.organization(id,slug,nombre,ciudad,provincia,timezone,especialidad,onboarding_completed,onboarding_step_max,is_internal_account,is_synthetic,opt_out_analytics,opt_out_public_listing)
     VALUES($1,$2,$3,'Alta Gracia','Córdoba','America/Argentina/Cordoba',$4,true,9,true,true,true,true)`,[account.organizationId,`folio-test-clinical-${runId}-${account.specialty}`,`Consultorio sintético ${account.specialty}`,account.specialty]);
    await db.query(`INSERT INTO public.member(id,organization_id,profile_id,role,accepted_at,es_colegiado,especialidad) VALUES($1,$2,$3,'OWNER',now(),true,$4)`,[account.memberId,account.organizationId,account.userId,account.specialty]);
    await db.query(`INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES($1,$2,'Consulta sintética','CONSULTA_INICIAL',30,3000000)`,[account.serviceId,account.organizationId]);
    await db.query(`INSERT INTO public.servicio_profesional(organization_id,servicio_id,member_id) VALUES($1,$2,$3)`,[account.organizationId,account.serviceId,account.memberId]);
   }
   // The first professional is also a portal account; changing surfaces must
   // preserve the same real MFA requirement.
   await db.query('INSERT INTO public.paciente_cuenta(auth_user_id,email) VALUES($1,$2)',[accounts[0].userId,accounts[0].email]);
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}

  const reason='Dedicated synthetic local clinical integration, never production';
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:5000}).trim();assert.match(sha,/^[a-f0-9]{40}$/);
  for(const [name,args] of [
   ['mfa_enable_preparation',{p_reason:reason}],
   ['mfa_set_staff_enforcement',{p_after:new Date().toISOString(),p_reason:reason}],
   ['enable_clinical_attachments',{p_reason:reason,p_build_sha:sha,p_reference:'LOCAL-CLINICAL-SYNTHETIC'}],
   ['consent_enable_reviewed_signatures',{p_reason:reason}],
   ['enable_instrument_population_policy',{p_reason:reason}],
   ['enable_session_atomic_writes',{p_reason:reason}],
   ['enable_availability_revision',{p_reason:reason}],
  ] as const){const result=await admin.rpc(name,args);requireSuccess(result.error,`activate ${name}`);}
  await assertPolicies(db);
  for(const account of accounts){
   const status=await account.client.rpc('mfa_access_status');requireSuccess(status.error,'real AAL2 policy status');
   assert.deepEqual(status.data,{required:true,allowed:true,isStaff:true,hasVerifiedFactor:true,sessionValid:true});
  }
  return {db,admin,accounts,runId,supabaseUrl:config.supabaseUrl,anonKey:config.anonKey,close:async()=>{
   try{await Promise.allSettled(accounts.map(account=>account.client.auth.signOut({scope:'local'})));}
   finally{await db.end();}
  }};
 }catch(error){await db.end();throw error;}
}

/** Complete the actual Folio login and challenge UI; no cookie/token injection. */
export async function loginClinical(page:Page,account:ClinicalAccount,destination:'hoy'|'billing'='hoy'):Promise<void> {
 await page.context().addInitScript(()=>localStorage.setItem('folio.cookieConsent','denied'));
 await page.goto('/login');
 await page.locator('input[type=email]').fill(account.email);
 await page.locator('input[type=password]').fill(account.password);
 await page.getByRole('button',{name:/^entrar/i}).click();
 await page.waitForURL(/\/seguridad\/mfa(?:\?|$)/,{timeout:30000});
 await expect(page.getByRole('heading',{name:'Verificación en dos pasos'})).toBeVisible();
 await page.getByLabel('Código de seis números').fill(totp(account.secret));
 await page.getByRole('button',{name:'Verificar código',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Verificación completada'})).toBeVisible({timeout:15000});
 await page.getByRole('link',{name:'Continuar',exact:true}).click();
 await page.waitForURL(destination==='hoy'?/\/hoy(?:\?|$)/:/\/configuracion\/billing(?:\?|$)/,{timeout:30000});
}

export function firstFactorClient(fixture:ClinicalFixture):SupabaseClient {return createClient(fixture.supabaseUrl,fixture.anonKey,requestOptions);}
