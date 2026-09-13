import assert from 'node:assert/strict';
import test from 'node:test';
import type {Page,Route} from '@playwright/test';
import type {ClinicalAccount,ClinicalFixture} from '../fixtures/clinical-local';
import {observeClinicalAction,observeClinicalReceiptProbe,type CommittedAction} from '../fixtures/clinical-response-loss';
import {CleanupRegistry} from '../fixtures/clinical-safety';

const privateDetail='SYNTHETIC-PRIVATE-TRANSPORT-DETAIL';
const turnoId='12000000-0000-4000-8000-000000000001';
const operationId='12000000-0000-4000-8000-000000000002';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};}
function harness(){
 const cleanup=new CleanupRegistry();let handler:((route:Route)=>Promise<void>)|undefined,closed=false,removals=0,abortCount=0;
 let beforeRemoval:()=>Promise<void>=async()=>{};
 const page={
  route:async(_pattern:string,callback:(route:Route)=>Promise<void>)=>{handler=callback;},
  unroute:async()=>{removals++;await beforeRemoval();if(closed)throw Error(privateDetail);},
 } as unknown as Page;
 const fixture={cleanup} as ClinicalFixture,actor={} as ClinicalAccount;
 const badRoute=(headers?:()=>Promise<Record<string,string>>)=>({
  request:()=>({allHeaders:headers??(async()=>{throw Error(privateDetail);})}),
  abort:async()=>{abortCount++;},
 } as unknown as Route);
 return {cleanup,page,fixture,actor,badRoute,
  invoke:(route:Route)=>{assert.ok(handler);return handler(route);},
  closePage:()=>{closed=true;},beforeRemoval:(next:()=>Promise<void>)=>{beforeRemoval=next;},
  removals:()=>removals,aborts:()=>abortCount,
 };
}
type Harness=ReturnType<typeof harness>;
const action=(h:Harness)=>observeClinicalAction(h.fixture,h.page,h.actor,{action:'RESOLVE',turnoId,cobro:{montoCents:1200,metodo:'EFECTIVO',pagado:true}});
function probe(h:Harness){
 // This metadata only enters lifecycle/error paths; no successful business ACK is fabricated.
 const original={request:{action:'CLOSE',turnoId,operacionId:operationId},actionId:'a'.repeat(42),receipt:{}} as CommittedAction;
 return observeClinicalReceiptProbe(h.fixture,h.page,h.actor,original);
}
function safeError(error:unknown,pattern:RegExp):boolean{
 return error instanceof Error&&pattern.test(error.message)&&!error.message.includes(privateDetail);
}

test('action disposal remains completed when fixture cleanup runs after its page closed',async()=>{
 const h=harness(),observer=await action(h);
 await observer.dispose();await assert.rejects(observer.observed,/not observed/);
 h.closePage();await h.cleanup.close();await observer.dispose();
 assert.equal(h.removals(),1);
});

test('automatic action removal and later manual/fixture disposal share one operation',async()=>{
 const h=harness(),observer=await action(h);
 await h.invoke(h.badRoute());await assert.rejects(observer.observed,error=>safeError(error,/failed at request/));
 assert.equal(h.aborts(),1);assert.equal(h.removals(),1);
 await observer.dispose();h.closePage();await h.cleanup.close();
 assert.equal(h.removals(),1);
});

test('concurrent disposal waits for one removal rather than racing two protocol requests',async()=>{
 const h=harness(),gate=deferred();h.beforeRemoval(()=>gate.promise);
 const observer=await action(h),first=observer.dispose(),second=observer.dispose();
 try{assert.equal(h.removals(),1);}finally{gate.resolve();await Promise.allSettled([first,second]);}
 await assert.rejects(observer.observed,/not observed/);h.closePage();await h.cleanup.close();
 assert.equal(h.removals(),1);
});

test('action handler contains removal failure and retains the original safe observation stage',async()=>{
 const h=harness();h.beforeRemoval(async()=>{throw Error(privateDetail);});const observer=await action(h);
 await assert.doesNotReject(h.invoke(h.badRoute()));
 await assert.rejects(observer.observed,error=>safeError(error,/failed at request/));
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(observer.dispose(),error=>safeError(error,/failed at request.*removal failed/));
 await assert.rejects(h.cleanup.close(),/Clinical cleanup failed: action interceptor/);
 assert.equal(h.removals(),1);
});

test('probe remains installed after an observation failure until explicit disposal and retains failure',async()=>{
 const h=harness(),observer=await probe(h);await h.invoke(h.badRoute());
 await assert.rejects(observer.observed,error=>safeError(error,/probe failed at request/));
 assert.equal(h.removals(),0);
 await assert.rejects(observer.dispose(),error=>safeError(error,/probe failed at request/));
 h.closePage();await assert.rejects(observer.dispose(),error=>safeError(error,/probe failed at request/));
 await assert.rejects(h.cleanup.close(),/receipt probe and writer detector/);assert.equal(h.removals(),1);
});

test('probe disposal still waits for an already running handler and reports its late failure',async()=>{
 const h=harness(),headers=deferred(),observer=await probe(h);
 const handling=h.invoke(h.badRoute(async()=>{await headers.promise;throw Error(privateDetail);}));
 let finished=false;const disposal=observer.dispose();void disposal.then(()=>{finished=true;},()=>{finished=true;});
 try{await Promise.resolve();await Promise.resolve();assert.equal(finished,false);assert.equal(h.removals(),1);}
 finally{headers.resolve();await handling;}
 await assert.rejects(observer.observed,error=>safeError(error,/probe failed at request/));
 await assert.rejects(disposal,error=>safeError(error,/probe failed at request/));
 await assert.rejects(observer.dispose(),error=>safeError(error,/probe failed at request/));assert.equal(h.removals(),1);
});

test('probe combines safe observation and removal failures without dropping its running handler',async()=>{
 const h=harness(),headers=deferred();h.beforeRemoval(async()=>{throw Error(privateDetail);});
 const observer=await probe(h),handling=h.invoke(h.badRoute(async()=>{await headers.promise;throw Error(privateDetail);}));
 let finished=false;const disposal=observer.dispose();void disposal.then(()=>{finished=true;},()=>{finished=true;});
 try{await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(finished,false);}
 finally{headers.resolve();await handling;}
 await assert.rejects(observer.observed,error=>safeError(error,/probe failed at request/));
 await assert.rejects(disposal,error=>safeError(error,/probe failed at request.*removal failed/));
 await assert.rejects(observer.dispose(),error=>safeError(error,/probe failed at request.*removal failed/));assert.equal(h.removals(),1);
});
