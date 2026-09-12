/** Portal/invitation checks with real components, synthetic actions, and loopback only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeEnvironment } from './testing/isolation-policy.mjs';
import { installIsolation } from './testing/install-isolation.mjs';

installIsolation();
const clean=safeEnvironment(process.env);
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,clean);
const {build}=await import('esbuild');
const {chromium}=await import('@playwright/test');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'folio-portal-qa-'));
const evidence=path.join(root,'docs/design/evidence');
const entry=`
import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';
import{PortalNav}from'@/app/(portal)/portal/(tabs)/portal-nav';
import{TurnosList}from'@/app/(portal)/portal/(tabs)/turnos/turnos-list';
import{PerfilList}from'@/app/(portal)/portal/(tabs)/perfil/perfil-list';
import{ResumenView}from'@/app/(portal)/portal/(tabs)/resumen/resumen-view';
import{InvitationAuth,InvitationDecision}from'@/app/(public)/invitacion/[token]/invitation-client';
import{InvitationPreviewSurface}from'@/app/dev/invitation-preview/preview';
import{DirectorioPage}from'@/components/directorio/directorio-page';
const params=new URLSearchParams(location.search),fixture=params.get('fixture'),state=params.get('state');
window.qa={calls:[],refreshes:0};
const appointment={id:'synthetic-appointment',organizationId:'synthetic-org',organizacionNombre:'Consultorio de ejemplo',organizacionSlug:'synthetic-clinic',inicio:'2026-09-17T13:30:00Z',duracionMin:45,estado:'CONFIRMADO',modalidad:'presencial',servicioId:'synthetic-service',profesionalId:null,cutoffHoras:24,cancelable:false};
const profile={identidadId:'synthetic-identity',pacienteId:'synthetic-patient',organizationId:'synthetic-org',organizacionNombre:'Consultorio de ejemplo',nombre:'Paciente',apellido:'de ejemplo',documento:null,email:'synthetic@example.invalid',telefono:'3510000000',domicilioCalle:null,domicilioNumero:null,domicilioCiudad:'Córdoba',domicilioProvincia:'Córdoba',domicilioCp:null};
const preview=state==='missing'?null:{organization_id:'synthetic-org',organization_name:'Clínica de ejemplo',email:'synthetic@example.invalid',role:'ASISTENTE',es_colegiado:false,estado:state==='revoked'?'REVOCADA':state==='accepted'?'ACEPTADA':'PENDIENTE',expired:state==='expired'};
const publicOrg={slug:'synthetic-clinic',nombre:'Consultorio de ejemplo',especialidad:'kinesiologia',ciudad:'Córdoba',provincia:'Córdoba',logoUrl:null,acentoHex:'#3F6B49',bio:'Consultorio ficticio para verificar la presentación.'};
const auth=fixture==='invitation'||fixture==='decision'||fixture==='preview';
createRoot(document.getElementById('root')).render(<StrictMode>{fixture==='directory'?<DirectorioPage orgs={state==='empty'?[]:[publicOrg]} title='Encontrá tu próximo consultorio' activeEspecialidad={state==='empty'?'nutricion':null}/>:auth?<main style={{minHeight:'100svh',display:'grid',placeItems:'center',padding:'32px 24px',background:'var(--bg)'}}>{fixture==='invitation'?<InvitationAuth token='synthetic-token-local-only'/>:fixture==='preview'?<InvitationPreviewSurface state='pending'/>:<InvitationDecision token='synthetic-token-local-only' preview={preview} sessionEmail={state==='mismatch'?'other@example.invalid':'synthetic@example.invalid'}/>}</main>:<div className='pt-app'><header className='pt-shell-header'><div className='pt-shell-header-inner'>Folio · Portal del paciente · Muestra local</div><PortalNav/></header><main className='pt-main'><h1 className='pt-page-title'>{fixture==='profile'?'Tus datos de contacto':fixture==='summary'?'Tu resumen':'Tus turnos'}</h1>{fixture==='profile'?<PerfilList perfiles={state==='empty'?[]:[profile]}/>:fixture==='summary'?<ResumenView resumen={{turnosPasados:[],consentimientos:[]}}/>:<TurnosList turnos={state==='empty'?[]:[appointment]}/>}</main></div>}</StrictMode>);
`;
const stubs={
 'next/navigation':`export const useRouter=()=>({refresh(){qa.refreshes++},push(){}});export const usePathname=()=>new URLSearchParams(location.search).get('path')||'/portal/turnos';`,
 'next/link':`export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
 'next/script':`export default function Script(){return null}`,
 'next/image':`export default function Image({src,alt,width,height,className}){return <img src={typeof src==='string'?src:src.src} alt={alt} width={width} height={height} className={className}/>} `,
 '@/app/(public)/book/[slug]/actions':`export async function fetchSlotsPublico(){return {ok:true,data:[]}}`,
 '@/app/(public)/login/actions':`export function signInWithPassword(email,password){return new Promise(resolve=>{qa.calls.push({action:'login',email,password});qa.resolve=resolve})}`,
 '@/lib/supabase/client':`export function createSupabaseBrowserClient(){throw Error('Unexpected auth client')}`,
 './actions':`export function solicitarReagendaAction(data){return new Promise(resolve=>{qa.calls.push({action:'reagenda',...data});qa.resolve=resolve})}export function actualizarContactoAction(data){return new Promise(resolve=>{qa.calls.push({action:'profile',...data});qa.resolve=resolve})}export async function cancelarTurnoAction(){throw Error('Unexpected cancellation')}export async function signUpForInvitationAction(){qa.calls.push({action:'signup'});return {ok:false,error:'Error de muestra'}}export async function acceptInvitationAction(){qa.calls.push({action:'accept'});return {ok:false,error:{message:'Error de muestra'}}}`,
};
for(const mode of ['development','production'])await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(dir,mode+'.js'),platform:'browser',jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':JSON.stringify(mode),'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY':'""'},plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:root}));}}]});
const styles=['public/folio.css','styles/experience.css','styles/platform.css','styles/auth-experience.css','styles/public-experience.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(['/development.js','/production.js'].includes(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(dir,path.basename(url.pathname))));}
 else if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(`@font-face{font-family:FolioQA;src:url('/font.woff2');font-weight:200 800}:root{--font-folio:FolioQA}`+styles);}
 else if(url.pathname==='/font.woff2')res.end(fs.readFileSync(path.join(root,'public/fonts/plus-jakarta-sans-latin.woff2')));
 else{const mode=url.pathname.includes('production')?'production':'development';res.setHeader('Content-Type','text/html');res.end(`<html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='/fixture.css'></head><body><div id='root'></div><script src='/${mode}.js'></script></body></html>`);}
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.on('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
const results=[];
try{for(const mode of ['development','production']){
 const run=async(name,fixture,scenario)=>{const page=await context.newPage();page.setDefaultTimeout(4500);const errors=[];page.on('pageerror',e=>errors.push(e.message));try{await page.goto(`${origin}/${mode}?fixture=${fixture}`);await page.evaluate(()=>document.fonts.ready);await scenario(page);assert.deepEqual(errors,[]);results.push({mode,case:name,pass:true});}catch(error){results.push({mode,case:name,pass:false,error:error.message,pageErrors:errors});}finally{console.log(JSON.stringify(results.at(-1)));await page.close();}};
 await run('active portal tab is fully visible on mobile using the production pathname default','profile&path=/portal/perfil&state=empty',async page=>{
  const active=page.getByRole('link',{name:'Mis datos',exact:true});await active.waitFor();assert.equal(await active.getAttribute('aria-current'),'page');
  await page.waitForFunction(()=>document.querySelector('[aria-current="page"]').getBoundingClientRect().right<=innerWidth);
  assert.equal(await page.getByRole('link',{name:'Ir al inicio del portal'}).getAttribute('href'),'/portal');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-portal-profile-empty-mobile.png')});
 });
 await run('reagenda disclosure, manual focus, failure preserves input, retry restores trigger focus','turnos',async page=>{
  const trigger=page.locator('button[aria-expanded]');await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  const form=page.getByRole('form',{name:/Solicitar otro horario/});await form.waitFor();assert.equal(await trigger.getAttribute('aria-controls'),await form.getAttribute('id'));
  assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Proponer otro horario',exact:true}).click();
  const date=page.getByLabel('Nuevo horario preferido');assert.equal(await date.evaluate(el=>el===document.activeElement),true);await date.fill('2026-09-20T10:00');
  await page.getByLabel('Motivo (opcional)').fill('Motivo sintético');await page.getByRole('button',{name:'Enviar solicitud',exact:true}).click();await page.getByRole('button',{name:'Enviando…'}).waitFor();assert.equal(await form.getAttribute('aria-busy'),'true');
  await page.evaluate(()=>qa.resolve({ok:false,error:{message:'No se pudo enviar la muestra. Reintentá.'}}));await page.getByText('No se pudo enviar la muestra. Reintentá.').waitFor();assert.equal(await date.inputValue(),'2026-09-20T10:00');assert.equal(await page.getByLabel('Motivo (opcional)').inputValue(),'Motivo sintético');
  if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-portal-reagenda-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Enviar solicitud',exact:true}).click();await page.evaluate(()=>qa.resolve({ok:true}));await form.waitFor({state:'hidden'});
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);const calls=await page.evaluate(()=>qa.calls);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].nuevoInicio,'2026-09-20T10:00:00-03:00');
 });
 await run('profile pending and failed save retain the editable contact values','profile&path=/portal/perfil',async page=>{
  await page.getByLabel('Teléfono',{exact:true}).fill('3510000011');await page.getByLabel('Calle',{exact:true}).fill('Calle sintética');await page.getByRole('button',{name:'Guardar cambios'}).click();const form=page.getByRole('form',{name:'Datos de contacto en Consultorio de ejemplo'});assert.equal(await form.getAttribute('aria-busy'),'true');
  await page.evaluate(()=>qa.resolve({ok:false,error:{message:'No se pudo guardar la muestra.'}}));await page.getByText('No se pudo guardar la muestra.').waitFor();assert.equal(await page.getByLabel('Calle',{exact:true}).inputValue(),'Calle sintética');assert.equal(await page.getByLabel('Teléfono',{exact:true}).inputValue(),'3510000011');
  assert.equal(await page.getByLabel('Teléfono',{exact:true}).evaluate(el=>getComputedStyle(el).fontSize),'16px');await page.getByLabel('Teléfono',{exact:true}).focus();assert.ok(await page.getByLabel('Teléfono',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth)>=3));
  if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-portal-profile-mobile.png'),fullPage:true});
 });
 await run('invitation signup still requires eight characters; login retains legacy input on retry','invitation',async page=>{
  assert.equal(await page.getByRole('heading',{level:1}).count(),1);const email=page.getByRole('textbox',{name:'Email (el que recibió la invitación)'}),password=page.getByLabel('Contraseña',{exact:true});await email.fill('synthetic@example.invalid');await password.fill('abcd');assert.equal(await password.getAttribute('autocomplete'),'new-password');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Crear cuenta y ver la invitación'}).click();assert.match(await page.getByRole('alert').innerText(),/mínimo 8/);assert.deepEqual(await page.evaluate(()=>qa.calls),[]);assert.equal(await password.evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Ya tengo cuenta',exact:true}).click();assert.equal(await password.getAttribute('autocomplete'),'current-password');assert.equal(await email.inputValue(),'synthetic@example.invalid');assert.equal(await password.inputValue(),'abcd');await page.getByRole('button',{name:'Entrar y ver la invitación'}).click();await page.getByRole('button',{name:'Entrando…'}).waitFor();await page.evaluate(()=>qa.resolve({ok:false,error:'Credenciales de muestra no válidas.'}));await page.getByRole('alert').waitFor();assert.equal(await password.inputValue(),'abcd');assert.equal(await email.inputValue(),'synthetic@example.invalid');await page.getByRole('button',{name:'Entrar y ver la invitación'}).click();await page.evaluate(()=>qa.resolve({ok:false,error:'Credenciales de muestra no válidas.'}));assert.equal((await page.evaluate(()=>qa.calls)).length,2);
  if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-portal-invitation-login-mobile.png'),fullPage:true});
 });
 await run('terminal invitation states stay read-only and pending acceptance still requires consent','decision&state=expired',async page=>{
  for(const state of ['expired','revoked','accepted','mismatch','missing','pending']){await page.goto(`${origin}/${mode}?fixture=decision&state=${state}`);await page.getByRole('heading',{level:1}).waitFor();assert.equal(await page.getByRole('heading',{level:1}).count(),1);if(state==='pending')assert.equal(await page.getByRole('button',{name:'Aceptar invitación',exact:true}).isDisabled(),true);else assert.equal(await page.getByRole('button',{name:'Aceptar invitación',exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>qa.calls),[]);}
  if(mode==='production'){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(evidence,'polish-portal-invitation-desktop.png')});}
 });
 await run('invitation preview blocks acceptance and account-switch actions','preview',async page=>{
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Aceptar invitación',exact:true}).click();await page.getByRole('status').waitFor();assert.deepEqual(await page.evaluate(()=>qa.calls),[]);await page.getByRole('button',{name:'No soy yo — cambiar de cuenta',exact:true}).click();assert.deepEqual(await page.evaluate(()=>qa.calls),[]);
 });
 await run('directory cards and empty state retain booking/filter links and visible focus','directory',async page=>{
  const card=page.locator('.dir-card');await card.waitFor();assert.equal(await card.getAttribute('href'),'/book/synthetic-clinic?ref=directorio');await card.focus();assert.ok(await card.evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth)>=3));
  if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-portal-directory-mobile.png'),fullPage:true});await page.goto(`${origin}/${mode}?fixture=directory&state=empty`);assert.equal(await page.getByRole('link',{name:'Ver todas las especialidades'}).getAttribute('href'),'/profesionales');assert.equal(await page.getByRole('link',{name:'Nutrición',exact:true}).getAttribute('aria-current'),'page');
 });
 await run('empty summary provides a next step without promising clinical content','summary&path=/portal/resumen',async page=>{assert.equal(await page.getByRole('link',{name:'Ver mis turnos'}).getAttribute('href'),'/portal/turnos');if(mode==='production')await page.screenshot({path:path.join(evidence,'polish-portal-summary-empty-mobile.png')});});
}}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};fs.writeFileSync(path.join(evidence,'polish-portal-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
