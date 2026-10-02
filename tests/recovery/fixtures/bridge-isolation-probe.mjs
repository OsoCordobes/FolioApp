// Offline child: only loopback TCP is real. The native-route shim stands in for
// one Docker IP/port; it never opens a private-network or database connection.
import assert from 'node:assert/strict';
import net from 'node:net';
import {installIsolation} from '../../../scripts/testing/install-isolation.mjs';
import {safeEnvironment} from '../../../scripts/testing/isolation-policy.mjs';
const clean=safeEnvironment(process.env);
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,clean);
const upstream=net.createServer(socket=>socket.pipe(socket));
const upstreamSockets=new Set();upstream.on('connection',socket=>{upstreamSockets.add(socket);socket.once('close',()=>upstreamSockets.delete(socket));});
await new Promise(resolve=>upstream.listen({host:'127.0.0.1',port:0},resolve));
const nativeConnect=net.Socket.prototype.connect;
let exactCalls=0,throwNext=false,bridge;
net.Socket.prototype.connect=function(options,...rest){
 if(options?.host==='172.30.0.3'&&options.port===5432){
  exactCalls++;if(throwNext)throw Error('synthetic_connector_throw');
  return nativeConnect.call(this,{host:'127.0.0.1',port:upstream.address().port},...rest);
 }
 return nativeConnect.call(this,options,...rest);
};
try{
 const {validateBridgeTarget,preflightBridgeTarget,openLoopbackBridge}=await import('../../../scripts/recovery/ci-loopback-bridge.mjs');
 const project='folio_google_internal_proof',containerId='a'.repeat(64),networkId='b'.repeat(64),networkName=`${project}_default`;
 const metadata=()=>({project,service:'db',containerId,remotePort:5432,
  labels:{'com.docker.compose.project':project,'com.docker.compose.service':'db'},
  networks:{[networkName]:{NetworkID:networkId,IPAddress:'172.30.0.3'}},
  network:{Name:networkName,Id:networkId,Internal:true,Driver:'bridge',Labels:{'com.docker.compose.project':project},
   IPAM:{Config:[{Subnet:'172.30.0.0/16'}]},Containers:{[containerId]:{IPv4Address:'172.30.0.3/16'}}}});
 const target=validateBridgeTarget(metadata());assert.ok(Object.isFrozen(target));
 installIsolation();
 assert.throws(()=>{target.address='172.30.0.4';},TypeError);
 for(const options of [{host:'172.30.0.3',port:5432},{host:'172.30.0.4',port:5432},{host:'172.30.0.3',port:8000}]){
  assert.throws(()=>net.connect(options),error=>error.code==='FOLIO_TEST_ISOLATION');
 }
 assert.equal(exactCalls,0);
 await assert.rejects(openLoopbackBridge({...target},55422),/validated_target_required/);
 await assert.rejects(preflightBridgeTarget({address:'172.30.0.4',port:5432},100),/direct_route_unavailable/);
 // Metadata validated after the guard cannot mint a parent capability.
 await assert.rejects(preflightBridgeTarget(validateBridgeTarget(metadata()),100),/direct_route_unavailable/);
 assert.equal(exactCalls,0);await preflightBridgeTarget(target,1000);assert.equal(exactCalls,1);
 bridge=await openLoopbackBridge(target,55422);
 await new Promise((resolve,reject)=>{
  const client=net.connect({host:'127.0.0.1',port:55422});
  client.once('error',reject);client.once('connect',()=>client.write('bridge-loopback-proof'));
  client.once('data',data=>{assert.equal(data.toString(),'bridge-loopback-proof');client.destroy();resolve();});
 });
 assert.equal(exactCalls,2);throwNext=true;
 await new Promise((resolve,reject)=>{
  const client=net.connect({host:'127.0.0.1',port:55422});client.once('error',reject);client.once('close',resolve);
 });
 assert.equal(exactCalls,3);await bridge.close();await bridge.close();bridge=undefined;
 assert.throws(()=>net.connect({host:'172.30.0.3',port:5432}),error=>error.code==='FOLIO_TEST_ISOLATION');
 assert.equal(exactCalls,3);
 console.log('bridge_guard_exact_target_cleanup_pass');
}finally{
 await bridge?.close();for(const socket of upstreamSockets)socket.destroy();
 await new Promise(resolve=>upstream.close(resolve));
}
