import assert from 'node:assert/strict';
import net from 'node:net';

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
 assert.match(project,/^folio_c01_(source|destination)$/);
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

/** A failed direct route aborts before synthetic records or restore writes. */
export async function preflightBridgeTarget(target,timeoutMs=3000){
 await new Promise((resolve,reject)=>{
  const socket=net.connect({host:target.address,port:target.port});
  const timer=setTimeout(()=>{socket.destroy();reject(Error('c01_bridge_direct_route_unavailable'));},timeoutMs);
  socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve();});
  socket.once('error',()=>{clearTimeout(timer);reject(Error('c01_bridge_direct_route_unavailable'));});
 });
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
