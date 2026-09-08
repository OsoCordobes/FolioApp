import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';
import {assertLocalUrl,assertLoopbackHost,isolationError} from './isolation-policy.mjs';

export function installIsolation(){
 if(globalThis[Symbol.for('folio.test.isolation')])return;
 globalThis[Symbol.for('folio.test.isolation')]=true;
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=function(input,options){assertLocalUrl(typeof input==='string'||input instanceof URL?input:input.url);return nativeFetch(input,options);};
 function checkSocket(args){
  // Node internally normalizes connect arguments to [options, callback].
  let first=args[0];if(Array.isArray(first))first=first[0];
  if(first&&typeof first==='object'){if(first.path)return;assertLoopbackHost(first.host??first.hostname??'localhost');return;}
  if(typeof first==='string'&&!/^\d+$/.test(first))return; // Local IPC pipe/socket.
  assertLoopbackHost(typeof args[1]==='string'?args[1]:'localhost');
 }
 const socketConnect=net.Socket.prototype.connect;
 net.Socket.prototype.connect=function(...args){checkSocket(args);return socketConnect.apply(this,args);};
 const tlsConnect=tls.connect;tls.connect=function(...args){checkSocket(args);return tlsConnect.apply(this,args);};
 function checkRequest(args){const target=args[0];if(typeof target==='string'||target instanceof URL)assertLocalUrl(target);else if(target){if(target.socketPath)return;assertLoopbackHost(target.hostname??target.host??'localhost');}}
 for(const transport of [http,https])for(const key of ['request','get']){const original=transport[key];transport[key]=function(...args){checkRequest(args);return original.apply(this,args);};}
 const lookup=dns.lookup;dns.lookup=function(host,...args){assertLoopbackHost(host);return lookup.call(this,host,...args);};
 const lookupAsync=dns.promises.lookup;dns.promises.lookup=async function(host,...args){assertLoopbackHost(host);return lookupAsync.call(this,host,...args);};
 dgram.Socket.prototype.send=function(){throw isolationError('UDP network is disabled in automated tests.');};
 function assertFile(value){
  if(typeof value==='number')return;
  const filename=value instanceof URL?fileURLToPath(value):Buffer.isBuffer(value)?value.toString():String(value);
  if(/^\.env(?:\.|$)/i.test(path.basename(filename))){const error=isolationError('Automated tests cannot load environment files.');error.code='ENOENT';error.testIsolation=true;throw error;}
 }
 for(const key of ['readFileSync','openSync','createReadStream']){const original=fs[key];fs[key]=function(file,...args){assertFile(file);return original.call(this,file,...args);};}
 for(const key of ['readFile','open']){const original=fs[key];fs[key]=function(file,...args){try{assertFile(file);}catch(error){const callback=args.at(-1);if(typeof callback==='function'){queueMicrotask(()=>callback(error));return;}throw error;}return original.call(this,file,...args);};}
 for(const key of ['readFile','open']){const original=fsp[key];fsp[key]=async function(file,...args){assertFile(file);return original.call(this,file,...args);};}
 const exists=fs.existsSync;fs.existsSync=function(file){try{assertFile(file);}catch{return false;}return exists.call(this,file);};
 if(typeof process.loadEnvFile==='function')process.loadEnvFile=function(){throw isolationError('Environment file loading is disabled in automated tests.');};
 syncBuiltinESMExports();
}
