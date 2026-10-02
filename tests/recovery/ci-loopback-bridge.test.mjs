import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {safeEnvironment} from '../../scripts/testing/isolation-policy.mjs';
import {GOOGLE_PROJECT} from '../../scripts/testing/google-c05-proof/contract.mjs';
import {MAIL_PROJECT} from '../../scripts/testing/mail-recipient-proof/prove.mjs';
import {validateBridgeTarget,preflightBridgeTarget,waitForBridgeTarget,bridgeFailureCategory} from '../../scripts/recovery/ci-loopback-bridge.mjs';

const project='folio_c01_source',service='db',containerId='a'.repeat(64),networkId='b'.repeat(64);
function metadata(selectedProject=project){return {
 project:selectedProject,service,containerId,remotePort:5432,
 labels:{'com.docker.compose.project':selectedProject,'com.docker.compose.service':service},
 networks:{[`${selectedProject}_default`]:{NetworkID:networkId,IPAddress:'172.30.0.3'}},
 network:{Name:`${selectedProject}_default`,Id:networkId,Internal:true,Driver:'bridge',Options:{},Labels:{'com.docker.compose.project':selectedProject},IPAM:{Config:[{Subnet:'172.30.0.0/16'}]},Containers:{[containerId]:{IPv4Address:'172.30.0.3/16'}}},
};}

test('Joined bridge accepts only its exact internal db/api-gw metadata',()=>{
 const joinedProject='folio_public_booking_joined_proof';
 for(const rejected of [joinedProject+'_extra','prefix_'+joinedProject,joinedProject.toUpperCase(),'folio_public_booking',
  'http://127.0.0.1:55421','https://example.invalid'])assert.throws(()=>validateBridgeTarget(metadata(rejected)));
 for(const selectedService of ['db','api-gw']){
  const own=()=>{const value=metadata(joinedProject);value.service=selectedService;
   value.labels['com.docker.compose.service']=selectedService;value.remotePort=selectedService==='db'?5432:8000;return value;};
  assert.deepEqual(validateBridgeTarget(own()),{address:'172.30.0.3',port:selectedService==='db'?5432:8000});
  for(const mutate of [x=>{x.network.Internal=false;},x=>{x.labels['com.docker.compose.project']=MAIL_PROJECT;},
   x=>{x.network.Labels['com.docker.compose.project']='foreign';},x=>{x.networks.other={};},
   x=>{x.networks[`${joinedProject}_default`].NetworkID='c'.repeat(64);},
   x=>{x.remotePort=selectedService==='db'?8000:5432;},x=>{x.service='rest';},
   x=>{x.networks[`${joinedProject}_default`].IPAddress='198.51.100.4';}]){
   const value=own();mutate(value);assert.throws(()=>validateBridgeTarget(value));
  }
 }
});

test('bridge accepts only the exact internal Compose target',()=>{
 assert.deepEqual(validateBridgeTarget(metadata()),{address:'172.30.0.3',port:5432});
 assert.deepEqual(validateBridgeTarget(metadata('folio_export_bytes_proof')),{address:'172.30.0.3',port:5432});
 assert.deepEqual(validateBridgeTarget(metadata('folio_caller_proof')),{address:'172.30.0.3',port:5432});
 for(const rejected of ['folio_export_bytes_proof_extra','folio_export_bytes','folio_c01_source_extra','folio_caller_proof_extra','prefix_folio_caller_proof']){
  assert.throws(()=>validateBridgeTarget(metadata(rejected)));
 }
 for(const mutate of [
  x=>{x.labels['com.docker.compose.project']='other';},
  x=>{x.network.Internal=false;},
  x=>{x.network.Driver='overlay';},
  x=>{x.network.Options['com.docker.network.bridge.gateway_mode_ipv4']='isolated';},
  x=>{x.networks.other={};},
  x=>{x.networks[`${project}_default`].IPAddress='198.51.100.7';},
  x=>{x.network.Containers[containerId].IPv4Address='172.30.0.4/16';},
  x=>{x.remotePort=8000;},
 ]){
  const value=metadata();mutate(value);
  assert.throws(()=>validateBridgeTarget(value));
 }
});

test('S1 bridge accepts only its exact internal db and api-gw targets',()=>{
 for(const selectedService of ['db','api-gw']){
  const value=metadata('folio_s1_indexing_proof');
  value.service=selectedService;
  value.labels['com.docker.compose.service']=selectedService;
  value.remotePort=selectedService==='db'?5432:8000;
  assert.deepEqual(validateBridgeTarget(value),{address:'172.30.0.3',port:value.remotePort});
 }
});

test('Google bridge accepts exact metadata and rejects foreign project/network/port',()=>{
 for(const selectedService of ['db','api-gw']){
  const googleMetadata=()=>{
   const value=metadata(GOOGLE_PROJECT);value.service=selectedService;
   value.labels['com.docker.compose.service']=selectedService;
   value.remotePort=selectedService==='db'?5432:8000;return value;
  };
  assert.deepEqual(validateBridgeTarget(googleMetadata()),{address:'172.30.0.3',port:selectedService==='db'?5432:8000});
  for(const mutate of [
   x=>{x.project=GOOGLE_PROJECT+'_extra';},
   x=>{x.labels['com.docker.compose.project']='folio_caller_proof';},
   x=>{x.labels['com.docker.compose.service']='other';},
   x=>{x.network.Internal=false;},
   x=>{x.network.Labels['com.docker.compose.project']='foreign';},
   x=>{x.networks.other={};},
   x=>{x.networks[`${GOOGLE_PROJECT}_default`].NetworkID='c'.repeat(64);},
   x=>{x.networks[`${GOOGLE_PROJECT}_default`].IPAddress='172.31.0.3';x.network.Containers[containerId].IPv4Address='172.31.0.3/16';},
   x=>{x.remotePort=443;},
  ]){const value=googleMetadata();mutate(value);assert.throws(()=>validateBridgeTarget(value));}
 }
});

test('Mail bridge accepts its exact db/api-gw destinations and rejects foreign variants',()=>{
 for(const rejected of [MAIL_PROJECT+'_extra','prefix_'+MAIL_PROJECT,'folio_mail_internal','folio_mail_proof',MAIL_PROJECT.toUpperCase(),
  'http://127.0.0.1:55421','https://example.invalid'])assert.throws(()=>validateBridgeTarget(metadata(rejected)));
 for(const selectedService of ['db','api-gw']){
  const mailMetadata=()=>{
   const value=metadata(MAIL_PROJECT);value.service=selectedService;
   value.labels['com.docker.compose.service']=selectedService;
   value.remotePort=selectedService==='db'?5432:8000;return value;
  };
  const target=validateBridgeTarget(mailMetadata());
  assert.deepEqual(target,{address:'172.30.0.3',port:selectedService==='db'?5432:8000});
  assert.equal(Object.isFrozen(target),true);
  for(const mutate of [
   x=>{x.labels['com.docker.compose.project']=GOOGLE_PROJECT;},
   x=>{x.labels['com.docker.compose.service']='rest';},
   x=>{x.service='auth';x.labels['com.docker.compose.service']='auth';},
   x=>{x.network.Internal=false;},
   x=>{x.network.Driver='overlay';},
   x=>{x.network.Labels['com.docker.compose.project']='foreign';},
   x=>{x.networks.other={};},
   x=>{x.networks[`${MAIL_PROJECT}_default`].NetworkID='c'.repeat(64);},
   x=>{x.networks[`${MAIL_PROJECT}_default`].IPAddress='172.31.0.3';x.network.Containers[containerId].IPv4Address='172.31.0.3/16';},
   x=>{x.remotePort=selectedService==='db'?8000:5432;},
   x=>{x.remotePort=443;},
  ]){const value=mailMetadata();mutate(value);assert.throws(()=>validateBridgeTarget(value));}
 }
});

test('validated parent capability crosses the guard only to its exact target and cleans up throws',()=>{
 const output=execFileSync(process.execPath,[fileURLToPath(new URL('./fixtures/bridge-isolation-probe.mjs',import.meta.url))],
  {env:safeEnvironment(process.env),encoding:'utf8',timeout:10000});
 assert.equal(output.trim(),'bridge_guard_exact_target_cleanup_pass');
});

test('S1 bridge rejects lookalike names, URLs, hosted addresses and foreign metadata before I/O',()=>{
 const s1Project='folio_s1_indexing_proof';
 for(const rejected of [s1Project+'_extra','prefix_'+s1Project,'folio_s1','',
  'http://127.0.0.1:55421','https://grkpayhxndztlfwxobnt.supabase.co']){
  assert.throws(()=>validateBridgeTarget(metadata(rejected)));
 }
 for(const selectedService of ['db','api-gw']){
  for(const mutate of [
   x=>{x.labels['com.docker.compose.project']='folio_caller_proof';},
   x=>{x.labels['com.docker.compose.service']='other';},
   x=>{x.network.Labels['com.docker.compose.project']='other';},
   x=>{x.network.Internal=false;},
   x=>{x.networks.other={};},
   x=>{x.networks[`${s1Project}_default`].NetworkID='c'.repeat(64);},
   x=>{x.remotePort=443;},
   ...['198.51.100.7','127.0.0.1','grkpayhxndztlfwxobnt.supabase.co',
    'https://grkpayhxndztlfwxobnt.supabase.co','http://127.0.0.1:55421'].map(address=>x=>{
     x.networks[`${s1Project}_default`].IPAddress=address;
     x.network.Containers[containerId].IPv4Address=`${address}/16`;
    }),
  ]){
   const value=metadata(s1Project);
   value.service=selectedService;
   value.labels['com.docker.compose.service']=selectedService;
   value.remotePort=selectedService==='db'?5432:8000;
   mutate(value);
   assert.throws(()=>validateBridgeTarget(value));
  }
 }
});

test('bridge direct-route preflight succeeds only for a reachable TCP service',async()=>{
 const service=net.createServer(socket=>socket.end());
 await new Promise(resolve=>service.listen({host:'127.0.0.1',port:0},resolve));
 const port=service.address().port;
 try{await preflightBridgeTarget({address:'127.0.0.1',port},1000);}
 finally{await new Promise(resolve=>service.close(resolve));}
 await assert.rejects(preflightBridgeTarget({address:'127.0.0.1',port},1000),/direct_route_unavailable/);
});

test('readiness waits only for the same delayed loopback listener and closes probe sockets',async()=>{
 const reservation=net.createServer();
 await new Promise(resolve=>reservation.listen({host:'127.0.0.1',port:0},resolve));
 const port=reservation.address().port;
 await new Promise(resolve=>reservation.close(resolve));
 const sockets=new Set();
 const service=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 const timer=setTimeout(()=>service.listen({host:'127.0.0.1',port}),180);
 try{
  const result=await waitForBridgeTarget({address:'127.0.0.1',port},1800);
  assert.ok(result.probes>1);
  assert.equal(result.lastCategory,'refused');
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(sockets.size,0);
 }finally{
  clearTimeout(timer);
  for(const socket of sockets)socket.destroy();
  if(service.listening)await new Promise(resolve=>service.close(resolve));
 }
});

test('readiness stops at its total deadline and reports only fixed categories',async()=>{
 const reservation=net.createServer();
 await new Promise(resolve=>reservation.listen({host:'127.0.0.1',port:0},resolve));
 const port=reservation.address().port;
 await new Promise(resolve=>reservation.close(resolve));
 const started=Date.now();
 await assert.rejects(waitForBridgeTarget({address:'127.0.0.1',port},450),error=>{
  assert.equal(error.message,'c01_bridge_direct_route_unavailable');
  assert.ok(['refused','timeout'].includes(error.reason));
  assert.ok(error.probes>=2);
  assert.equal(JSON.stringify(error).includes('ECONNREFUSED'),false);
  return true;
 });
 assert.ok(Date.now()-started<1500);
 assert.equal(bridgeFailureCategory('ECONNREFUSED'),'refused');
 assert.equal(bridgeFailureCategory('ETIMEDOUT'),'timeout');
 assert.equal(bridgeFailureCategory('EHOSTUNREACH'),'unreachable');
 assert.equal(bridgeFailureCategory('ENETUNREACH'),'unreachable');
 assert.equal(bridgeFailureCategory('private error text'),'other');
});
