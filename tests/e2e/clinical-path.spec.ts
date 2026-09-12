import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Browser,Page,Download} from '@playwright/test';
import {test as base,expect} from '../fixtures/local-test';
import {createClinicalCaseFixture,assertPolicies,assertBrowserActor,loginClinical,firstFactorClient,requireSuccess,type ClinicalAccount,type ClinicalFixture} from '../fixtures/clinical-local';
import {prepareSavedVisit,closeClinically,registerFromAgenda,reopenVisit,assertFinalCounts,assertClosedVisit,assertDocumentDownload,clinicalInvariant,openReview,enterDecision,uiExpect,type VisitEvidence} from '../fixtures/clinical-journey';
import {observeClinicalAction,type ExpectedAction,type CommittedAction} from '../fixtures/clinical-response-loss';
import {assertAal1ProtectedRead} from '../../scripts/testing/clinical-config.mjs';

const test=base.extend<{caseOptions:NonNullable<Parameters<typeof createClinicalCaseFixture>[0]>;clinical:ClinicalFixture}>({
 caseOptions:[{},{option:true}],
 clinical:async({caseOptions},provide)=>{const fixture=await createClinicalCaseFixture(caseOptions);try{await provide(fixture);await assertPolicies(fixture.db);}finally{await fixture.close();}},
});
test.skip(process.env.FOLIO_TEST_CLINICAL!=='1','Requires the dedicated real local Supabase 17/Auth/TOTP/Storage fixture.');
test.describe.configure({mode:'default',timeout:180000});
test.use({timezoneId:'Pacific/Auckland'});
const cash={montoCents:3000000,metodo:'EFECTIVO',pagado:true} as const;
const debt={...cash,pagado:false} as const;
async function authenticated(fixture:ClinicalFixture,browser:Browser,account=fixture.owner,destination:'hoy'|'billing'='hoy'){
 const page=await fixture.newPage(browser);await loginClinical(fixture,page,account,destination);return page;
}
async function downloadBytes(download:Download):Promise<Buffer>{expect(await download.failure()).toBeNull();const stream=await download.createReadStream();expect(stream).not.toBeNull();const chunks:Buffer[]=[];for await(const part of stream!)chunks.push(Buffer.from(part));return Buffer.concat(chunks);}
async function currentPayment(fixture:ClinicalFixture,visit:VisitEvidence){const {rows}=await fixture.db.query('SELECT id,monto_cents,metodo,estado,pagado_ts,updated_at FROM public.pago WHERE turno_id=$1',[visit.turnoId]);expect(rows).toHaveLength(1);return rows[0];}
async function receipts(fixture:ClinicalFixture,visit:VisitEvidence){const r=await fixture.db.query('SELECT count(*)::int AS n FROM folio_close_private.receipt WHERE turno_id=$1',[visit.turnoId]);return r.rows[0].n;}
async function financeDenied(fixture:ClinicalFixture,page:Page,actor:ClinicalAccount){
 await assertBrowserActor(fixture,page,actor);await expect(page.getByRole('link',{name:'Finanzas',exact:true})).toHaveCount(0);
 const response=await page.goto('/finanzas');expect([200,404]).toContain(response?.status());expect(new URL(page.url()).pathname).toBe('/finanzas');
 await expect(page.getByRole('heading',{name:'Esta página no existe',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Finanzas',exact:true})).toHaveCount(0);await assertBrowserActor(fixture,page,actor);
}
async function recover(fixture:ClinicalFixture,page:Page,actor:ClinicalAccount,expected:ExpectedAction,button:string){
 const watch=await observeClinicalAction(fixture,page,actor,expected,true);
 try{await page.getByRole('button',{name:button,exact:true}).click();const committed=await watch.observed;
  await uiExpect(page.getByRole('button',{name:'Comprobar resultado',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();
  return committed;
 }finally{await watch.dispose();}
}
async function confirmReceipt(fixture:ClinicalFixture,page:Page,actor:ClinicalAccount,action:CommittedAction){
 assert.ok(action.request.action!=='SETTLE');const request=action.request;
 const {client}=await assertBrowserActor(fixture,page,actor);
 const response=await client.rpc('get_turno_close_receipt',{p_org:actor.organizationId,p_turno:request.turnoId,p_operation:request.operacionId,p_action:request.action,p_duracion:request.action==='CLOSE'?request.duracionRealMin??null:null,p_decision:request.cobro??null});
 requireSuccess(response.error,'authorized receipt check');expect(response.data).toEqual(action.receipt);
}

test('real AAL1 cannot read staff membership or enter the dual patient portal',async({clinical:f})=>{
 const client=firstFactorClient(f),actor=f.owner;const login=await client.auth.signInWithPassword({email:actor.email,password:actor.password});expect(login.error).toBeNull();
 const status=await client.rpc('mfa_access_status');expect(status.error).toBeNull();expect(status.data).toMatchObject({required:true,allowed:false,isStaff:true,hasVerifiedFactor:true,sessionValid:false});
 assertAal1ProtectedRead(await client.from('member').select('id').eq('organization_id',actor.organizationId));
 expect((await client.rpc('paciente_cuenta_actual')).error?.code).toBe('42501');
});
for(const specialty of ['quiropraxia','cardiologia','psicologia'] as const)test.describe(specialty,()=>{
 test.use({caseOptions:{specialty}});
 test('walk-in → save → attachment → clinical close without payment → explicit cash → fresh login → reopen',async({clinical:f,browser},testInfo)=>{
  let page=await authenticated(f,browser);const visit=await prepareSavedVisit(page,f);await closeClinically(page,f,visit);
  const receipt=await registerFromAgenda(page,f,visit,cash);expect(receipt).toMatchObject({origen:'CLINICAL',clasificacion:'REGISTRADO',pagoOrigen:'CREADO',pago:{montoCents:3000000,metodo:'EFECTIVO',estado:'PAGADO'}});
  await f.closeContext(page.context());page=await authenticated(f,browser);await reopenVisit(page,visit);await assertFinalCounts(f,visit);
  await testInfo.attach('clinical-evidence.json',{contentType:'application/json',body:JSON.stringify({synthetic:true,specialty,clinicalClose:'no payment until explicit RESOLVE',auth:'real password/TOTP UI',storage:'two authorized downloads, exact hash/bytes and direct access denied',counts:{patients:1,turnos:1,sessions:1,payments:1},browserTimezone:'Pacific/Auckland',organizationTimezone:'America/Argentina/Cordoba',providerPayments:0})});
 });
});

test.describe('cross-tenant',()=>{
 test.use({caseOptions:{foreignOwner:true}});
 test('real cross-tenant and AAL1 clinical reads are denied through REST and the file proxy',async({clinical:f,browser})=>{
  const ownerPage=await authenticated(f,browser);const target=await prepareSavedVisit(ownerPage,f);await assertDocumentDownload(ownerPage,target);assert.ok(target.document&&f.foreign);
  const page=await authenticated(f,browser,f.foreign);const {client}=await assertBrowserActor(f,page,f.foreign);
  for(const [table,id] of [['paciente',target.patientId],['sesion',target.sessionId]]){const result=await client.from(table).select('id').eq('id',id);expect(result.error).toBeNull();expect(result.data).toEqual([]);}
  const denied=await page.request.get(`/api/documentos/${target.document.id}/archivo`);expect([403,404]).toContain(denied.status());
  const aal1=firstFactorClient(f),login=await aal1.auth.signInWithPassword({email:f.owner.email,password:f.owner.password});expect(login.error).toBeNull();
  for(const [table,id] of [['paciente',target.patientId],['sesion',target.sessionId],['documento_clinico',target.document.id]])assertAal1ProtectedRead(await aal1.from(table).select('id').eq('id',id));
 });
});
test.describe('paused archive',()=>{
 test.use({caseOptions:{foreignOwner:true}});
 test('paused subscription redirects ordinary UI to billing but preserves the authorized clinical archive',async({clinical:f,browser},testInfo)=>{
  let page=await authenticated(f,browser);const target=await prepareSavedVisit(page,f);await closeClinically(page,f,target);await assertDocumentDownload(page,target);
  assert.ok(f.foreign);const foreignPage=await authenticated(f,browser,f.foreign);const other=await prepareSavedVisit(foreignPage,f,{actor:f.foreign,attachment:false});await closeClinically(foreignPage,f,other);
  const positiveForeign=await foreignPage.request.get(`/api/pacientes/${other.patientId}/ficha-pdf`);expect(positiveForeign.status()).toBe(200);expect((await positiveForeign.body()).subarray(0,5).toString()).toBe('%PDF-');
  await f.closeContext(foreignPage.context());await f.closeContext(page.context());
  await f.db.query('BEGIN');try{await f.db.query('UPDATE public.organization SET is_internal_account=false WHERE id=$1 AND is_synthetic=true',[f.owner.organizationId]);await f.db.query("INSERT INTO public.suscripcion(organization_id,payer_email,estado) VALUES($1,$2,'PAUSADA')",[f.owner.organizationId,f.owner.email]);await f.db.query('COMMIT');}catch(error){await f.db.query('ROLLBACK');throw error;}
  page=await authenticated(f,browser,f.owner,'billing');await page.goto('/hoy');await expect(page).toHaveURL(/\/configuracion\/billing(?:\?|$)/);await expect(page.getByRole('button',{name:'Sin turno',exact:true})).toHaveCount(0);
  await page.goto('/archivo-clinico');await uiExpect(page.getByRole('heading',{name:'Archivo clínico',exact:true})).toBeVisible();await uiExpect(page.getByRole('heading',{name:/^1 paciente disponible/})).toBeVisible();
  await uiExpect(page.getByRole('button',{name:/Descargar PDF de.*quiropraxia/})).toBeVisible();await expect(page.getByRole('button',{name:/Descargar PDF de.*cardiologia/})).toHaveCount(0);
  const pdfEvent=page.waitForEvent('download');await page.getByRole('button',{name:/Descargar PDF de.*quiropraxia/}).click();const pdf=await downloadBytes(await pdfEvent);expect(pdf.subarray(0,5).toString('ascii')).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(1000);
  const jsonEvent=page.waitForEvent('download');await page.getByRole('button',{name:/Descargar datos clínicos de.*quiropraxia/}).click();const data=JSON.parse((await downloadBytes(await jsonEvent)).toString('utf8'));expect(JSON.stringify(data)).toContain(target.marker);
  expect([403,404]).toContain((await page.request.get(`/api/pacientes/${other.patientId}/ficha-pdf`)).status());
  const state=await f.db.query('SELECT o.is_synthetic,o.is_internal_account,s.estado,(SELECT count(*)::int FROM public.cargo_suscripcion c WHERE c.suscripcion_id=s.id) AS provider_charges FROM public.organization o JOIN public.suscripcion s ON s.organization_id=o.id WHERE o.id=$1',[f.owner.organizationId]);expect(state.rows[0]).toEqual({is_synthetic:true,is_internal_account:false,estado:'PAUSADA',provider_charges:0});
  await testInfo.attach('paused-archive-evidence.json',{contentType:'application/json',body:JSON.stringify({synthetic:true,subscription:'PAUSADA',ordinaryUI:'billing redirect',archive:'real PDF and JSON',crossTenant:'denied against existing authorized target',serverMutationGate:'not exercised',providerCharges:0})});
 });
});
test('a signed AAL2 token stops passing the DB gate after real Auth session revocation',async({clinical:f})=>{
 const session=await f.owner.client.auth.getSession();assert.ok(session.data.session);const token=session.data.session.access_token;
 expect((await f.owner.client.auth.signOut({scope:'local'})).error).toBeNull();
 const response=await fetch(`${f.supabaseUrl}/rest/v1/rpc/mfa_access_status`,{method:'POST',headers:{apikey:f.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({required:true,allowed:false,sessionValid:false});
});

test('direct CLOSE lost after commit is confirmed by the same read-only receipt',async({clinical:f,browser},testInfo)=>{
 const page=await authenticated(f,browser),visit=await prepareSavedVisit(page,f,{attachment:false});
 await page.goto(`/hoy?prof=${f.owner.memberId}`);await page.locator('.fi-turno').filter({hasText:f.runId}).getByRole('button',{name:'Cerrar turno',exact:true}).click();await enterDecision(page,cash);await page.getByLabel('Duración real (min)',{exact:true}).fill('20');
 const first=await recover(f,page,f.owner,{action:'CLOSE',turnoId:visit.turnoId,cobro:cash,duracionRealMin:20},'Cobrar y cerrar');
 await assertClosedVisit(f,visit);const invariant=await clinicalInvariant(f,visit),payment=await currentPayment(f,visit),count=await receipts(f,visit);
 await expect(page.getByLabel('Monto en pesos',{exact:true})).toBeDisabled();await expect(page.getByLabel('Duración real (min)',{exact:true})).toHaveValue('20');
 await page.getByRole('button',{name:'Comprobar resultado',exact:true}).click();await uiExpect(page.getByRole('button',{name:'Listo',exact:true})).toBeVisible();await confirmReceipt(f,page,f.owner,first);
 expect(await clinicalInvariant(f,visit)).toBe(invariant);expect(await currentPayment(f,visit)).toEqual(payment);expect(await receipts(f,visit)).toBe(count);await assertFinalCounts(f,visit);
 await testInfo.attach('lost-close.json',{contentType:'application/json',body:JSON.stringify({action:'CLOSE',operationId:first.receipt?.operationId,commitBeforeAbort:true,recovery:'receipt probe',payments:1})});
});
test('RESOLVE lost after commit retries the same immutable decision without repeating close or payment',async({clinical:f,browser},testInfo)=>{
 const page=await authenticated(f,browser),visit=await prepareSavedVisit(page,f,{attachment:false});await closeClinically(page,f,visit);const invariant=await clinicalInvariant(f,visit);
 await openReview(page,f,visit);await enterDecision(page,debt);const expected={action:'RESOLVE',turnoId:visit.turnoId,cobro:debt} as const;
 const first=await recover(f,page,f.owner,expected,'Registrar decisión');const payment=await currentPayment(f,visit),count=await receipts(f,visit);
 await expect(page.getByLabel('Monto en pesos',{exact:true})).toBeDisabled();const retry=await observeClinicalAction(f,page,f.owner,expected);
 try{await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).click();const second=await retry.observed;expect(second.request).toEqual(first.request);expect(second.receipt).toEqual(first.receipt);await uiExpect(page.getByRole('button',{name:'Listo',exact:true})).toBeVisible();}finally{await retry.dispose();}
 await confirmReceipt(f,page,f.owner,first);expect(await clinicalInvariant(f,visit)).toBe(invariant);expect(await currentPayment(f,visit)).toEqual(payment);expect(await receipts(f,visit)).toBe(count);await assertFinalCounts(f,visit);
 await testInfo.attach('lost-resolve.json',{contentType:'application/json',body:JSON.stringify({action:'RESOLVE',operationId:first.receipt?.operationId,commitBeforeAbort:true,recovery:'same operation retry',payments:1})});
});
test('settlement lost after commit retries only the existing payment and preserves the historical receipt',async({clinical:f,browser},testInfo)=>{
 const page=await authenticated(f,browser),visit=await prepareSavedVisit(page,f,{attachment:false});await closeClinically(page,f,visit);const historical=await registerFromAgenda(page,f,visit,debt);assert.ok(historical.pago);
 const invariant=await clinicalInvariant(f,visit),count=await receipts(f,visit);await openReview(page,f,visit);
 const expected={action:'SETTLE',turnoId:visit.turnoId,pagoId:historical.pago.id} as const;const first=await recover(f,page,f.owner,expected,'Marcar cobrado');expect(first.settlement?.alreadyPaid).toBe(false);const payment=await currentPayment(f,visit);
 const retry=await observeClinicalAction(f,page,f.owner,expected);try{await page.getByRole('button',{name:'Reintentar misma solicitud',exact:true}).click();const result=await retry.observed;expect(result.request).toEqual(first.request);expect(result.settlement?.alreadyPaid).toBe(true);expect(result.settlement?.pago).toEqual(first.settlement?.pago);await uiExpect(page.getByRole('button',{name:'Listo',exact:true})).toBeVisible();}finally{await retry.dispose();}
 const {client}=await assertBrowserActor(f,page,f.owner);const probe=await client.rpc('get_turno_close_receipt',{p_org:f.owner.organizationId,p_turno:visit.turnoId,p_operation:historical.operationId,p_action:'RESOLVE',p_duracion:null,p_decision:debt});expect(probe.error).toBeNull();expect(probe.data).toEqual(historical);
 const status=await client.rpc('get_turno_close_status',{p_org:f.owner.organizationId,p_turno:visit.turnoId});expect(status.error).toBeNull();expect(status.data.pago.estado).toBe('PAGADO');await uiExpect(page.getByText(/Pago registrado:.*Cobrado/)).toBeVisible();
 expect(await clinicalInvariant(f,visit)).toBe(invariant);expect(await currentPayment(f,visit)).toEqual(payment);expect(await receipts(f,visit)).toBe(count);await assertFinalCounts(f,visit);
 await testInfo.attach('lost-settlement.json',{contentType:'application/json',body:JSON.stringify({action:'SETTLE',paymentId:historical.pago.id,commitBeforeAbort:true,recovery:'same payment retry',historicalReceipt:'unchanged PENDIENTE',currentPayment:'PAGADO'})});
});

test.describe('assistant',()=>{
 test.use({caseOptions:{receptionRole:'ASISTENTE'}});
 test('real ASISTENTE AAL2 registers and settles from agenda without finance or clinical access',async({clinical:f,browser},testInfo)=>{
  const ownerPage=await authenticated(f,browser),visit=await prepareSavedVisit(ownerPage,f,{attachment:true});await assertDocumentDownload(ownerPage,visit);await closeClinically(ownerPage,f,visit);await f.closeContext(ownerPage.context());assert.ok(f.reception&&visit.document);
  const page=await authenticated(f,browser,f.reception),identity=await assertBrowserActor(f,page,f.reception);const invariant=await clinicalInvariant(f,visit);
  const registered=await registerFromAgenda(page,f,visit,debt,f.reception);expect(registered.pago?.estado).toBe('PENDIENTE');assert.ok(registered.pago);
  await openReview(page,f,visit,f.reception);const settle=await observeClinicalAction(f,page,f.reception,{action:'SETTLE',turnoId:visit.turnoId,pagoId:registered.pago.id});
  try{await page.getByRole('button',{name:'Marcar cobrado',exact:true}).click();const result=await settle.observed;expect(result.settlement?.pago.id).toBe(registered.pago.id);expect(result.settlement?.pago.estado).toBe('PAGADO');await uiExpect(page.getByRole('button',{name:'Listo',exact:true})).toBeVisible();}finally{await settle.dispose();}
  expect(new URL(page.url()).pathname).toBe('/hoy');expect(await clinicalInvariant(f,visit)).toBe(invariant);await assertFinalCounts(f,visit);
  assertAal1ProtectedRead(await identity.client.from('sesion').select('id').eq('id',visit.sessionId));expect([403,404]).toContain((await page.request.get(`/api/documentos/${visit.document.id}/archivo`)).status());
  await page.getByRole('button',{name:'Listo',exact:true}).click();await financeDenied(f,page,f.reception);
  await testInfo.attach('assistant-evidence.json',{contentType:'application/json',body:JSON.stringify({role:'ASISTENTE',browserUserId:identity.userId,browserSessionId:identity.sessionId,scope:'LISTA_PROFESIONALES',registration:'PENDIENTE',settlement:'same payment PAGADO',clinicalAndFinance:'denied',ownerFileControl:'positive'})});
 });
});
test.describe('coordinator',()=>{
 test.use({caseOptions:{receptionRole:'COORDINADOR'}});
 test('real COORDINADOR AAL2 cannot see or invoke financial operations',async({clinical:f,browser},testInfo)=>{
  const ownerPage=await authenticated(f,browser),visit=await prepareSavedVisit(ownerPage,f,{attachment:false});await closeClinically(ownerPage,f,visit);const receipt=await registerFromAgenda(ownerPage,f,visit,cash);assert.ok(receipt.pago);await f.closeContext(ownerPage.context());assert.ok(f.reception);
  const page=await authenticated(f,browser,f.reception),identity=await assertBrowserActor(f,page,f.reception);await page.goto(`/hoy?prof=${f.owner.memberId}`);await assertBrowserActor(f,page,f.reception);
  await uiExpect(page.locator('.fi-cerrado-row').filter({hasText:f.runId})).toBeVisible();
  for(const name of ['Revisar cobro','Registrar decisión','Marcar cobrado'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Monto en pesos',{exact:true})).toHaveCount(0);await expect(page.locator('.fi-cerrado-amount .fi-mono')).toHaveCount(0);
  const before=await clinicalInvariant(f,visit),payment=await currentPayment(f,visit),count=await receipts(f,visit);
  const status=await identity.client.rpc('get_turno_close_status',{p_org:f.reception.organizationId,p_turno:visit.turnoId});expect(status.error).toBeNull();expect(status.data).toMatchObject({puedeRegistrar:false,pago:null,clasificacion:'REGISTRADO'});
  for(const [rpc,args] of [
   ['close_turno_atomic',{p_org:f.reception.organizationId,p_turno:visit.turnoId,p_operation:randomUUID(),p_duracion:20,p_decision:cash}],
   ['resolve_turno_close',{p_org:f.reception.organizationId,p_turno:visit.turnoId,p_operation:randomUUID(),p_decision:cash}],
   ['settle_pago_atomic',{p_org:f.reception.organizationId,p_turno:visit.turnoId,p_pago:receipt.pago.id}],
  ] as const){const response=await identity.client.rpc(rpc,args);expect(response.error?.code).toBe('42501');expect(response.data).toBeNull();}
  assertAal1ProtectedRead(await identity.client.from('pago').select('id').eq('id',receipt.pago.id));
  expect(await clinicalInvariant(f,visit)).toBe(before);expect(await currentPayment(f,visit)).toEqual(payment);expect(await receipts(f,visit)).toBe(count);await financeDenied(f,page,f.reception);
  await testInfo.attach('coordinator-evidence.json',{contentType:'application/json',body:JSON.stringify({role:'COORDINADOR',browserUserId:identity.userId,browserSessionId:identity.sessionId,scope:'LISTA_PROFESIONALES',financialUI:'absent',financialRPC:'42501',payment:'exists but redacted and unchanged'})});
 });
});
