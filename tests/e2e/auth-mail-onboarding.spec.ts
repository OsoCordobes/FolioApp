/** B01/B02: real local Auth and SMTP, synthetic people only. One required
 * journey deliberately avoids the admin-createUser shortcut and all clinical
 * fixtures. Mail bodies/action URLs and passwords are never logged. */
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {expect,test,type Browser,type Page} from '../fixtures/local-test';

const APP='http://localhost:4430';
const MAIL='http://127.0.0.1:55424';
const API='http://127.0.0.1:55421';
const OLD_PASSWORD='SyntheticProof123!';
const NEW_PASSWORD='SyntheticChanged456!';

function requireLocalRuntime(){
 if(process.env.FOLIO_TEST_REAL_SUPABASE!=='1'||process.env.NODE_ENV==='production')
  throw Error('auth_proof_requires_dedicated_local_auth');
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!==API||process.env.NEXT_PUBLIC_APP_URL!==APP)
  throw Error('auth_proof_local_target_mismatch');
 if(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY||process.env.TURNSTILE_SECRET_KEY)
  throw Error('auth_proof_turnstile_must_use_existing_development_path');
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('auth_proof_local_read_key_missing');
}

async function mailAction(email:string,kind:'signup'|'recovery',afterId?:string):Promise<{url:string;id:string}>{
 const mailbox=email.split('@')[0];
 if(!/^folio-proof-[a-z0-9-]+$/.test(mailbox))throw Error('auth_proof_mailbox_invalid');
 const endpoint=`${MAIL}/api/v1/mailbox/${mailbox}`;
 const until=Date.now()+45_000;
 let messagesSeen=0,urlsSeen=0,originSeen=false,pathSeen=false,typeSeen=false;
 while(Date.now()<until){
  const listing=await fetch(endpoint,{signal:AbortSignal.timeout(3000)});
  if(!listing.ok)throw Error('auth_proof_mailbox_unavailable');
  const messages=await listing.json() as Array<{id:string}>;
  if(!Array.isArray(messages))throw Error('auth_proof_mailbox_shape');
  messagesSeen=Math.max(messagesSeen,Math.min(9,messages.length));
  for(const item of [...messages].reverse()){
   if(!/^[a-zA-Z0-9-]+$/.test(item.id)||item.id===afterId)continue;
   const response=await fetch(`${endpoint}/${item.id}`,{signal:AbortSignal.timeout(3000)});
   if(!response.ok)throw Error('auth_proof_message_unavailable');
   const message=await response.json() as {body?:{text?:string;html?:string}};
   const body=`${message.body?.text??''}\n${message.body?.html??''}`.replace(/&amp;/g,'&');
   const candidates=body.match(/https?:\/\/[^\s<>"']+/g)??[];
   urlsSeen=Math.max(urlsSeen,Math.min(9,candidates.length));
   for(const candidate of candidates){
    let action:URL;try{action=new URL(candidate);}catch{continue;}
    if(action.origin!==API)continue;
    originSeen=true;
    if(action.pathname!=='/auth/v1/verify')continue;
    pathSeen=true;
    if(action.searchParams.get('type')!==kind)continue;
    typeSeen=true;
    if(!action.searchParams.has('token')&&!action.searchParams.has('token_hash'))continue;
    const redirect=action.searchParams.get('redirect_to');
    if(redirect && ![`${APP}/api/auth/callback`,`${APP}/reset-password`].includes(redirect))throw Error('auth_proof_redirect_mismatch');
    return {url:action.href,id:item.id};
   }
  }
  await new Promise(resolve=>setTimeout(resolve,700));
 }
 console.log(`auth_proof_mail_diagnostic:kind=${kind} messages=${messagesSeen} urls=${urlsSeen} origin=${originSeen?1:0} path=${pathSeen?1:0} type=${typeSeen?1:0}`);
 throw Error(`auth_proof_${kind}_mail_missing`);
}

async function openAction(page:Page,url:string){
 // evaluate avoids Playwright failure logs echoing one-use action URLs.
 await page.evaluate(href=>{window.location.assign(href);},url);
}
async function verifyBrowserAuthCookie(page:Page,email:string){
 // Only an access token already present in the browser cookie is sent to the
 // isolated Auth service. No refresh, write, token, or identity leaves this test.
 const cookies=await page.context().cookies(APP);
 const base=cookies.find(cookie=>/^sb-[a-z0-9-]+-auth-token$/.test(cookie.name));
 const key=base?.name??cookies.find(cookie=>/^sb-[a-z0-9-]+-auth-token\.0$/.test(cookie.name))?.name.slice(0,-2);
 if(!key)return {kind:'missing',valid:false,same:false};
 let serialized=base?.value;
 if(!serialized){
  const chunks=cookies.filter(cookie=>cookie.name.startsWith(`${key}.`));
  const ordered=chunks.sort((a,b)=>Number(a.name.slice(key.length+1))-Number(b.name.slice(key.length+1)));
  if(ordered.some((cookie,index)=>cookie.name!==`${key}.${index}`))return {kind:'chunk_gap',valid:false,same:false};
  serialized=ordered.map(cookie=>cookie.value).join('');
 }
 if(!serialized)return {kind:'empty',valid:false,same:false};
 let session:{access_token?:unknown};
 try{
  const json=serialized.startsWith('base64-')?Buffer.from(serialized.slice(7),'base64url').toString('utf8'):serialized;
  session=JSON.parse(json) as {access_token?:unknown};
 }catch{return {kind:'decode_failed',valid:false,same:false};}
 if(!session||typeof session!=='object'||typeof session.access_token!=='string')return {kind:'token_missing',valid:false,same:false};
 const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!anon)return {kind:'config_missing',valid:false,same:false};
 try{
  const client=createClient(API,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(session.access_token);
  return {kind:error?'auth_rejected':data.user?'valid':'auth_missing',valid:!error&&Boolean(data.user),same:!error&&data.user?.email===email};
 }catch{return {kind:'auth_unavailable',valid:false,same:false};}
}
async function consentCookie(page:Page){
 await page.addInitScript(()=>{try{localStorage.setItem('folio.cookieConsent','denied');}catch{}});
}
async function login(page:Page,email:string,password:string){
 await page.goto('/login');
 await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);
 await page.locator('input[type="password"]').fill(password);
 await page.getByRole('button',{name:'Ingresar a Folio'}).click();
}
async function logout(page:Page){
 await page.goto('/seguridad/mfa');
 await expect(page.getByRole('heading',{name:'Verificación en dos pasos'})).toBeVisible();
 await page.getByRole('button',{name:'Cerrar sesión'}).click();
 await page.waitForURL(APP+'/');
}
async function persistedOrganization(email:string,tipo:'INDEPENDIENTE'|'CLINICA',name:string){
 const service=createClient(API,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const profile=await service.from('profile').select('id').eq('email',email).single();
 expect(profile.error).toBeNull();
 const member=await service.from('member').select('organization_id').eq('profile_id',profile.data!.id).eq('role','OWNER').single();
 expect(member.error).toBeNull();
 const organization=await service.from('organization').select('tipo,nombre,ciudad,onboarding_step_max').eq('id',member.data!.organization_id).single();
 expect(organization.error).toBeNull();
 expect(organization.data).toMatchObject({tipo,nombre:name,ciudad:'Alta Gracia'});
 expect(Number(organization.data!.onboarding_step_max)).toBeGreaterThanOrEqual(3);
}

async function oneMode(browser:Browser,tipo:'INDEPENDIENTE'|'CLINICA'){
 const email=`folio-proof-${tipo.toLowerCase()}-${randomUUID().slice(0,8)}@example.test`;
 const practice=tipo==='CLINICA'?'Clínica Sintética B02':'Consultorio Sintético B01';
 const context=await browser.newContext();
 const page=await context.newPage();
 await consentCookie(page);
 await page.goto('/login');
 await page.getByRole('link',{name:/crear cuenta/i}).first().click();
 await page.getByRole('radio',{name:tipo==='CLINICA'?/Clínica/:/Profesional independiente/}).check();
 if(tipo==='CLINICA')await page.getByRole('radio',{name:'No, administro la clínica'}).check();
 await page.getByRole('button',{name:'Seguir con esta opción'}).click();
 await expect(page.getByRole('heading',{name:'Empezá creando tu cuenta.'})).toBeVisible();
 await page.locator('input[type="email"]').fill(email);
 await page.locator('input[type="password"]').fill(OLD_PASSWORD);
 await page.locator('input[type="checkbox"]').first().check();
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Un paso más: tu email.'})).toBeVisible();
 const confirmation=await mailAction(email,'signup');
 console.log(`auth_proof_stage:${tipo.toLowerCase()}_signup_mail_captured`);
 const visited={verify:false,callback:false,onboarding:false};
 const callback={status:'none',to:'none'};
 let callbackLocation:Promise<void>|null=null;
 page.on('response',response=>{
  try{
   const url=new URL(response.url());
   if(url.origin===API&&url.pathname==='/auth/v1/verify')visited.verify=true;
   if(url.origin===APP&&url.pathname==='/onboarding')visited.onboarding=true;
   if(url.origin===APP&&url.pathname==='/api/auth/callback'){
    visited.callback=true;
    callback.status=[301,302,303,307,308].includes(response.status())?'redirect':response.status()===200?'ok':'other';
    callbackLocation=(async()=>{
     const location=await response.headerValue('location');
     if(!location)return;
     const target=new URL(location,APP);
     callback.to=target.origin!==APP?'other':({
      '/onboarding':'onboarding','/login':'login','/seguridad/mfa':'mfa',
      '/hoy':'hoy','/reset-password':'reset',
     } as Record<string,string>)[target.pathname]??'other';
    })().catch(()=>{callback.to='other';});
   }
  }catch{/* no diagnostic from an unparseable URL */}
 });
 await openAction(page,confirmation.url);
 await page.waitForURL(/\/onboarding(?:\?|$)/,{timeout:30_000});
 await expect(page.getByRole('heading',{name:'¿Cómo vas a usar Folio?'})).toBeVisible();
 await page.getByRole('radio',{name:tipo==='CLINICA'?/Clínica/:/Profesional independiente/}).check();
 if(tipo==='CLINICA')await page.getByRole('radio',{name:'No, administro la clínica'}).check();
 await page.getByRole('button',{name:'Seguir con esta opción'}).click();
 try{
  await expect(page.getByRole('heading',{name:'Confirmemos que sos vos.'})).toBeVisible();
 }catch{
  const choice=await page.getByRole('heading',{name:'¿Cómo vas a usar Folio?'}).isVisible();
  const registration=await page.getByRole('heading',{name:'Empezá creando tu cuenta.'}).isVisible();
  const consent=await page.getByRole('heading',{name:'Confirmemos que sos vos.'}).isVisible();
  const route=new URL(page.url()).pathname;
  const path=['/onboarding','/login','/seguridad/mfa','/api/auth/callback'].includes(route)?route:'other';
  const cookies=await page.context().cookies(APP);
  const authCookie=cookies.some(cookie=>cookie.name.startsWith('sb-')&&/-auth-token(?:\.\d+)?$/.test(cookie.name));
  const pkceCookie=cookies.some(cookie=>cookie.name.startsWith('sb-')&&cookie.name.endsWith('-auth-token-code-verifier'));
  const selected=choice&&await page.getByRole('radio',{name:/Profesional independiente/}).isChecked();
  const continueEnabled=choice&&await page.getByRole('button',{name:'Seguir con esta opción'}).isEnabled();
  console.log(`auth_proof_ui_diagnostic:path=${path} choice=${choice?1:0} registration=${registration?1:0} consent=${consent?1:0} auth_cookie=${authCookie?1:0} pkce_cookie=${pkceCookie?1:0} selected=${selected?1:0} continue_enabled=${continueEnabled?1:0}`);
  if(callbackLocation)await callbackLocation;
  const before=await verifyBrowserAuthCookie(page,email);
  let reloadChoice=false,reloadRegistration=false,reloadConsent=false,reloadError=false;
  try{
   await page.reload();
   const choiceRadio=page.getByRole('radio',{name:tipo==='CLINICA'?/Clínica/:/Profesional independiente/});
   await expect(choiceRadio).toBeVisible({timeout:10_000});
   reloadChoice=true;
   await choiceRadio.check();
   if(tipo==='CLINICA')await page.getByRole('radio',{name:'No, administro la clínica'}).check();
   await page.getByRole('button',{name:'Seguir con esta opción'}).click();
   reloadConsent=await page.getByRole('heading',{name:'Confirmemos que sos vos.'}).isVisible();
   reloadRegistration=await page.getByRole('heading',{name:'Empezá creando tu cuenta.'}).isVisible();
  }catch{reloadError=true;}
  const after=await verifyBrowserAuthCookie(page,email);
  console.log(`auth_proof_session_diagnostic:verify=${visited.verify?1:0} callback=${visited.callback?1:0} onboarding=${visited.onboarding?1:0} callback_status=${callback.status} callback_to=${callback.to} cookie_kind=${before.kind} auth_valid=${before.valid?1:0} same_user=${before.same?1:0} reload_choice=${reloadChoice?1:0} reload_registration=${reloadRegistration?1:0} reload_consent=${reloadConsent?1:0} reload_error=${reloadError?1:0} reload_cookie_kind=${after.kind} reload_auth_valid=${after.valid?1:0} reload_same_user=${after.same?1:0}`);
  throw Error('auth_proof_consent_screen_missing');
 }
 await page.locator('input[type="checkbox"]').first().check();
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'¿Cómo te llamás?'})).toBeVisible({timeout:30_000});
 console.log(`auth_proof_stage:${tipo.toLowerCase()}_confirmed_and_bootstrapped`);
 await page.getByLabel(/^nombre$/i).fill(tipo==='CLINICA'?'Ana':'Lorenzo');
 await page.getByLabel(/^apellido$/i).fill('Sintético');
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await expect(page.getByRole('heading',{name:tipo==='CLINICA'?'¿Dónde está tu clínica?':'¿Dónde está tu consultorio?'})).toBeVisible();
 await page.getByLabel(tipo==='CLINICA'?'Nombre de la clínica':'Nombre del consultorio').fill(practice);
 await page.getByLabel(/^ciudad$/i).fill('Alta Gracia');
 await page.getByRole('radiogroup',{name:'Especialidad del consultorio'}).getByRole('radio',{name:/cardiolog/i}).click();
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Tu página en Folio'})).toBeVisible();
 await persistedOrganization(email,tipo,practice);
 console.log(`auth_proof_stage:${tipo.toLowerCase()}_db_saved`);
 await logout(page);
 await context.close();

 const resumed=await browser.newContext();
 const again=await resumed.newPage();
 await consentCookie(again);
 await login(again,email,OLD_PASSWORD);
 await again.waitForURL(/\/onboarding(?:\?|$)/,{timeout:30_000});
 await expect(again.getByRole('heading',{name:tipo==='CLINICA'?'¿Dónde está tu clínica?':'¿Dónde está tu consultorio?'})).toBeVisible();
 await expect(again.getByLabel(tipo==='CLINICA'?'Nombre de la clínica':'Nombre del consultorio')).toHaveValue(practice);
 await expect(again.getByLabel(/^ciudad$/i)).toHaveValue('Alta Gracia');
 await again.getByRole('button',{name:'Atrás'}).click();
 await expect(again.getByRole('heading',{name:'¿Cómo te llamás?'})).toBeVisible();
 await expect(again.getByLabel(/^apellido$/i)).toHaveValue('Sintético');
 console.log(`auth_proof_stage:${tipo.toLowerCase()}_fresh_context_resumed`);
 await resumed.close();
 return {email,lastMailId:confirmation.id};
}

test('B01/B02 · email real local, dos modalidades, reanudación y recuperación',async({browser})=>{
 requireLocalRuntime();
 test.setTimeout(480_000);
 const solo=await oneMode(browser,'INDEPENDIENTE');
 await oneMode(browser,'CLINICA');

 const context=await browser.newContext();
 const page=await context.newPage();
 await consentCookie(page);
 await page.goto('/forgot');
 await expect(page.getByRole('heading',{name:'Recuperá tu acceso.'})).toBeVisible();
 await page.getByRole('textbox',{name:'Email de tu cuenta'}).fill(solo.email);
 await page.getByRole('button',{name:'Enviar enlace de recuperación'}).click();
 await expect(page.getByRole('heading',{name:'Revisá tu email.'})).toBeVisible();
 const reset=await mailAction(solo.email,'recovery',solo.lastMailId);
 console.log('auth_proof_stage:recovery_mail_captured');
 await openAction(page,reset.url);
 await page.waitForURL(/\/reset-password(?:\?|$)/,{timeout:30_000});
 await page.locator('input[type="password"]').first().fill(NEW_PASSWORD);
 await page.locator('input[type="password"]').nth(1).fill(NEW_PASSWORD);
 await page.getByRole('button',{name:/guardar|cambiar|restablecer/i}).click();
 await expect(page.getByText(/contraseña.*(actualizada|cambiada|guardada)/i)).toBeVisible();
 console.log('auth_proof_stage:password_updated');
 await logout(page);
 await context.close();

 const finalContext=await browser.newContext();
 const finalPage=await finalContext.newPage();
 await consentCookie(finalPage);
 await login(finalPage,solo.email,OLD_PASSWORD);
 await expect(finalPage.getByText(/email o contraseña incorrectos/i)).toBeVisible();
 await finalPage.locator('input[type="password"]').fill(NEW_PASSWORD);
 await finalPage.getByRole('button',{name:'Ingresar a Folio'}).click();
 await finalPage.waitForURL(/\/onboarding(?:\?|$)/,{timeout:30_000});
 await expect(finalPage.getByRole('heading',{name:'¿Dónde está tu consultorio?'})).toBeVisible();
 console.log('auth_proof_stage:old_password_rejected_new_login_resumed');
 await finalContext.close();
});
