import assert from 'node:assert/strict';
import {testAppConfig} from '../app-config.mjs';
import {guardBrowserContext,LOCAL_BROWSER_ARGS} from '../browser-network.mjs';
import {installGoogleTransport,startGoogleHttp} from '../google-c05-proof/transport.mjs';

export const JOINED_PROJECT='folio_public_booking_joined_proof';
export const JOINED_TIMEZONE='America/Argentina/Cordoba';
const NAME='Ensayo joined.invalid',EMAIL='ensayo@booking.invalid';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function localParts(value){
 return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:JOINED_TIMEZONE,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  .formatToParts(value).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}
/** Input must come from the ephemeral database clock, not the runner's date. */
export function todayPlan(clock){
 const now=new Date(clock);assert.ok(Number.isFinite(now.getTime()),'joined_clock_invalid');
 const p=localParts(now),day=`${p.year}-${p.month}-${p.day}`;
 const minute=Math.ceil((Number(p.hour)*60+Number(p.minute)+120)/30)*30;
 assert.ok(minute+30<=23*60+30,'joined_no_future_slot_today');
 const localEpoch=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
 const offset=localEpoch-Math.floor(now.getTime()/1000)*1000;
 const start=new Date(Date.UTC(+p.year,+p.month-1,+p.day,0,minute)-offset);
 const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
 assert.ok(start.getTime()-now.getTime()>=119*60000,'joined_slot_not_future');
 return {day,start:start.toISOString(),end:new Date(start.getTime()+30*60000).toISOString(),
  hora:time(minute),horaFin:time(minute+30),weekday:new Date(`${day}T12:00:00Z`).getUTCDay()};
}

/** Fail before fixture writes. The adapter retains the pre-sanitization hosted facts. */
export function assertJoinedInputs({isolation,config,scope,browserCookies}){
 assert.equal(isolation.project,JOINED_PROJECT);assert.equal(isolation.githubActions,'true');
 assert.equal(isolation.runnerEnvironment,'github-hosted');assert.equal(isolation.platform,'linux');
 assert.equal(isolation.fresh,true);assert.equal(isolation.internalNetwork,true);
 assert.equal(globalThis[Symbol.for('folio.test.isolation')],true,'joined_io_guard_missing');
 const checked=testAppConfig({E2E_BASE_URL:config.appUrl,FOLIO_TEST_SUPABASE_URL:config.supabaseUrl,
  FOLIO_TEST_SUPABASE_ANON_KEY:config.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:config.serviceKey,
  FOLIO_TEST_DATABASE_URL:config.databaseUrl,FOLIO_TEST_CLINICAL:'1'});
 assert.equal(config.mode,'app');assert.equal(config.realSupabase,true);assert.equal(config.clinical,true);
 assert.equal(config.appUrl,checked.appUrl);assert.ok(config.databaseUrl);
 assert.ok(!config.turnstileSitekey,'joined_public_captcha_key_unexpected');
 for(const id of ['org','member','patient','servicio','integration'])assert.match(scope[id],UUID);
 assert.ok(Array.isArray(browserCookies)&&browserCookies.length>0,'joined_session_cookie_missing');
 for(const cookie of browserCookies){
  assert.ok(cookie.name.startsWith('sb-'));assert.ok(cookie.value);
  assert.equal(cookie.domain,new URL(config.appUrl).hostname);assert.equal(cookie.path,'/');
 }
 for(const key of ['TURNSTILE_SECRET_KEY','NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REDIRECT_URI']){
  assert.ok(!process.env[key]&&!config[key],`joined_unexpected_${key}`);
 }
}

/** Reusable module: no backend launcher, worker cron, workflow or CLI here.
 * withNext(config, callback) owns a real isolated Next dev process and its cleanup.
 * The parent receipt owns overall passed/cleanup; modulePassed is only this flow.
 */
export async function provePublicBookingJoined({actor,service,scope,isolation,config,browserCookies,
 withDatabase,withNext,receipt,persist}){
 assertJoinedInputs({isolation,config,scope,browserCookies});
 assert.equal(receipt.modulePassed,false);assert.equal(receipt.failure,null);
 assert.deepEqual(receipt.stages,{});assert.equal(typeof persist,'function');
 assert.equal(typeof withDatabase,'function');assert.equal(typeof withNext,'function');
 const {org,member,patient,servicio,integration}=scope;
 assert.equal(process.platform,'linux','joined_hosted_linux_required');
 let stage='fixture',browser,http,restore,failed=false;
 const read=async query=>{const r=await query;assert.equal(r.error,null);assert.notEqual(r.data,null);return r.data;};
 const rows=table=>service.from(table).select('*').eq('organization_id',org);
 const privateRows=table=>withDatabase(async db=>(await db.query(
  `SELECT * FROM folio_booking_private.${table} WHERE organization_id=$1`,[org])).rows);
 const record=async(name,data)=>{receipt.stages[name]={passed:true,...data};await persist();};
 try{
  const mfa=await read(actor.rpc('mfa_access_status'));
  assert.equal(mfa.required,true);assert.equal(mfa.isStaff,true);assert.equal(mfa.hasVerifiedFactor,true);
  assert.equal(mfa.sessionValid,true);assert.equal(mfa.allowed,true);
  const organizations=await read(service.from('organization').select('id,slug,timezone,is_synthetic,is_internal_account'));
  assert.equal(organizations.length,1);const organization=organizations[0];
  assert.equal(organization.id,org);assert.equal(organization.timezone,JOINED_TIMEZONE);
  assert.equal(organization.is_synthetic,false);assert.equal(organization.is_internal_account,true);
  assert.match(organization.slug,/^folio-test-[a-z0-9-]+$/);
  assert.equal((await read(rows('turno'))).length,0);assert.equal((await read(rows('pedido'))).length,0);
  assert.equal((await read(rows('google_outbound_job'))).length,0);
  assert.equal((await privateRows('submission')).length,0);assert.equal((await privateRows('conversion')).length,0);
  const services=await read(rows('servicio'));assert.equal(services.length,1);
  assert.equal(services[0].id,servicio);assert.equal(services[0].duracion_min,30);
  const members=await read(rows('member'));assert.equal(members.length,1);assert.equal(members[0].id,member);
  const integrations=await read(rows('integration'));assert.equal(integrations.length,1);assert.equal(integrations[0].id,integration);
  assert.equal(integrations[0].profesional_id,member);assert.equal(integrations[0].proveedor,'GOOGLE_CALENDAR');
  assert.equal(integrations[0].meta_json.calendar_id,'c05-internal');
  assert.ok(integrations[0].refresh_token_cifrado);
  const clock=await withDatabase(async db=>(await db.query('SELECT clock_timestamp() AS clock')).rows[0].clock);
  const plan=todayPlan(clock);
  // Only fixture data changes, in the already guarded fresh backend.
  await read(service.from('organization').update({opt_out_public_listing:false,auto_confirmar_reservas:false,slot_margen_min:0})
   .eq('id',org).select('id').single());
  assert.equal((await read(rows('disponibilidad_profesional'))).length,0);
  await read(service.from('disponibilidad_profesional').insert({organization_id:org,member_id:member,
   dia_semana:plan.weekday,hora_inicio:plan.hora,hora_fin:plan.horaFin,activa:true,vigencia_desde:plan.day,vigencia_hasta:plan.day}).select('id').single());
  receipt.limits={nextMode:'development',captcha:'absent-secret-development-policy',
   google:'existing-http-loopback',professionalUi:'single-owner-implicit',mailWorkersExecuted:0};
  await record('fixture',{day:plan.day,start:plan.start,timezone:JOINED_TIMEZONE});
  await withNext(config,async runtime=>{
   assert.equal(runtime.kind,'next-dev');assert.equal(runtime.appUrl,config.appUrl);
   assert.equal(runtime.externalIoDenied,true);assert.equal(runtime.turnstileSecretPresent,false);
   const {chromium}=await import('@playwright/test');
   browser=await chromium.launch({headless:true,args:LOCAL_BROWSER_ARGS});
   const publicContext=await browser.newContext({baseURL:config.appUrl,timezoneId:JOINED_TIMEZONE});
   await guardBrowserContext(publicContext);const publicPage=await publicContext.newPage();
   stage='public-request';await publicPage.goto(`/book/${organization.slug}`);
   const consent=publicPage.getByRole('button',{name:'Solo esenciales',exact:true});
   if(await consent.isVisible())await consent.click();
   await publicPage.getByRole('link',{name:`Elegir ${services[0].nombre}`,exact:true}).click();
   await publicPage.locator('.bk-slot').filter({hasText:new RegExp(`^${plan.hora}$`)}).first().click();
   await publicPage.getByLabel('Nombre y apellido',{exact:true}).fill(NAME);
   await publicPage.getByLabel('Teléfono (WhatsApp)',{exact:true}).fill('3510000000');
   await publicPage.getByLabel(/^Email\s/).fill(EMAIL);
   await publicPage.getByRole('checkbox').check();
   const current=await withDatabase(async db=>(await db.query('SELECT clock_timestamp() AS clock')).rows[0].clock);
   const p=localParts(new Date(current));assert.equal(`${p.year}-${p.month}-${p.day}`,plan.day,'joined_day_changed');
   assert.ok(Date.parse(plan.start)>new Date(current).getTime(),'joined_slot_elapsed');
   // Exactly one UI submission; uncertain responses fail without a retry.
   await publicPage.getByRole('button',{name:'Solicitar turno',exact:true}).click();
   await publicPage.getByRole('heading',{name:'¡Solicitud enviada!',exact:true}).waitFor();
   const pedidos=await read(rows('pedido'));assert.equal(pedidos.length,1);const pedido=pedidos[0];
   assert.equal(pedido.canal,'WEB');assert.equal(pedido.estado,'PENDIENTE');
   assert.equal(pedido.servicio_id,servicio);assert.equal(pedido.profesional_id,member);
   assert.equal(new Date(pedido.fecha_propuesta).toISOString(),plan.start);
   const submissions=await privateRows('submission');assert.equal(submissions.length,1);
   assert.equal(submissions[0].pedido_id,pedido.id);assert.equal(submissions[0].result.autoConfirmado,false);
   assert.equal((await read(rows('turno'))).length,0);assert.equal((await read(rows('google_outbound_job'))).length,0);
   await record('publicRequest',{pedidoId:pedido.id,operationId:submissions[0].operation_id,requestCount:1,autoConfirmed:false});
   stage='manual-confirmation';
   const staffContext=await browser.newContext({baseURL:config.appUrl,timezoneId:JOINED_TIMEZONE});
   await guardBrowserContext(staffContext);await staffContext.addCookies(browserCookies);
   const staff=await staffContext.newPage();await staff.goto('/calendario');
   const card=staff.locator(`.cal-pedido[title*="${NAME}"]`);
   await card.waitFor();assert.equal(await card.count(),1);await card.click();
   await staff.getByRole('dialog').getByRole('button',{name:'Aceptar y crear turno',exact:true}).click();
   await staff.getByRole('dialog').waitFor({state:'hidden'});
   const conversions=await privateRows('conversion');assert.equal(conversions.length,1);const conversion=conversions[0];
   assert.equal(conversion.pedido_id,pedido.id);assert.notEqual(conversion.paciente_id,patient);
   const turns=await read(rows('turno'));assert.equal(turns.length,1);const turn=turns[0];
   assert.equal(turn.id,conversion.turno_id);assert.equal(turn.paciente_id,conversion.paciente_id);
   assert.equal(turn.profesional_id,member);assert.equal(turn.servicio_id,servicio);assert.equal(turn.estado,'CONFIRMADO');
   assert.equal(new Date(turn.inicio).toISOString(),plan.start);assert.equal(turn.duracion_min,30);
   const confirmed=await read(rows('pedido'));assert.equal(confirmed.length,1);
   assert.equal(confirmed[0].estado,'CONFIRMADO');assert.equal(confirmed[0].paciente_id,turn.paciente_id);
   const patients=await read(rows('paciente'));assert.equal(patients.length,2);
   assert.ok(patients.some(row=>row.id===turn.paciente_id));
   await record('manualConfirmation',{turnoId:turn.id,pacienteId:turn.paciente_id,serviceId:servicio,professionalId:member});
   stage='calendar-hoy';await staff.reload();
   const turnCard=staff.locator('.cal-turno').filter({hasText:NAME.split(' ')[0]});
   await turnCard.waitFor();assert.equal(await turnCard.count(),1);
   const label=await turnCard.getAttribute('aria-label');assert.ok(label.includes(NAME));
   assert.ok(label.includes(plan.hora));assert.ok(label.includes(services[0].nombre));
   await turnCard.click();await staff.getByRole('dialog').locator(`a[href="/pacientes/${turn.paciente_id}"]`).waitFor();
   await staff.goto('/hoy');const today=staff.locator('.fi-turno').filter({hasText:NAME});
   await today.waitFor();assert.equal(await today.count(),1);
   assert.ok((await today.getAttribute('aria-label')).includes(plan.hora));
   assert.ok((await today.innerText()).includes(services[0].nombre));
   await record('calendarHoy',{calendarVisible:true,calendarPatientLink:true,hoyVisible:true,day:plan.day});
   stage='google-intent';const jobs=await read(rows('google_outbound_job'));assert.equal(jobs.length,1);
   const job=jobs[0];assert.equal(job.turno_id,turn.id);assert.equal(job.integration_id,integration);
   assert.equal(job.calendar_id,'c05-internal');assert.equal(job.status,'pending');
   http=await startGoogleHttp();
   Object.assign(process.env,{GOOGLE_OAUTH_CLIENT_ID:'c05-client.invalid',GOOGLE_OAUTH_CLIENT_SECRET:'c05-test-secret',GOOGLE_OAUTH_REDIRECT_URI:`${http.origin}/unused`});
   const {google}=await import('googleapis');restore=installGoogleTransport(google,http.origin);
   const loaded=await import('../../../lib/google/outbound.ts');
   const stats=await (loaded.default??loaded).dispatchGoogleOutbound(1,turn.id);
   assert.deepEqual(stats,{processed:1,complete:1,retryable:0,terminal:0});
   const completed=await read(rows('google_outbound_job'));assert.equal(completed.length,1);assert.equal(completed[0].status,'complete');
   const finalTurns=await read(rows('turno'));assert.equal(finalTurns.length,1);assert.equal(finalTurns[0].gcal_event_id,job.event_id);
   assert.equal(http.events.size,1);assert.equal(http.calls.insert,1);assert.equal(http.calls.patch,0);assert.equal(http.calls.list,0);
   const event=http.events.get(job.event_id);assert.equal(event.start.dateTime,plan.start);assert.equal(event.end.dateTime,plan.end);
   assert.equal(event.summary,'Turno reservado');assert.equal(event.description,'Reserva gestionada por Folio.');
   assert.equal(event.attendees,undefined);assert.equal(event.location,undefined);
   await record('googleIntent',{integrationId:integration,eventId:job.event_id,intents:1,events:1,http:{...http.calls}});
  });
  receipt.modulePassed=true;
 }catch(error){failed=true;receipt.failure=stage;throw error;}
 finally{
  const cleanup=await Promise.allSettled([Promise.resolve().then(()=>restore?.()),
   Promise.resolve().then(()=>http?.close()),Promise.resolve().then(()=>browser?.close())]);
  for(const key of ['GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REDIRECT_URI'])delete process.env[key];
  if(cleanup.some(result=>result.status==='rejected')){
   receipt.modulePassed=false;receipt.moduleCleanup=false;
   if(!failed)receipt.failure='module-cleanup';
  }else receipt.moduleCleanup=true;
  await persist();
  if(!failed&&!receipt.moduleCleanup)throw Error('joined_module_cleanup_failed');
 }
}
