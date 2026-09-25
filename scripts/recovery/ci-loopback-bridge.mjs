import assert from 'node:assert/strict';
import net from 'node:net';
import {performance} from 'node:perf_hooks';

function ipv4Number(value){
 if(net.isIP(value)!==4)throw Error('c01_bridge_ipv4_required');
 return value.split('.').reduce((number,octet)=>((number<<8)|Number(octet))>>>0,0);
}

function inSubnet(address,subnet){
 const [base,bitsText]=String(subnet).split('/');
 const bits=Number(bitsText);
 if(!Number.isInteger(bits)||bits<8||bits>30)return false;
 try{
  const mask=(0xffffffff<<(32-bits))>>>0;
  return (ipv4Number(address)&mask)===(ipv4Number(base)&mask);
 }catch{return false;}
}

/** Accept only an exact Compose service on its one internal project bridge. */
export function validateBridgeTarget({project,service,containerId,labels,networks,network,remotePort}){
 assert.ok(['folio_c01_source','folio_c01_destination','folio_export_bytes_proof','folio_caller_proof'].includes(project));
 assert.ok(['db','api-gw'].includes(service));
 assert.match(containerId,/^[a-f0-9]{64}$/);
 assert.equal(labels?.['com.docker.compose.project'],project);
 assert.equal(labels?.['com.docker.compose.service'],service);
 const networkName=`${project}_default`;
 assert.deepEqual(Object.keys(networks??{}),[networkName]);
 assert.equal(network?.Name,networkName);
 assert.equal(network?.Labels?.['com.docker.compose.project'],project);
 assert.equal(network?.Internal,true);
 assert.equal(network?.Driver,'bridge');
 assert.match(network?.Id??'',/^[a-f0-9]{64}$/);
 assert.ok(['', 'nat'].includes(network?.Options?.['com.docker.network.bridge.gateway_mode_ipv4']??''));
 const attachment=networks[networkName];
 assert.equal(attachment?.NetworkID,network.Id);
 assert.equal(network?.Containers?.[containerId]?.IPv4Address?.split('/')[0],attachment.IPAddress);
 assert.ok(Array.isArray(network?.IPAM?.Config));
 assert.ok(network.IPAM.Config.some(config=>inSubnet(attachment.IPAddress,config.Subnet)));
 assert.equal(remotePort,service==='db'?5432:8000);
 return {address:attachment.IPAddress,port:remotePort};
}

/** A failed direct route aborts before its loopback bridge opens. */
export async function preflightBridgeTarget(target,timeoutMs=3000){
 await new Promise((resolve,reject)=>{
  let socket;
  try{socket=net.connect({host:target.address,port:target.port});}
  catch{reject(bridgeFailure('other'));return;}
  const timer=setTimeout(()=>{socket.destroy();reject(bridgeFailure('timeout'));},timeoutMs);
  socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve();});
  socket.once('error',error=>{clearTimeout(timer);reject(bridgeFailure(bridgeFailureCategory(error?.code)));});
 });
}

export function bridgeFailureCategory(code){
 if(code==='ECONNREFUSED')return 'refused';
 if(code==='ETIMEDOUT')return 'timeout';
 if(code==='EHOSTUNREACH'||code==='ENETUNREACH')return 'unreachable';
 return 'other';
}
function bridgeFailure(reason,probes=0){
 const failure=Error('c01_bridge_direct_route_unavailable');
 failure.reason=reason;
 failure.probes=probes;
 failure.retryable=reason==='refused'||reason==='timeout';
 return failure;
}

/** Wait for the already-validated listener; never retry a route/permission error. */
export async function waitForBridgeTarget(target,totalTimeoutMs=15000){
 if(!Number.isInteger(totalTimeoutMs)||totalTimeoutMs<1||totalTimeoutMs>30000)
  throw bridgeFailure('other');
 const deadline=performance.now()+totalTimeoutMs;
 let probes=0,lastCategory='none';
 while(performance.now()<deadline){
  const remaining=Math.max(1,Math.ceil(deadline-performance.now()));
  probes++;
  try{await preflightBridgeTarget(target,Math.min(1000,remaining));return {probes,lastCategory};}
  catch(error){
   lastCategory=error?.reason??'other';
   if(error?.retryable!==true)throw bridgeFailure(lastCategory,probes);
  }
  const pause=Math.min(250,Math.max(0,deadline-performance.now()));
  if(pause>0)await new Promise(resolve=>setTimeout(resolve,pause));
 }
 throw bridgeFailure(lastCategory,probes);
}

/** Fixed upstream; no generic CONNECT handler, public listener, or DNS lookup. */
export async function openLoopbackBridge(target,localPort){
 assert.ok([55421,55422].includes(localPort));
 assert.equal(target.port,localPort===55422?5432:8000);
 assert.equal(net.isIP(target.address),4);
 const sockets=new Set();
 const server=net.createServer(inbound=>{
  const outbound=net.connect({host:target.address,port:target.port});
  sockets.add(inbound);sockets.add(outbound);
  const end=()=>{inbound.destroy();outbound.destroy();sockets.delete(inbound);sockets.delete(outbound);};
  inbound.once('error',end);outbound.once('error',end);
  inbound.once('close',end);outbound.once('close',end);
  inbound.pipe(outbound);outbound.pipe(inbound);
 });
 server.maxConnections=16;
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen({host:'127.0.0.1',port:localPort,exclusive:true},()=>{
   server.removeListener('error',reject);
   resolve();
  });
 });
 assert.equal(server.address().address,'127.0.0.1');
 let closed=false;
 return {async close(){
  if(closed)return;
  closed=true;
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>server.close(resolve));
 }};
}
