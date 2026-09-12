import assert from 'node:assert/strict';
import {z} from 'zod';
import {assertClinicalPolicies} from '../../scripts/testing/clinical-config.mjs';
import {closeRequestSchema,resolveCloseRequestSchema,closeReceiptRequestSchema,type CloseReceiptRequest} from '../../lib/turnos/close-contract';

export function assertIntegratedPolicies(value:Record<string,unknown>):void {
 assertClinicalPolicies(value);
 for(const key of ['atomic_close','payment_settlement'])assert.equal(value?.[key],true,`Integrated clinical policy required: ${key}`);
}

/** Every registered cleanup runs, including after partial provisioning. Errors contain labels only. */
export class CleanupRegistry {
 private entries:{label:string;run:()=>Promise<void>}[]=[];
 add(label:string,run:()=>Promise<void>):void {this.entries.push({label,run});}
 async close():Promise<void> {
  const entries=this.entries.splice(0).reverse(),failed:string[]=[];
  for(const item of entries)try{await item.run();}catch{failed.push(item.label);}
  if(failed.length)throw new Error(`Clinical cleanup failed: ${failed.join(', ')}`);
 }
}
export async function authenticateRegistered<T>(cleanup:CleanupRegistry,steps:{login:()=>Promise<void>;enroll:()=>Promise<T>;revoke:()=>Promise<void>}):Promise<T> {
 cleanup.add('Auth session',steps.revoke); // Even a partial login/enrollment remains owned.
 await steps.login();return steps.enroll();
}

export type ClinicalAction=CloseReceiptRequest|{action:'SETTLE';turnoId:string;pagoId:string};
export interface ActionWire {url:string;method:string;actionId:string;body:string;contentType:string;}
const settle=z.object({turnoId:z.string().uuid(),pagoId:z.string().uuid()}).strict();
function parseActionInput(wire:ActionWire):Record<string,unknown> {
 const url=new URL(wire.url);
 assert.ok(url.origin==='http://localhost:4420'&&url.pathname==='/hoy'&&!url.username&&!url.password,'Unexpected clinical action destination');
 assert.equal(wire.method,'POST');assert.match(wire.actionId,/^[a-f0-9]{40}$/);
 assert.match(wire.contentType,/^text\/plain(?:;|$)/);
 // These actions take one plain JSON object; reject React references/multipart instead of guessing.
 const args:unknown=JSON.parse(wire.body,(_key,value)=>{if(value==='$undefined')return undefined;if(typeof value==='string'&&value.startsWith('$'))throw Error('Unsupported action reference');return value;});
 assert.ok(Array.isArray(args)&&args.length===1&&args[0]&&typeof args[0]==='object');
 return args[0] as Record<string,unknown>;
}
export function parseClinicalAction(wire:ActionWire):ClinicalAction {
 const input=parseActionInput(wire);
 if(Object.hasOwn(input,'to')){
  const parsed=closeRequestSchema.extend({to:z.literal('cerrado')}).parse(input);
  const {to:_to,...request}=parsed;return {action:'CLOSE',...request};
 }
 if(Object.hasOwn(input,'pagoId'))return {action:'SETTLE',...settle.parse(input)};
 return {action:'RESOLVE',...resolveCloseRequestSchema.parse(input)};
}

export function bindReceiptProbe(wire:ActionWire,compiledName:string|undefined,original:CloseReceiptRequest):CloseReceiptRequest|null {
 assert.ok(!['transitionTurnoAction','resolveTurnoCloseAction','marcarPagoCobradoAgendaAction'].includes(compiledName??''),'Writer invoked during receipt recovery');
 if(compiledName!=='getTurnoCloseReceiptAction')return null;
 const request=closeReceiptRequestSchema.parse(parseActionInput(wire));
 assert.deepEqual(request,original,'Receipt probe must preserve the complete original close snapshot');return request;
}

/** Transport failure after COMMIT is different from a failed fetch or failed SQL proof. */
export async function forwardThenLose<T>(steps:{fetch:()=>Promise<T>;commit:(response:T)=>Promise<void>;abort:()=>Promise<void>}):Promise<void> {
 try {const response=await steps.fetch();await steps.commit(response);}
 finally {await steps.abort();}
}
