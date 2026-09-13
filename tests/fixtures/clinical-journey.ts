import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {Page} from '@playwright/test';
import {expect} from './local-test';
import {assertBrowserActor,decryptSynthetic,requireSuccess,type ClinicalAccount,type ClinicalFixture} from './clinical-local';
import {observeClinicalAction} from './clinical-response-loss';
import {closeStatusSchema,type CloseDecision,type CloseReceipt} from '../../lib/turnos/close-contract';

export const uiExpect=expect.configure({timeout:30000});
export const syntheticPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
export interface VisitEvidence {actor:ClinicalAccount;patientId:string;turnoId:string;sessionId:string;revision:number;marker:string;document?:{id:string;storage_path:string};}

export async function prepareSavedVisit(page:Page,fixture:ClinicalFixture,{actor=fixture.owner,attachment=true}:{actor?:ClinicalAccount;attachment?:boolean}={}):Promise<VisitEvidence> {
 assert.equal(actor.role,'OWNER');await assertBrowserActor(fixture,page,actor);await page.goto(`/hoy?prof=${actor.memberId}`);
 const marker=`SINTETICO-${fixture.runId}-${actor===fixture.foreign?'foreign':actor.specialty}`;
 await page.getByRole('button',{name:'Sin turno',exact:true}).click();const modal=page.getByRole('dialog');await uiExpect(modal).toBeVisible();
 await modal.getByRole('button',{name:'Nuevo',exact:true}).click();await modal.getByPlaceholder('Nombre',{exact:true}).fill(`E2E ${fixture.runId}`);
 await modal.getByPlaceholder('Apellido',{exact:true}).fill(actor.specialty);await modal.getByPlaceholder('Teléfono',{exact:true}).fill('+54 351 555 0100');
 const localDatetime=await modal.getByLabel('Fecha y hora',{exact:true}).inputValue();
 await modal.getByRole('button',{name:'Crear turno',exact:true}).click();await expect(modal).toBeHidden({timeout:20000});
 await expect.poll(async()=>{const r=await fixture.db.query('SELECT count(*)::int AS n FROM public.turno WHERE organization_id=$1',[actor.organizationId]);return r.rows[0].n;}).toBe(1);
 const {rows:[turno]}=await fixture.db.query(`SELECT id,paciente_id,estado,origen,to_char(inicio AT TIME ZONE 'America/Argentina/Cordoba','YYYY-MM-DD"T"HH24:MI') AS local_datetime FROM public.turno WHERE organization_id=$1`,[actor.organizationId]);
 expect(turno.estado).toBe('AGENDADO');expect(turno.origen).toBe('WALK_IN');expect(turno.local_datetime).toBe(localDatetime);
 const {rows:[identity]}=await fixture.db.query('SELECT pi.nombre_cifrado,pi.apellido_cifrado,pi.fecha_nacimiento FROM public.paciente p JOIN public.paciente_identidad pi ON pi.id=p.identidad_id WHERE p.id=$1 AND p.organization_id=$2',[turno.paciente_id,actor.organizationId]);
 expect(decryptSynthetic(identity.nombre_cifrado)).toBe(`E2E ${fixture.runId}`);expect(decryptSynthetic(identity.apellido_cifrado)).toBe(actor.specialty);expect(identity.fecha_nacimiento).toBeNull();
 const appointment=page.locator('.fi-turno').filter({hasText:fixture.runId});await appointment.getByRole('button',{name:'Marcar llegada',exact:true}).click();
 await expect.poll(async()=>{const r=await fixture.db.query('SELECT estado FROM public.turno WHERE id=$1',[turno.id]);return r.rows[0].estado;}).toBe('EN_SALA');
 await appointment.getByRole('button',{name:'Abrir ficha',exact:true}).click();await page.waitForURL(new RegExp(`/pacientes/${turno.paciente_id}(?:\\?|$)`),{timeout:30000});
 if(actor.specialty==='quiropraxia')await page.getByRole('textbox',{name:'Notas libres',exact:true}).fill(marker);
 else await page.getByRole('textbox',{name:/^Subjetivo — nota SOAP/}).fill(marker);
 await page.getByRole('button',{name:'Guardar sesión',exact:true}).click();await uiExpect(page.getByText(/Guardado ✓/)).toBeVisible();
 const {rows:sessions}=await fixture.db.query('SELECT id,revision,soap_s_cifrado,tool_data_cifrado,locked_at FROM public.sesion WHERE turno_id=$1',[turno.id]);
 expect(sessions).toHaveLength(1);const session=sessions[0];expect(Number(session.revision)).toBeGreaterThanOrEqual(1);expect(session.locked_at).toBeNull();
 expect(actor.specialty==='quiropraxia'?JSON.parse(decryptSynthetic(session.tool_data_cifrado)!).notasLibres:decryptSynthetic(session.soap_s_cifrado)).toBe(marker);
 const direct=await actor.client.from('sesion').update({soap_s_cifrado:'\\x01'}).eq('id',session.id).select('id');expect(direct.error?.code).toBe('42501');
 const unchanged=await fixture.db.query('SELECT soap_s_cifrado,tool_data_cifrado FROM public.sesion WHERE id=$1',[session.id]);expect(unchanged.rows[0]).toEqual({soap_s_cifrado:session.soap_s_cifrado,tool_data_cifrado:session.tool_data_cifrado});
 await page.reload();await uiExpect(actor.specialty==='quiropraxia'?page.getByRole('textbox',{name:'Notas libres',exact:true}):page.getByRole('textbox',{name:/^Subjetivo — nota SOAP/})).toHaveValue(marker);
 const visit:VisitEvidence={actor,patientId:turno.paciente_id,turnoId:turno.id,sessionId:session.id,revision:Number(session.revision),marker};
 if(attachment){
  await page.getByRole('tab',{name:'Documentos',exact:true}).click();const panel=page.getByRole('tabpanel',{name:'Documentos'});
  await panel.locator('input[type=file]').setInputFiles({name:'synthetic-one-pixel.png',mimeType:'image/png',buffer:syntheticPng});await panel.getByRole('button',{name:'Subir documento',exact:true}).click();
  await expect.poll(async()=>{const r=await fixture.db.query('SELECT count(*)::int AS n FROM public.documento_clinico WHERE paciente_id=$1',[visit.patientId]);return r.rows[0].n;},{timeout:20000}).toBe(1);
  const {rows:[document]}=await fixture.db.query('SELECT id,storage_path,content_sha256 FROM public.documento_clinico WHERE paciente_id=$1',[visit.patientId]);expect(document.content_sha256).toBe(createHash('sha256').update(syntheticPng).digest('hex'));visit.document=document;
  await assertDocumentDownload(page,visit);const denied=await actor.client.storage.from('documentos-clinicos').download(document.storage_path.replace(/^documentos-clinicos\//,''));expect(denied.error).not.toBeNull();
 }
 return visit;
}
export async function assertDocumentDownload(page:Page,visit:VisitEvidence):Promise<void> {
 assert.ok(visit.document);const response=await page.request.get(`/api/documentos/${visit.document.id}/archivo`);expect(response.status()).toBe(200);expect(await response.body()).toEqual(syntheticPng);
}
export async function clinicalInvariant(fixture:ClinicalFixture,visit:VisitEvidence){
 const {rows:[value]}=await fixture.db.query(`SELECT to_jsonb(s) AS original,
  jsonb_build_object('estado',t.estado,'duracion',t.duracion_real_min,'inicio',t.inicio,'atendiendo',t.atendiendo_desde) AS turno,
  (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM public.recordatorio_job j WHERE j.turno_id=t.id) AS jobs,
  (SELECT count(*)::int FROM public.transicion WHERE turno_id=t.id AND to_estado='CERRADO') AS closes,
  (SELECT count(*)::int FROM folio_session_private.receipt WHERE turno_id=t.id) AS clinical_receipts,
  (SELECT closed_at FROM folio_close_private.close_record WHERE turno_id=t.id) AS closed_at
  FROM public.turno t JOIN public.sesion s ON s.turno_id=t.id WHERE t.id=$1 AND s.id=$2`,[visit.turnoId,visit.sessionId]);
 assert.ok(value);return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export async function assertClosedVisit(fixture:ClinicalFixture,visit:VisitEvidence):Promise<void> {
 const {rows:[state]}=await fixture.db.query(`SELECT s.locked_at,s.revision,s.soap_s_cifrado,s.tool_data_cifrado,t.estado,
  (SELECT count(*)::int FROM public.sesion WHERE turno_id=t.id) AS sessions,
  (SELECT count(*)::int FROM public.transicion WHERE turno_id=t.id AND to_estado='CERRADO') AS closes,
  (SELECT count(*)::int FROM public.recordatorio_job WHERE turno_id=t.id AND tipo='POST_VISITA') AS jobs,
  (SELECT bool_and(j.scheduled_ts=c.closed_at+interval '2 hours') FROM public.recordatorio_job j JOIN folio_close_private.close_record c ON c.turno_id=j.turno_id WHERE j.turno_id=t.id AND j.tipo='POST_VISITA') AS correct_schedule
 FROM public.turno t JOIN public.sesion s ON s.turno_id=t.id WHERE t.id=$1`,[visit.turnoId]);
 expect(state).toMatchObject({estado:'CERRADO',sessions:1,closes:1,jobs:1,correct_schedule:true});expect(state.locked_at).not.toBeNull();expect(Number(state.revision)).toBe(visit.revision+1);expect(visit.actor.specialty==='quiropraxia'?JSON.parse(decryptSynthetic(state.tool_data_cifrado)!).notasLibres:decryptSynthetic(state.soap_s_cifrado)).toBe(visit.marker);
}
export async function closeClinically(page:Page,fixture:ClinicalFixture,visit:VisitEvidence):Promise<void> {
 // Reloading the same patient restores the Plan tab and current revision after upload.
 await page.goto(`/pacientes/${visit.patientId}`);
 await page.getByRole('button',{name:'Guardar y cerrar',exact:true}).click();
 await uiExpect(page.getByText('La atención quedó guardada y cerrada. Falta completar el registro del cobro en la agenda.',{exact:true})).toBeVisible();
 const {client}=await assertBrowserActor(fixture,page,visit.actor);const result=await client.rpc('get_turno_close_status',{p_org:visit.actor.organizationId,p_turno:visit.turnoId});requireSuccess(result.error,'clinical close status');
 expect(closeStatusSchema.parse(result.data)).toMatchObject({estado:'CERRADO',origen:'CLINICAL',clasificacion:'REQUIERE_REGISTRO',pago:null});
 const {rows:[state]}=await fixture.db.query(`SELECT s.locked_at,s.revision,
  (SELECT count(*)::int FROM public.pago WHERE turno_id=t.id) AS payments,
  (SELECT count(*)::int FROM folio_session_private.receipt WHERE turno_id=t.id AND intent='CLOSE') AS receipts,
  (SELECT count(*)::int FROM public.transicion WHERE turno_id=t.id AND to_estado='CERRADO') AS closes,
  (SELECT count(*)::int FROM public.recordatorio_job WHERE turno_id=t.id AND tipo='POST_VISITA') AS jobs,
  (SELECT bool_and(j.scheduled_ts=c.closed_at+interval '2 hours') FROM public.recordatorio_job j JOIN folio_close_private.close_record c ON c.turno_id=j.turno_id WHERE j.turno_id=t.id AND j.tipo='POST_VISITA') AS correct_schedule
  FROM public.turno t JOIN public.sesion s ON s.turno_id=t.id WHERE t.id=$1`,[visit.turnoId]);
 await assertClosedVisit(fixture,visit);expect(state.payments).toBe(0);expect(state.locked_at).not.toBeNull();expect(Number(state.revision)).toBeGreaterThanOrEqual(2);expect(state).toMatchObject({receipts:1,closes:1,jobs:1,correct_schedule:true});
}
export async function openReview(page:Page,fixture:ClinicalFixture,visit:VisitEvidence,actor=visit.actor):Promise<void> {
 await assertBrowserActor(fixture,page,actor);await page.goto(`/hoy?prof=${visit.actor.memberId}`);
 await page.locator(`[data-cobro-turno="${visit.turnoId}"]`).click();await uiExpect(page.getByRole('dialog')).toBeVisible();
}
export async function enterDecision(page:Page,decision:CloseDecision):Promise<void> {
 await page.getByLabel('Monto en pesos',{exact:true}).fill(String(decision.montoCents/100));
 if('metodo' in decision){assert.equal(decision.metodo,'EFECTIVO');await page.getByRole('button',{name:'Efectivo',exact:true}).click();await page.getByRole('checkbox',{name:/^Quedó debiendo/}).setChecked(!decision.pagado);}
}
export async function registerFromAgenda(page:Page,fixture:ClinicalFixture,visit:VisitEvidence,decision:CloseDecision,actor=visit.actor):Promise<CloseReceipt> {
 const invariant=await clinicalInvariant(fixture,visit);await openReview(page,fixture,visit,actor);await enterDecision(page,decision);
 const observer=await observeClinicalAction(fixture,page,actor,{action:'RESOLVE',turnoId:visit.turnoId,cobro:decision});
 try {await page.getByRole('button',{name:'Registrar decisión',exact:true}).click();const outcome=await observer.observed;assert.ok(outcome.receipt);await uiExpect(page.getByRole('button',{name:'Listo',exact:true})).toBeVisible();await page.getByRole('button',{name:'Listo',exact:true}).click();expect(await clinicalInvariant(fixture,visit)).toBe(invariant);return outcome.receipt;}finally{await observer.dispose();}
}
export async function reopenVisit(page:Page,visit:VisitEvidence):Promise<void> {
 await page.goto(`/pacientes/${visit.patientId}`);
 if(visit.actor.specialty==='quiropraxia'){await page.getByRole('group',{name:'Visitas previas',exact:true}).getByRole('button').first().click();await uiExpect(page.getByRole('textbox',{name:'Notas libres',exact:true})).toHaveValue(visit.marker);}
 else {await page.getByRole('tab',{name:/^Sesiones \(1\)$/}).click();await page.getByRole('button',{name:'Ver detalle',exact:true}).click();await uiExpect(page.getByText(visit.marker,{exact:true})).toBeVisible();}
 if(visit.document)await assertDocumentDownload(page,visit);
}
export async function assertFinalCounts(fixture:ClinicalFixture,visit:VisitEvidence):Promise<void> {
 const {rows:[counts]}=await fixture.db.query(`SELECT
 (SELECT count(*)::int FROM public.paciente WHERE organization_id=$1) AS pacientes,
 (SELECT count(*)::int FROM public.turno WHERE organization_id=$1) AS turnos,
 (SELECT count(*)::int FROM public.sesion WHERE organization_id=$1) AS sesiones,
 (SELECT count(*)::int FROM public.pago p JOIN public.turno t ON t.id=p.turno_id WHERE t.organization_id=$1) AS pagos`,[visit.actor.organizationId]);
 expect(counts).toEqual({pacientes:1,turnos:1,sesiones:1,pagos:1});
}
