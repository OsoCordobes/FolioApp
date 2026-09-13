import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPostgresSource} from '../../scripts/backup/source.mjs';
import {closePgClient,postgresDiagnosticFailure} from '../../scripts/backup/postgres.mjs';

const phi='PRIVATE_PATIENT secret=synthetic-password patient@example.invalid';
function fixture(overrides={}) {
  const received=[];
  const client=Object.assign(new EventEmitter(),{
    ended:0,queries:[],connect:async()=>{},
    async query(sql){this.queries.push(sql);return {rows:sql.startsWith('show')?[{server_version_num:'170006'}]:[{id:'synthetic-snapshot'}]};},
    async end(){this.ended++;},
  },overrides);
  const source=createPostgresSource({databaseUrl:'postgresql://synthetic:synthetic@127.0.0.1/synthetic',tools:{
    diagnosticSink:async(body,summary)=>received.push({body:Buffer.from(body),summary}),
  }},{pgConnection:()=>client,toolVersion:async()=>17,dbInventory:async()=>({objects:[],buckets:[],roles:[],memberships:[]})});
  return {client,source,received};
}
function safeFailure(stage,category) {return error=>{
  assert.equal(error.stage,stage);assert.equal(error.category,category);
  assert.ok(!`${error.stack}${JSON.stringify(error)}`.includes('PRIVATE_PATIENT'));return true;
};}

test('failed source connect encrypts driver detail, keeps static category, and closes without rollback',async()=>{
  const f=fixture({connect:async()=>{throw Object.assign(Error(phi),{code:'ECONNRESET'});}});
  await assert.rejects(f.source.begin(),safeFailure('connect','connection_failed'));
  assert.equal(f.client.ended,1);assert.deepEqual(f.client.queries,[]);
  assert.ok(f.received[0].body.includes(phi));assert.ok(!JSON.stringify(f.received[0].summary).includes(phi));
});
test('snapshot permission failure preserves its precise safe stage and rolls back',async()=>{
  const f=fixture();const original=f.client.query;
  f.client.query=async function(sql){if(sql.includes('pg_export_snapshot'))throw Object.assign(Error(phi),{code:'42501'});return original.call(this,sql);};
  await assert.rejects(f.source.begin(),safeFailure('snapshot_export','permission_denied'));
  assert.ok(f.client.queries.includes('ROLLBACK'));assert.equal(f.client.ended,1);
});
test('idle source disconnect does not emit an uncaught provider error or publish a valid snapshot',async()=>{
  const f=fixture(),snapshot=await f.source.begin();
  f.client.emit('error',Object.assign(Error(phi),{code:'08006'}));
  await assert.rejects(snapshot.verifyUnchanged(),safeFailure('connection_idle','connection_failed'));
  await snapshot.close();assert.equal(f.client.ended,1);
});
test('verification connect failure also closes the second source client',async()=>{
  const first=fixture().client,second=fixture({connect:async()=>{throw Object.assign(Error(phi),{code:'28P01'});}}).client;
  let connections=0;
  const source=createPostgresSource({databaseUrl:'postgresql://synthetic@127.0.0.1/synthetic'}, {
    pgConnection:()=>connections++?second:first,toolVersion:async()=>17,dbInventory:async()=>({objects:[],buckets:[],roles:[],memberships:[]}),
  });
  const snapshot=await source.begin();
  await assert.rejects(snapshot.verifyUnchanged(),safeFailure('verify_connect','authentication_failed'));
  assert.equal(second.ended,1);await snapshot.close();
});
test('failed connect cleanup is bounded even when the driver never finishes ending',async()=>{
  let destroyed=0;
  const client={end:()=>new Promise(()=>{}),connection:{stream:{destroy(){destroyed++;}}}};
  const began=Date.now();await assert.rejects(closePgClient(client,{timeoutMs:20}),error=>error.category==='timeout');
  assert.equal(destroyed,1);assert.ok(Date.now()-began<1000);
});
test('hostile error fields and failing diagnostic sink never escape into public failure',async()=>{
  let buffer;
  const error=Object.assign(Error(phi.repeat(10000)),{category:phi,stage:phi,code:'42501'});
  const failure=await postgresDiagnosticFailure(error,{stage:phi,diagnosticSink:async body=>{buffer=body;assert.ok(body.length<65536);throw Error(phi);}});
  assert.equal(failure.category,'diagnostic_capture_failed');assert.equal(failure.stage,null);
  assert.ok(!JSON.stringify(failure).includes(phi));assert.ok(buffer.every(byte=>byte===0));
});

test('multibyte driver diagnostics stay bounded and hostile accessors are contained',async()=>{
 let count,summary;
 const error=Object.assign(Error('🔒'.repeat(30000)),{detail:'🔒'.repeat(30000),hint:'🔒'.repeat(30000)});
 Object.defineProperty(error,'category',{get(){throw Error(phi);}});
 const failure=await postgresDiagnosticFailure(error,{stage:'connect',diagnosticSink:async(body,meta)=>{count=body.length;summary=meta;}});
 assert.equal(count,65536);assert.equal(summary.truncated,true);assert.equal(failure.category,'tool_failure_or_warning');assert.equal(failure.stage,'connect');
});
