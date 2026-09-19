import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {Page,Route} from '@playwright/test';
import {closeReceiptSchema,settlementReceiptSchema,type CloseDecision,type CloseReceipt,type SettlementReceipt} from '../../lib/turnos/close-contract';
import {assertBrowserActor,type ClinicalAccount,type ClinicalFixture} from './clinical-local';
import {parseClinicalAction,bindReceiptProbe,forwardThenLose,type ClinicalAction} from './clinical-safety';

export interface ExpectedAction {action:'CLOSE'|'RESOLVE'|'SETTLE';turnoId:string;cobro?:CloseDecision;duracionRealMin?:number;pagoId?:string;}
export interface CommittedAction {request:ClinicalAction;actionId:string;receipt?:CloseReceipt;settlement?:SettlementReceipt;}
const actionNames={CLOSE:'transitionTurnoAction',RESOLVE:'resolveTurnoCloseAction',SETTLE:'marcarPagoCobradoAgendaAction'};

/** Decode only this app's plain action Result in the actual Flight response. No invented business result. */
export function actionResult(body:string):{ok:true;data:unknown} {
 const chunks=new Map<string,unknown>();
 for(const line of body.split('\n')){const match=/^([0-9a-f]+):([\[{].*)$/.exec(line);if(match)try{chunks.set(match[1],JSON.parse(match[2]));}catch{/* Other Flight frames are not the action result. */}}
 const root=chunks.get('0') as {a?:unknown}|undefined;let value=root?.a;const visited=new Set<string>();
 while(typeof value==='string'&&/^\$@?[0-9a-f]+$/.test(value)){const key=value.replace(/^\$@?/,'');assert.ok(!visited.has(key),'Cyclic action response');visited.add(key);value=chunks.get(key);}
 assert.ok(value&&typeof value==='object'&&(value as {ok?:unknown}).ok===true&&Object.hasOwn(value,'data'),'The actual server action did not confirm success');return value as {ok:true;data:unknown};
}
async function exportedName(actionId:string):Promise<string|undefined> {
 // Read only the action's metadata; never log/persist the manifest encryption key.
 const manifest=JSON.parse(await readFile('.next-test/server/server-reference-manifest.json','utf8'));
 const entry=manifest.node?.[actionId]??manifest.edge?.[actionId];return entry?.exportedName;
}
export function bindExpected(request:ClinicalAction,expected:ExpectedAction):void {
 assert.equal(request.action,expected.action);assert.equal(request.turnoId,expected.turnoId);
 if(request.action==='SETTLE'){assert.equal(request.pagoId,expected.pagoId);return;}
 assert.deepEqual(request.cobro,expected.cobro);
 assert.equal(request.action==='CLOSE'?request.duracionRealMin:undefined,expected.duracionRealMin);
}
async function committed(fixture:ClinicalFixture,actor:ClinicalAccount,request:ClinicalAction,responseBody:string,receiptOnly=false):Promise<Omit<CommittedAction,'actionId'>> {
 const actual=actionResult(responseBody);
 if(request.action==='SETTLE'){
  const settlement=settlementReceiptSchema.parse(actual.data);assert.equal(settlement.turnoId,request.turnoId);assert.equal(settlement.pago.id,request.pagoId);
  const {rows}=await fixture.db.query(`SELECT jsonb_build_object('id',p.id,'montoCents',p.monto_cents,'metodo',p.metodo,'estado',p.estado,'pagadoTs',p.pagado_ts,'updatedAt',p.updated_at) AS pago FROM public.pago p JOIN public.turno t ON t.id=p.turno_id WHERE p.id=$1 AND t.id=$2 AND t.organization_id=$3`,[request.pagoId,request.turnoId,actor.organizationId]);
  assert.equal(rows.length,1);assert.deepEqual(settlement.pago,rows[0].pago);return {request,settlement};
 }
 const receipt=closeReceiptSchema.parse(request.action==='CLOSE'&&!receiptOnly?(actual.data as {cierre?:unknown})?.cierre:actual.data);
 const {rows}=await fixture.db.query('SELECT bound_input,result FROM folio_close_private.receipt WHERE organization_id=$1 AND actor_id=$2 AND operation_id=$3 AND turno_id=$4',[actor.organizationId,actor.memberId,request.operacionId,request.turnoId]);
 assert.equal(rows.length,1,'The exact action must commit before browser interruption');
 assert.deepEqual(rows[0].bound_input,[request.turnoId,request.action,request.action==='CLOSE'?request.duracionRealMin??null:null,request.cobro??null]);
 assert.deepEqual(receipt,rows[0].result);assert.equal(receipt.operationId,request.operacionId);
 const state=await fixture.db.query(`SELECT t.estado,(SELECT count(*)::int FROM public.pago WHERE turno_id=t.id) AS payments FROM public.turno t WHERE t.id=$1 AND t.organization_id=$2`,[request.turnoId,actor.organizationId]);
 assert.equal(state.rows[0]?.estado,'CERRADO');assert.equal(state.rows[0].payments,receipt.pago?1:0);return {request,receipt};
}

/** Observe real role-bearing POSTs, optionally remove one already committed response. */
export async function observeClinicalAction(fixture:ClinicalFixture,page:Page,actor:ClinicalAccount,expected:ExpectedAction,loseResponse=false):Promise<{observed:Promise<CommittedAction>;dispose:()=>Promise<void>}> {
 let resolve!:(value:CommittedAction)=>void,reject!:(reason:Error)=>void,settled=false,claimed=false;
 let failure:Error|undefined,removalFailed=false,removal:Promise<void>|undefined,disposal:Promise<void>|undefined;
 const observed=new Promise<CommittedAction>((yes,no)=>{resolve=yes;reject=no;});void observed.catch(()=>{});
 const pattern='http://localhost:4420/hoy**';
 // Automatic, caller and fixture cleanup share one protocol operation, even after page closure.
 const remove=()=>removal??=(async()=>{try{await page.unroute(pattern,handler);}catch{removalFailed=true;}})();
 async function handler(route:Route):Promise<void> {
  let stage='request';
  try {
   const request=route.request();const headers=await request.allHeaders();const actionId=headers['next-action'];
   if(request.method()!=='POST'||!actionId)return route.fallback();
   stage='manifest';
   if(await exportedName(actionId)!==actionNames[expected.action])return route.fallback();
   assert.ok(!claimed,'Only one matching financial request may be in flight');claimed=true;
   stage='request binding';const bound=parseClinicalAction({url:request.url(),method:request.method(),actionId,body:request.postData()??'',contentType:headers['content-type']??''});bindExpected(bound,expected);
   stage='browser identity';assert.ok(headers.cookie,'Financial browser POST requires its actual session cookie');await assertBrowserActor(fixture,page,actor,headers.cookie);
   let evidence:CommittedAction|undefined;
   stage='transport';const fetch=()=>route.fetch({maxRetries:0,maxRedirects:0,timeout:12000});
   const confirm=async(response:Awaited<ReturnType<typeof fetch>>)=>{
    stage='business response and committed SQL';assert.equal(response.status(),200,'Unexpected action HTTP response');assert.ok(!response.headers()['x-action-redirect'],'Action redirected instead of confirming');
    evidence={...await committed(fixture,actor,bound,await response.text()),actionId};
   };
   if(loseResponse)await forwardThenLose({fetch,commit:confirm,abort:()=>route.abort('failed')});
   else {const response=await fetch();await confirm(response);await route.fulfill({response});} // Unmodified real response only.
   assert.ok(evidence);settled=true;resolve(evidence);
  }catch{failure??=new Error(`Clinical action observation failed at ${stage}`);settled=true;reject(failure);try{await route.abort('failed');}catch{/* Already handled by the single-shot transport. */}}
  finally {if(claimed||settled)await remove();}
 }
 await page.route(pattern,handler);
 const dispose=()=>disposal??=(async()=>{
  await remove();
  if(!settled){failure=new Error('Expected clinical action was not observed');settled=true;reject(failure);}
  if(removalFailed)throw new Error(`${failure?.message??'Clinical action observation'}; interceptor removal failed`);
 })();
 fixture.cleanup.add('action interceptor',dispose);return {observed,dispose};
}

/** Keep the writer detector installed through UI acknowledgement and all recovery assertions. */
export async function observeClinicalReceiptProbe(fixture:ClinicalFixture,page:Page,actor:ClinicalAccount,original:CommittedAction):Promise<{observed:Promise<CommittedAction>;dispose:()=>Promise<void>}> {
 assert.ok(original.request.action!=='SETTLE'&&original.receipt,'A committed close receipt is required');const snapshot=original.request;
 let resolve!:(value:CommittedAction)=>void,reject!:(reason:Error)=>void,settled=false,claimed=false,failure:Error|undefined,disposal:Promise<void>|undefined;
 const observed=new Promise<CommittedAction>((yes,no)=>{resolve=yes;reject=no;});void observed.catch(()=>{});
 const pattern='http://localhost:4420/hoy**',inFlight=new Set<Promise<void>>();
 async function handle(route:Route):Promise<void> {
  let stage='request';
  try {
   const request=route.request(),headers=await request.allHeaders(),actionId=headers['next-action'];
   if(request.method()!=='POST'||!actionId)return await route.fallback();
   stage='compiled action and read-only binding';
   const bound=bindReceiptProbe({url:request.url(),method:request.method(),actionId,body:request.postData()??'',contentType:headers['content-type']??''},await exportedName(actionId),snapshot);
   if(!bound)return await route.fallback();
   assert.ok(!claimed,'Only one receipt probe is expected');claimed=true;
   stage='browser identity';assert.ok(headers.cookie);await assertBrowserActor(fixture,page,actor,headers.cookie);
   stage='receipt transport';const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:12000});assert.equal(response.status(),200);assert.ok(!response.headers()['x-action-redirect']);
   stage='returned receipt and committed SQL';const evidence={...await committed(fixture,actor,bound,await response.text(),true),actionId};assert.deepEqual(evidence.receipt,original.receipt);
   await route.fulfill({response});settled=true;resolve(evidence);
  }catch {failure??=new Error(`Clinical receipt probe failed at ${stage}`);settled=true;reject(failure);try{await route.abort('failed');}catch{/* The response may already have been consumed. */}}
 }
 function handler(route:Route):Promise<void> {const task=handle(route);inFlight.add(task);void task.then(()=>inFlight.delete(task),()=>inFlight.delete(task));return task;}
 await page.route(pattern,handler);
 const dispose=()=>disposal??=(async()=>{
  let removalFailed=false;try{await page.unroute(pattern,handler);}catch{removalFailed=true;}
  await Promise.all(inFlight);
  if(!settled){settled=true;reject(new Error('Expected browser receipt probe was not observed'));}
  // A writer after the observed promise resolved must still fail the recovery window.
  if(removalFailed)throw new Error(`${failure?.message??'Clinical receipt probe'}; interceptor removal failed`);
  if(failure)throw failure;
 })();
 fixture.cleanup.add('receipt probe and writer detector',dispose);return {observed,dispose};
}
