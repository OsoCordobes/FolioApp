import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import {fork} from 'node:child_process';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';

assert.equal(globalThis[Symbol.for('folio.test.isolation')],true);
assert.equal(process.env.NODE_ENV,'development');
assert.equal(process.env.TURNSTILE_SECRET_KEY,undefined);assert.equal(process.env.GOOGLE_OAUTH_CLIENT_SECRET,undefined);
assert.equal(process.env.RESEND_API_KEY,undefined);assert.equal(process.env.UNEXPECTED_PRIVATE_SECRET,undefined);
assert.ok(process.env.NODE_OPTIONS.includes('app-bootstrap.mjs'));
await assert.rejects(async()=>fetch('https://example.invalid'),{code:'FOLIO_TEST_ISOLATION'});
assert.throws(()=>net.connect({host:'198.51.100.1',port:443}),{code:'FOLIO_TEST_ISOLATION'});
assert.throws(()=>tls.connect({host:'198.51.100.1',port:443}),{code:'FOLIO_TEST_ISOLATION'});
assert.throws(()=>fs.readFileSync('.env.local'),error=>error.testIsolation===true);
if(!isMainThread){parentPort.postMessage('worker_guard_pass');}
else if(process.argv.includes('--ipc-child')){
 assert.equal(process.env.NEXT_PRIVATE_WORKER,'1');assert.equal(process.env.TURBOPACK,'1');
 process.send('ipc_guard_pass');process.disconnect();
}else{
 const worker=new Worker(new URL(import.meta.url));
 await new Promise((resolve,reject)=>{let passed=false;worker.on('message',value=>{passed=value==='worker_guard_pass';});
  worker.on('error',reject);worker.on('exit',code=>code===0&&passed?resolve():reject(Error('worker_guard_failed')));});
 const child=fork(fileURLToPath(import.meta.url),['--ipc-child'],{env:{...process.env,NEXT_PRIVATE_WORKER:'1',TURBOPACK:'1'},stdio:['ignore','ignore','ignore','ipc']});
 await new Promise((resolve,reject)=>{let passed=false;child.on('message',value=>{passed=value==='ipc_guard_pass';});
  child.on('error',reject);child.on('exit',code=>code===0&&passed?resolve():reject(Error('ipc_guard_failed')));});
 console.log('joined_next_bootstrap_parent_worker_ipc_guard_pass');
}
