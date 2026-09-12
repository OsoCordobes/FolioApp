import {createHash} from 'node:crypto';
import {test,expect} from '../fixtures/local-test';
import {assertPolicies,createClinicalFixture,decryptSynthetic,firstFactorClient,loginClinical,type ClinicalFixture,type ClinicalSpecialty} from '../fixtures/clinical-local';

// This suite is deliberately absent from ordinary no-database test results.
// The dedicated run-clinical command fails early if its configuration is absent.
test.skip(process.env.FOLIO_TEST_CLINICAL!=='1','Not verified: requires the dedicated real local Supabase 17/Auth/TOTP/Storage fixture.');
test.describe.configure({mode:'serial',timeout:180000});
test.use({timezoneId:'Pacific/Auckland'}); // Browser timezone must not change Córdoba's appointment day.

let fixture:ClinicalFixture;
const completed=new Map<ClinicalSpecialty,{patientId:string;turnoId:string;sessionId:string;documentId:string;storagePath:string;marker:string}>();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');

test.beforeAll(async()=>{fixture=await createClinicalFixture();});
test.afterAll(async()=>{if(fixture)await fixture.close();});

test('real AAL1 cannot read staff membership or enter the dual patient portal',async()=>{
 await assertPolicies(fixture.db);
 const client=firstFactorClient(fixture),account=fixture.accounts[0];
 try {
  const login=await client.auth.signInWithPassword({email:account.email,password:account.password});expect(login.error).toBeNull();
  const status=await client.rpc('mfa_access_status');expect(status.error).toBeNull();
  expect(status.data).toMatchObject({required:true,allowed:false,isStaff:true,hasVerifiedFactor:true,sessionValid:false});
  const members=await client.from('member').select('id').eq('organization_id',account.organizationId);
  expect(members.error).toBeNull();expect(members.data).toEqual([]);
  const portal=await client.rpc('paciente_cuenta_actual');expect(portal.error?.code).toBe('42501');
 }finally{await client.auth.signOut({scope:'local'});}
});

for(const specialty of ['quiropraxia','cardiologia','psicologia'] as const){
 test(`${specialty}: walk-in → attend → save → attachment → cash payment → fresh login → reopen`,async({page},testInfo)=>{
  const account=fixture.accounts.find(item=>item.specialty===specialty)!;
  const marker=`SINTETICO-${fixture.runId}-${specialty}`;
  await loginClinical(page,account);
  await page.getByRole('button',{name:/^walk-in$/i}).click();
  const modal=page.getByRole('dialog');await expect(modal).toBeVisible();
  await modal.getByRole('button',{name:'Nuevo',exact:true}).click();
  await modal.getByPlaceholder('Nombre',{exact:true}).fill(`E2E ${fixture.runId}`);
  await modal.getByPlaceholder('Apellido',{exact:true}).fill(specialty);
  await modal.getByPlaceholder('Teléfono',{exact:true}).fill('+54 351 555 0100');
  // Deliberately omit email: no external communications and no person/contact
  // identity shortcuts. The unknown birth date must still permit narrative.
  await modal.getByRole('button',{name:'Crear turno',exact:true}).click();
  await expect(modal).toBeHidden({timeout:20000});
  await expect.poll(async()=>{
   const result=await fixture.db.query('SELECT count(*)::int AS n FROM public.turno WHERE organization_id=$1',[account.organizationId]);return result.rows[0].n;
  }).toBe(1);
  const {rows:[turno]}=await fixture.db.query('SELECT id,paciente_id,estado,origen FROM public.turno WHERE organization_id=$1',[account.organizationId]);
  expect(turno.estado).toBe('AGENDADO');expect(turno.origen).toBe('WALK_IN');
  const {rows:[identity]}=await fixture.db.query(`SELECT pi.nombre_cifrado,pi.apellido_cifrado,pi.fecha_nacimiento FROM public.paciente p JOIN public.paciente_identidad pi ON pi.id=p.identidad_id WHERE p.id=$1 AND p.organization_id=$2`,[turno.paciente_id,account.organizationId]);
  expect(decryptSynthetic(identity.nombre_cifrado)).toBe(`E2E ${fixture.runId}`);
  expect(decryptSynthetic(identity.apellido_cifrado)).toBe(specialty);
  expect(identity.fecha_nacimiento).toBeNull();
  const appointment=page.locator('.fi-turno').filter({hasText:fixture.runId});
  await appointment.getByRole('button',{name:'Marcar llegada',exact:true}).click();
  await expect.poll(async()=>{
   const result=await fixture.db.query('SELECT estado FROM public.turno WHERE id=$1',[turno.id]);return result.rows[0].estado;
  }).toBe('EN_SALA');
  await appointment.getByRole('button',{name:'Abrir ficha',exact:true}).click();
  await page.waitForURL(new RegExp(`/pacientes/${turno.paciente_id}(?:\\?|$)`),{timeout:30000});
  if(specialty==='quiropraxia')await page.getByLabel('Notas libres',{exact:true}).fill(marker);
  else await page.getByRole('textbox',{name:/^Subjetivo — nota SOAP/}).fill(marker);
  await page.getByRole('button',{name:'Guardar sesión',exact:true}).click();
  await expect(page.getByText(/Guardado ✓/)).toBeVisible({timeout:20000});
  const {rows:sessions}=await fixture.db.query('SELECT id,revision,soap_s_cifrado,tool_data_cifrado,locked_at FROM public.sesion WHERE turno_id=$1',[turno.id]);
  expect(sessions).toHaveLength(1);const session=sessions[0];expect(Number(session.revision)).toBeGreaterThanOrEqual(1);expect(session.locked_at).toBeNull();
  const narrative=specialty==='quiropraxia'?JSON.parse(decryptSynthetic(session.tool_data_cifrado)!).notasLibres:decryptSynthetic(session.soap_s_cifrado);
  expect(narrative).toBe(marker);
  const directWrite=await account.client.from('sesion').update({soap_s_cifrado:'\\x01'}).eq('id',session.id).select('id');
  expect(directWrite.error?.code).toBe('42501');
  const unchanged=await fixture.db.query('SELECT soap_s_cifrado,tool_data_cifrado FROM public.sesion WHERE id=$1',[session.id]);
  expect(unchanged.rows[0]).toEqual({soap_s_cifrado:session.soap_s_cifrado,tool_data_cifrado:session.tool_data_cifrado});
  // A new request must hydrate the value from Postgres before adding the file.
  await page.reload();
  if(specialty==='quiropraxia')await expect(page.getByLabel('Notas libres',{exact:true})).toHaveValue(marker);
  else await expect(page.getByRole('textbox',{name:/^Subjetivo — nota SOAP/})).toHaveValue(marker);
  await page.getByRole('tab',{name:'Documentos',exact:true}).click();
  const documents=page.getByRole('tabpanel',{name:'Documentos'});
  await documents.locator('input[type=file]').setInputFiles({name:'synthetic-one-pixel.png',mimeType:'image/png',buffer:png});
  await documents.getByRole('button',{name:'Subir',exact:true}).click();
  await expect.poll(async()=>{
   const result=await fixture.db.query('SELECT count(*)::int AS n FROM public.documento_clinico WHERE paciente_id=$1',[turno.paciente_id]);return result.rows[0].n;
  },{timeout:20000}).toBe(1);
  const {rows:[document]}=await fixture.db.query('SELECT id,storage_path,content_sha256 FROM public.documento_clinico WHERE paciente_id=$1',[turno.paciente_id]);
  expect(document.content_sha256).toBe(createHash('sha256').update(png).digest('hex'));
  const download=await page.request.get(`/api/documentos/${document.id}/archivo`);
  expect(download.status()).toBe(200);expect(await download.body()).toEqual(png);
  const direct=await account.client.storage.from('documentos-clinicos').download(document.storage_path.replace(/^documentos-clinicos\//,''));
  expect(direct.error).not.toBeNull(); // The authorized proxy is the sole clinical byte reader.

  await page.goto('/hoy');
  await page.locator('.fi-turno').filter({hasText:fixture.runId}).getByRole('button',{name:'Cerrar turno',exact:true}).click();
  const charge=page.getByRole('dialog');await charge.getByLabel('Monto en pesos').fill('30000');
  await charge.getByRole('button',{name:'Efectivo',exact:true}).click();
  await charge.getByRole('button',{name:'Cobrar y cerrar',exact:true}).click();
  await expect.poll(async()=>{
   const result=await fixture.db.query(`SELECT t.estado,(SELECT count(*)::int FROM public.pago p WHERE p.turno_id=t.id) AS pagos FROM public.turno t WHERE id=$1`,[turno.id]);return result.rows[0];
  },{timeout:20000}).toEqual({estado:'CERRADO',pagos:1});
  const {rows:[payment]}=await fixture.db.query('SELECT monto_cents,metodo,estado FROM public.pago WHERE turno_id=$1',[turno.id]);
  expect(payment).toEqual({monto_cents:3000000,metodo:'EFECTIVO',estado:'PAGADO'});
  const locked=await fixture.db.query('SELECT locked_at FROM public.sesion WHERE id=$1',[session.id]);expect(locked.rows[0].locked_at).not.toBeNull();

  await page.context().clearCookies();await loginClinical(page,account);
  await page.goto(`/pacientes/${turno.paciente_id}`);
  if(specialty==='quiropraxia'){
   await page.getByRole('group',{name:'Visitas previas',exact:true}).getByRole('button').first().click();
   await expect(page.getByLabel('Notas libres',{exact:true})).toHaveValue(marker);
  }
  else {
   await page.getByRole('tab',{name:/^Sesiones \(1\)$/}).click();
   await page.getByRole('button',{name:'Ver detalle',exact:true}).click();
   await expect(page.getByText(marker,{exact:true})).toBeVisible();
  }
  const restoredDownload=await page.request.get(`/api/documentos/${document.id}/archivo`);
  expect(restoredDownload.status()).toBe(200);expect(await restoredDownload.body()).toEqual(png);
  const totals=await fixture.db.query(`SELECT
   (SELECT count(*)::int FROM public.paciente WHERE organization_id=$1) AS pacientes,
   (SELECT count(*)::int FROM public.turno WHERE organization_id=$1) AS turnos,
   (SELECT count(*)::int FROM public.sesion WHERE organization_id=$1) AS sesiones,
   (SELECT count(*)::int FROM public.pago WHERE organization_id=$1) AS pagos`,[account.organizationId]);
  expect(totals.rows[0]).toEqual({pacientes:1,turnos:1,sesiones:1,pagos:1});
  await assertPolicies(fixture.db);
  completed.set(specialty,{patientId:turno.paciente_id,turnoId:turno.id,sessionId:session.id,documentId:document.id,storagePath:document.storage_path,marker});
  await testInfo.attach('clinical-evidence.json',{contentType:'application/json',body:JSON.stringify({synthetic:true,local:true,specialty,counts:totals.rows[0],mfa:'real Auth TOTP and login UI',storage:'uploaded and read twice through authenticated proxy',payment:'cash ledger only; no Mercado Pago subscription exercised',policies:'enforced',browserTimezone:'Pacific/Auckland',organizationTimezone:'America/Argentina/Cordoba'})});
 });
}

test('real cross-tenant and AAL1 clinical reads are denied through REST and the file proxy',async({page})=>{
 const account=fixture.accounts[1],target=completed.get('quiropraxia')!;
 const patient=await account.client.from('paciente').select('id').eq('id',target.patientId);
 expect(patient.error).toBeNull();expect(patient.data).toEqual([]);
 const session=await account.client.from('sesion').select('id').eq('id',target.sessionId);
 expect(session.error).toBeNull();expect(session.data).toEqual([]);
 await loginClinical(page,account);
 const denied=await page.request.get(`/api/documentos/${target.documentId}/archivo`);expect([403,404]).toContain(denied.status());
 const owner=fixture.accounts[0],aal1=firstFactorClient(fixture);
 try{
  const login=await aal1.auth.signInWithPassword({email:owner.email,password:owner.password});expect(login.error).toBeNull();
  for(const [table,id] of [['paciente',target.patientId],['sesion',target.sessionId],['documento_clinico',target.documentId]]){
   const deniedRead=await aal1.from(table).select('id').eq('id',id);expect(deniedRead.error).toBeNull();expect(deniedRead.data).toEqual([]);
  }
 }finally{await aal1.auth.signOut({scope:'local'});}
});

test('paused subscription redirects ordinary UI to billing but preserves the authorized clinical archive',async({page},testInfo)=>{
 const account=fixture.accounts[0],target=completed.get('quiropraxia')!;
 // A paused synthetic row exercises denial, not a fake successful payment.
 // No provider identifier, approved charge or billing exemption is introduced.
 await fixture.db.query('BEGIN');
 try{
  await fixture.db.query('UPDATE public.organization SET is_internal_account=false WHERE id=$1 AND is_synthetic=true',[account.organizationId]);
  await fixture.db.query(`INSERT INTO public.suscripcion(organization_id,payer_email,estado) VALUES($1,$2,'PAUSADA')`,[account.organizationId,account.email]);
  await fixture.db.query('COMMIT');
 }catch(error){await fixture.db.query('ROLLBACK');throw error;}
 await loginClinical(page,account,'billing');
 await page.goto('/hoy');
 await expect(page).toHaveURL(/\/configuracion\/billing(?:\?|$)/);
 await expect(page.getByRole('button',{name:/^walk-in$/i})).toHaveCount(0);
 await page.goto('/archivo-clinico');
 await expect(page.getByRole('heading',{name:'Archivo clínico',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:/^1 paciente disponible/})).toBeVisible();
 await expect(page.getByRole('button',{name:/Descargar PDF de.*quiropraxia/})).toBeVisible();
 await expect(page.getByRole('button',{name:/Descargar PDF de.*cardiologia/})).toHaveCount(0);
 const pdfEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:/Descargar PDF de.*quiropraxia/}).click();
 const pdfDownload=await pdfEvent;expect(await pdfDownload.failure()).toBeNull();
 const pdfStream=await pdfDownload.createReadStream();expect(pdfStream).not.toBeNull();
 const pdfChunks:Buffer[]=[];for await(const chunk of pdfStream!)pdfChunks.push(Buffer.from(chunk));
 const pdf=Buffer.concat(pdfChunks);expect(pdf.subarray(0,5).toString('ascii')).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(1000);
 const jsonEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:/Descargar datos clínicos de.*quiropraxia/}).click();
 const jsonDownload=await jsonEvent;expect(await jsonDownload.failure()).toBeNull();
 const jsonStream=await jsonDownload.createReadStream();expect(jsonStream).not.toBeNull();
 const jsonChunks:Buffer[]=[];for await(const chunk of jsonStream!)jsonChunks.push(Buffer.from(chunk));
 const clinicalData=JSON.parse(Buffer.concat(jsonChunks).toString('utf8'));expect(JSON.stringify(clinicalData)).toContain(target.marker);
 const other=completed.get('cardiologia')!;
 const forbiddenPdf=await page.request.get(`/api/pacientes/${other.patientId}/ficha-pdf`);expect([403,404]).toContain(forbiddenPdf.status());
 const state=await fixture.db.query(`SELECT o.is_synthetic,o.is_internal_account,s.estado,(SELECT count(*)::int FROM public.cargo_suscripcion c WHERE c.suscripcion_id=s.id) AS provider_charges FROM public.organization o JOIN public.suscripcion s ON s.organization_id=o.id WHERE o.id=$1`,[account.organizationId]);
 expect(state.rows[0]).toEqual({is_synthetic:true,is_internal_account:false,estado:'PAUSADA',provider_charges:0});
 await testInfo.attach('paused-archive-evidence.json',{contentType:'application/json',body:JSON.stringify({synthetic:true,subscription:'PAUSADA',ordinaryUI:'billing redirect',archive:'authorized PDF and clinical JSON downloads',crossTenant:'denied',serverMutationGate:'not exercised by this scenario',providerCharges:0})});
});

test('a signed AAL2 token stops passing the DB gate after real Auth session revocation',async()=>{
 const account=fixture.accounts[2],session=await account.client.auth.getSession();expect(session.data.session).not.toBeNull();
 const token=session.data.session!.access_token;
 const signout=await account.client.auth.signOut({scope:'local'});expect(signout.error).toBeNull();
 const response=await fetch(`${fixture.supabaseUrl}/rest/v1/rpc/mfa_access_status`,{method:'POST',headers:{apikey:fixture.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({required:true,allowed:false,sessionValid:false});
});
