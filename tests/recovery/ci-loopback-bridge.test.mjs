import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import {validateBridgeTarget,preflightBridgeTarget} from '../../scripts/recovery/ci-loopback-bridge.mjs';

const project='folio_c01_source',service='db',containerId='a'.repeat(64),networkId='b'.repeat(64);
function metadata(){return {
 project,service,containerId,remotePort:5432,
 labels:{'com.docker.compose.project':project,'com.docker.compose.service':service},
 networks:{[`${project}_default`]:{NetworkID:networkId,IPAddress:'172.30.0.3'}},
 network:{Name:`${project}_default`,Id:networkId,Internal:true,Driver:'bridge',Options:{},Labels:{'com.docker.compose.project':project},IPAM:{Config:[{Subnet:'172.30.0.0/16'}]},Containers:{[containerId]:{IPv4Address:'172.30.0.3/16'}}},
};}

test('bridge accepts only the exact internal Compose target',()=>{
 assert.deepEqual(validateBridgeTarget(metadata()),{address:'172.30.0.3',port:5432});
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

test('bridge direct-route preflight succeeds only for a reachable TCP service',async()=>{
 const service=net.createServer(socket=>socket.end());
 await new Promise(resolve=>service.listen({host:'127.0.0.1',port:0},resolve));
 const port=service.address().port;
 try{await preflightBridgeTarget({address:'127.0.0.1',port},1000);}
 finally{await new Promise(resolve=>service.close(resolve));}
 await assert.rejects(preflightBridgeTarget({address:'127.0.0.1',port},1000),/direct_route_unavailable/);
});
