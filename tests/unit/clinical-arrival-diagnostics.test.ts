import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import type {Page,Request,Response} from '@playwright/test';
import {observeClinicalArrival} from '../fixtures/clinical-arrival-diagnostics';

const turnoId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actionId='a'.repeat(42),foreignActionId='b'.repeat(42);
const secret='SYNTHETIC-DO-NOT-PRINT';
function harness(){
 const events=new EventEmitter();let time=100;
 const cleanup:Array<()=>Promise<void>>=[];
 const manifest=JSON.stringify({encryptionKey:secret,node:{[actionId]:{exportedName:'transitionTurnoAction'},[foreignActionId]:{exportedName:'anotherAction'}}});
 const setup=()=>observeClinicalArrival(events as unknown as Page,{add(_label,run){cleanup.push(run);}},turnoId,{readManifest:async()=>manifest,now:()=>time});
 return {events,setup,cleanup,tick:(milliseconds:number)=>{time+=milliseconds;}};
}
function request(patch:Partial<{url:string;method:string;action:string;body:string;contentType:string}>={}):Request{
 const value={url:'http://localhost:4420/hoy?prof=synthetic',method:'POST',action:actionId,body:JSON.stringify([{turnoId,to:'en_sala',duracionRealMin:'$undefined'}]),contentType:'text/plain;charset=UTF-8',...patch};
 return {url:()=>value.url,method:()=>value.method,headers:()=>({'next-action':value.action,'content-type':value.contentType,cookie:secret}),postData:()=>value.body} as unknown as Request;
}
function response(req:Request,body:()=>Promise<string>,status=200):Response{return {request:()=>req,status:()=>status,text:body} as unknown as Response;}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

test('arrival diagnostics observe the exact arrival and actual Flight success without sending traffic',async()=>{
 const h=harness(),observer=await h.setup();assert.equal(h.cleanup.length,1);
 h.tick(7);const req=request();h.events.emit('request',req);
 assert.deepEqual(observer.snapshot(),{requestSeen:true,requestBound:true,responseSeen:false,requestFailed:false,bodyPending:false,status:null,requestMs:7,responseMs:null,elapsedMs:7,responseClassification:'pending'});
 h.tick(4);h.events.emit('response',response(req,async()=>`0:{"a":"$@2","f":[]}\n2:{"ok":true,"data":{"private":"${secret}"}}\n`));
 assert.equal(observer.snapshot().bodyPending,true);await flush();
 assert.equal(observer.snapshot().responseClassification,'success');assert.equal(observer.snapshot().bodyPending,false);assert.equal(observer.snapshot().responseMs,11);
 assert.doesNotMatch(observer.failureMessage(),new RegExp(`${secret}|${turnoId}|${actionId}|prof`));
 await observer.dispose();for(const event of ['request','response','requestfailed'])assert.equal(h.events.listenerCount(event),0);
});

test('arrival diagnostics separate no request from a known action with a different or unsupported input',async()=>{
 const h=harness(),observer=await h.setup();
 for(const req of [request({url:'https://example.test/hoy'}),request({url:'http://localhost:4420/hoy/other'}),request({url:'http://user:pass@localhost:4420/hoy'}),request({method:'GET'}),request({action:foreignActionId})])h.events.emit('request',req);
 assert.equal(observer.snapshot().requestSeen,false);
 for(const body of [JSON.stringify([{turnoId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',to:'en_sala'}]),JSON.stringify([{turnoId,to:'cerrado'}]),JSON.stringify([{turnoId,to:'en_sala',duracionRealMin:30}]),JSON.stringify([{turnoId,to:'en_sala',cobro:secret}]),`[{"turnoId":"${turnoId}","to":"en_sala","duracionRealMin":"$1"}]`,`${secret}{`,JSON.stringify([{turnoId,to:'en_sala'},{}])])h.events.emit('request',request({body}));
 assert.equal(observer.snapshot().requestSeen,true);assert.equal(observer.snapshot().requestBound,false);
 assert.doesNotMatch(observer.failureMessage(),new RegExp(secret));await observer.dispose();
});

test('arrival diagnostics never mistake a response to another request for the bound arrival',async()=>{
 const h=harness(),observer=await h.setup(),req=request(),other=request();
 h.events.emit('request',req);h.events.emit('response',response(other,async()=>{throw new Error(secret);}));h.events.emit('requestfailed',other);
 assert.equal(observer.snapshot().responseSeen,false);assert.equal(observer.snapshot().requestFailed,false);
 h.events.emit('requestfailed',req);assert.equal(observer.snapshot().requestFailed,true);await observer.dispose();
});

test('HTTP 200 is not a business acknowledgement and unsuccessful or unreadable bodies stay sanitized',async()=>{
 for(const [body,classification] of [
  [async()=>`0:{"a":"$@2"}\n2:{"ok":false,"error":{"message":"${secret}"}}\n`,'not_confirmed'],
  [async()=>`0:{"a":"$@2"}\n2:{"ok":true}\n`,'not_confirmed'],
  [async()=>secret,'not_confirmed'],
  [async()=>{throw new Error(secret);},'unreadable'],
 ] as const){
  const h=harness(),observer=await h.setup(),req=request();h.events.emit('request',req);h.events.emit('response',response(req,body));await flush();
  assert.equal(observer.snapshot().status,200);assert.equal(observer.snapshot().responseClassification,classification);assert.doesNotMatch(observer.failureMessage(),new RegExp(secret));await observer.dispose();
 }
});

test('non-200 response is recorded without reading its body',async()=>{
 const h=harness(),observer=await h.setup(),req=request();let reads=0;
 h.events.emit('request',req);h.events.emit('response',response(req,async()=>{reads++;return secret;},503));await flush();
 assert.equal(reads,0);assert.equal(observer.snapshot().status,503);assert.equal(observer.snapshot().responseClassification,'not_confirmed');await observer.dispose();
});

test('registered cleanup removes all listeners promptly even while the response body never resolves',async()=>{
 const h=harness(),observer=await h.setup(),req=request();let resolveBody!:(body:string)=>void;
 h.events.emit('request',req);h.events.emit('response',response(req,()=>new Promise(resolve=>{resolveBody=resolve;})));
 assert.equal(observer.snapshot().bodyPending,true);await h.cleanup[0]();
 for(const event of ['request','response','requestfailed'])assert.equal(h.events.listenerCount(event),0);
 const after=observer.snapshot();resolveBody(`0:{"a":"$@2"}\n2:{"ok":true,"data":{}}\n`);await flush();
 assert.deepEqual(observer.snapshot(),after);await observer.dispose();
});

test('manifest failures are sanitized and happen before any event listeners are installed',async()=>{
 const events=new EventEmitter();
 for(const readManifest of [async()=>{throw new Error(secret);},async()=>`{"encryptionKey":"${secret}",`,async()=>JSON.stringify({encryptionKey:secret,node:{}})]){
  await assert.rejects(()=>observeClinicalArrival(events as unknown as Page,{add(){throw new Error('Must not register');}},turnoId,{readManifest}),error=>error instanceof Error&&error.message==='Clinical arrival observation could not load action metadata.');
  assert.equal(events.eventNames().length,0);
 }
});
