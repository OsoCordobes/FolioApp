import {test} from 'node:test';
import assert from 'node:assert/strict';
import {servicesRequestKind,servicesResponseCategory,servicesActionKind,createServicesObserver,servicesAlertCategory,servicesPageErrorKind,servicesProofLines} from '../../scripts/testing/auth-proof/diagnostics.mjs';

const org='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const operation='33333333-3333-4333-8333-333333333333';
const row={id:'44444444-4444-4444-8444-444444444444',nombre:'password=SECRET_DECOY',dur:30,precioCents:0,tipoCanonico:'SERVICIO_ESPECIALIZADO'};
const command={organizationId:org,operacionId:operation,revision:0,servicios:[row]};
const flight=(value:unknown)=>`0:${JSON.stringify({a:'$@1'})}\n1:${JSON.stringify(value)}\n`;
const marker='services_proof_response:phase=initial_save index=1 seen=request state=responded request=services_command action=services_write http=200 result=ok code=none outcome=none revision=1 rows=1';

test('known service command is correlated without emitting argument values',async()=>{
 const request=await servicesRequestKind(JSON.stringify([command,user]),'text/plain;charset=UTF-8');
 const result=servicesResponseCategory(flight({ok:true,data:{revision:1,servicios:[row]}}));
 assert.equal(request,'services_command');
 assert.equal(servicesActionKind(request,result),'services_write');
 assert.deepEqual(result,{result:'ok',code:'none',outcome:'none',revision:'1',rows:'1',shape:'snapshot'});
 assert.doesNotMatch(JSON.stringify({request,result}),/SECRET_DECOY|11111111|44444444|password=/);
});

test('multipart root arguments work without following unrelated form values',async()=>{
 const body=`--proof\r\nContent-Disposition: form-data; name="0"\r\n\r\n${JSON.stringify([command,user])}\r\n--proof\r\nContent-Disposition: form-data; name="secret"\r\n\r\nTOKEN_DECOY\r\n--proof--\r\n`;
 assert.equal(await servicesRequestKind(body,'multipart/form-data; boundary=proof'),'services_command');
 const duplicate=body.replace('--proof--',`--proof\r\nContent-Disposition: form-data; name="0"\r\n\r\n[]\r\n--proof--`);
 assert.equal(await servicesRequestKind(duplicate,'multipart/form-data; boundary=proof'),'unknown');
 assert.equal(await servicesRequestKind(body,'multipart/form-data; boundary=missing'),'unknown');
});

test('invalid service content retains recognizable command shape for a rejection',async()=>{
 const request=await servicesRequestKind(JSON.stringify([{...command,servicios:[{...row,nombre:'',dur:0}]},user]));
 const result=servicesResponseCategory(flight({ok:false,error:{code:'validation',message:'SECRET_DECOY'}}));
 assert.equal(request,'services_command');
 assert.equal(servicesActionKind(request,result),'services_write');
 assert.equal(result.result,'rejected');
 assert.equal(result.code,'validation');
 assert.doesNotMatch(JSON.stringify(result),/SECRET_DECOY/);
});

test('UUID pair alone is ambiguous; only the known snapshot response narrows it',async()=>{
 const request=await servicesRequestKind(JSON.stringify([org,user]));
 assert.equal(request,'uuid_pair');
 assert.equal(servicesActionKind(request,servicesResponseCategory(flight({ok:true}))),'unknown');
 assert.equal(servicesActionKind(request,servicesResponseCategory(flight({ok:true,data:{revision:0,servicios:[]}}))),'services_snapshot');
});

test('other wizard save with ok and root revision is not a services write',async()=>{
 const request=await servicesRequestKind(JSON.stringify([5,{organizationId:org,revision:0}]));
 const result=servicesResponseCategory(flight({ok:true,revision:1}));
 assert.equal(request,'step_args');
 assert.equal(servicesActionKind(request,result),'step_update');
 assert.equal(result.revision,'1');
 assert.equal(result.rows,'unknown');
 assert.equal(servicesActionKind('unknown',result),'unknown');
});

test('unresolved, malformed, oversized or extra argument shapes remain unknown',async()=>{
 for(const body of ['not JSON','[]','{}',JSON.stringify(['$1',user]),JSON.stringify([command,user,'TOKEN_DECOY']),JSON.stringify([{...command,secret:'TOKEN_DECOY'},user]),JSON.stringify([{...command,servicios:[{...row,secret:'TOKEN_DECOY'}]},user]),'x'.repeat(1_048_577)])
  assert.equal(await servicesRequestKind(body),'unknown');
});

test('Flight action and data references are bounded, including valid empty snapshot',()=>{
 const body='0:{"a":"$@1"}\n1:{"ok":true,"data":"$2"}\n2:{"revision":0,"servicios":[]}\n';
 assert.deepEqual(servicesResponseCategory(body),{result:'ok',code:'none',outcome:'none',revision:'0',rows:'0',shape:'snapshot'});
 assert.equal(servicesResponseCategory('0:{"a":"$@1"}\n1:"$2"\n2:"$1"\n').result,'unknown');
 assert.equal(servicesResponseCategory('0:{"a":"$@1"}\n1:{"ok":true}\n1:{"ok":false}\n').result,'unknown');
 assert.equal(servicesResponseCategory('0:{"a":"$@a"}\n').result,'unknown');
 assert.equal(servicesResponseCategory('x'.repeat(1_048_577)).result,'unknown');
});

test('ok without a valid snapshot never claims rows or service revision',()=>{
 for(const data of [{revision:1,servicios:[{...row,id:'bad'}]},{revision:1,servicios:[{...row,dur:0}]},{revision:-1,servicios:[]},{revision:Number.MAX_SAFE_INTEGER+1,servicios:[]},{revision:1,servicios:Array(31).fill(row)},{revision:1,servicios:'TOKEN_DECOY'}]){
  const result=servicesResponseCategory(flight({ok:true,data}));
  assert.equal(result.result,'ok');
  assert.equal(result.shape,'unknown');
  assert.equal(result.revision,'unknown');
  assert.equal(result.rows,'unknown');
 }
});

test('rejections output only domain enums, never message/detail or arbitrary codes',()=>{
 const known=servicesResponseCategory(flight({ok:false,error:{code:'network',mutationOutcome:'uncertain',message:'SECRET_DECOY',detail:'TOKEN_DECOY'}}));
 assert.deepEqual(known,{result:'rejected',code:'network',outcome:'uncertain',revision:'unknown',rows:'unknown',shape:'unknown'});
 const unknown=servicesResponseCategory(flight({ok:false,error:{code:'SECRET_DECOY',mutationOutcome:'TOKEN_DECOY',message:'patient@example.test'}}));
 assert.equal(unknown.code,'unknown');
 assert.equal(unknown.outcome,'unknown');
 assert.doesNotMatch(JSON.stringify([known,unknown]),/SECRET_DECOY|TOKEN_DECOY|patient@/);
});

test('alert fallback without title and known title are categorized without text',()=>{
 assert.equal(servicesAlertCategory('No se pudo guardar. Reintentar guardar'),'no_message');
 assert.equal(servicesAlertCategory('No se pudo guardar.Reintentar guardar'),'no_message');
 assert.equal(servicesAlertCategory('Revisá los servicios antes de guardar.'),'validation');
 assert.equal(servicesAlertCategory('SECRET_DECOY','No tenés permiso para esa acción.'),'forbidden');
 for(const value of ['TOKEN_DECOY','patient@example.test','https://host.invalid/?token=SECRET_DECOY','No tenés permiso para esa acción. SECRET_DECOY'])
  assert.equal(servicesAlertCategory(value,value),'unknown');
});

test('pageerror classification is closed, including prototype property names',()=>{
 assert.equal(servicesPageErrorKind('TypeError'),'type_error');
 assert.equal(servicesPageErrorKind('Error'),'error');
 for(const value of ['SECRET_DECOY','toString','constructor','__proto__','TypeError TOKEN_DECOY'])
  assert.equal(servicesPageErrorKind(value),'unknown');
});

test('outer runner passes only full closed markers, rejects secret suffixes and free text',()=>{
 const alert='services_proof_alert:phase=initial_save index=1 scope=other category=unknown';
 const error='services_proof_pageerror:phase=initial_save kind=type_error count=1';
 const secrets=[`${marker} SECRET_DECOY`,`before ${marker}`,marker.replace('code=none','code=TOKEN_DECOY'),alert.replace('scope=other','scope=patient@example.test'),error.replace('kind=type_error','kind=constructor'),'0:{"a":"SECRET_DECOY"}','Next-Action: ACTION_ID_DECOY'];
 const output=servicesProofLines([marker,alert,error,...secrets].join('\r\n'));
 assert.deepEqual(output,[marker,alert,error]);
 assert.doesNotMatch(output.join('\n'),/SECRET_DECOY|TOKEN_DECOY|patient@|ACTION_ID/);
 assert.equal(servicesProofLines(Array(40).fill(marker).join('\n')).length,27);
});

const within=<T>(work:()=>Promise<T>,fallback:T)=>Promise.resolve().then(work).catch(()=>fallback);
const requestFixture=(body:string,path='/onboarding')=>({method:()=>'POST',url:()=>`http://localhost:4430${path}`,postData:()=>body,headers:()=>({'content-type':'text/plain','next-action':'ACTION_ID_DECOY'})});

test('request lifecycle distinguishes pending, failed and responded without copying headers',async()=>{
 const observer=createServicesObserver(within);
 const pending=requestFixture(JSON.stringify([command,user]));
 const failed=requestFixture(JSON.stringify([command,user]));
 const responded=requestFixture(JSON.stringify([org,user]));
 observer.request(pending);observer.request(failed);observer.request(responded);
 observer.requestfailed(failed);
 observer.response({request:()=>responded,status:()=>200,text:async()=>flight({ok:true,data:{revision:0,servicios:[]}})});
 observer.request(requestFixture(JSON.stringify([command,user]),'/login'));
 const rows=await observer.finish();
 assert.deepEqual(rows.map(value=>[value.state,value.action,value.http]),[['pending','services_write','none'],['failed','services_write','none'],['responded','services_snapshot','200']]);
 assert.doesNotMatch(JSON.stringify(rows),/SECRET_DECOY|ACTION_ID_DECOY|11111111|localhost|password=/);
});

test('response-only observation stays distinguished and malformed responses remain unknown',async()=>{
 const observer=createServicesObserver(within);
 observer.response({request:()=>requestFixture(JSON.stringify([command,user])),status:()=>200,text:async()=>{throw Error('TOKEN_DECOY');}});
 const [row]=await observer.finish();
 assert.equal(row.seen,'response_only');
 assert.equal(row.state,'responded');
 assert.equal(row.action,'services_write');
 assert.equal(row.result,'unknown');
 assert.equal(row.revision,'unknown');
 assert.doesNotMatch(JSON.stringify(row),/TOKEN_DECOY|SECRET_DECOY/);
});

test('observation limit explicitly counts dropped events without claiming absence',async()=>{
 const observer=createServicesObserver(within);
 for(let index=0;index<12;index++)observer.request(requestFixture(JSON.stringify([command,user])));
 assert.equal((await observer.finish()).length,9);
 assert.equal(observer.droppedEvents(),3);
 const marker=`services_proof_observation:phase=initial_save captured=9 dropped_events=${observer.droppedEvents()}`;
 assert.deepEqual(servicesProofLines(marker),[marker]);
 assert.deepEqual(servicesProofLines('services_proof_alert:phase=initial_save index=0 scope=unknown category=unknown'),['services_proof_alert:phase=initial_save index=0 scope=unknown category=unknown']);
});
