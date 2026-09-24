import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {safeRestoreDiagnostic,safeStorageRestoreCause,safeStorageInspectHttp,safeStorageInspectFromError,safeStorageInspectResponse,parseSafeStorageInspectHttp,parseSafeRestoreDiagnostic,classifyPgRestoreStderr,parseSafePgRestoreDiagnostic} from '../../scripts/backup/restore-diagnostics.mjs';
import {monitorPostgresChild} from '../../scripts/backup/postgres.mjs';

test('restore diagnostics retain only fixed guard and PostgreSQL categories',()=>{
 const cases=[
  [Object.assign(Error('restore_target_not_empty_loopback'),{}),{phase:'database',category:'target_guard',code:'restore_target_not_empty_loopback'}],
  [Object.assign(Error('backup_database_operation_failed'),{category:'tool_failure_or_warning'}),{phase:'database',category:'tool_failure_or_warning',code:'backup_database_operation_failed'}],
  [Object.assign(Error('secret value'),{code:'42501'}),{phase:'database',category:'sqlstate',code:'42501'}],
  [Object.assign(Error('secret value'),{code:'ECONNREFUSED'}),{phase:'database',category:'connection',code:'ECONNREFUSED'}],
 ];
 for(const [error,expected] of cases){
  const diagnostic=safeRestoreDiagnostic(error,'database');
  assert.deepEqual(diagnostic,expected);
  const line=`c01_restore_diagnostic phase=${diagnostic.phase} category=${diagnostic.category} code=${diagnostic.code}`;
  assert.deepEqual(parseSafeRestoreDiagnostic(line),expected);
  assert.equal(line.includes('secret value'),false);
 }
});

test('a real pg_restore process failure yields only a fixed phase and category',async()=>{
 const processChild=new EventEmitter();
 processChild.stderr=new EventEmitter();
 let pgRestoreCategory=null;
 const completion=monitorPostgresChild(processChild,{timeoutMs:1000,diagnosticSink:stderr=>{pgRestoreCategory=classifyPgRestoreStderr(stderr);}});
 const secret='private pg_restore detail and ciphertext';
 processChild.stderr.emit('data',Buffer.from(`permission denied: ${secret}`));
 processChild.emit('close',1);
 await assert.rejects(completion,error=>{
  const diagnostic=safeRestoreDiagnostic(error,'database');
  assert.deepEqual(diagnostic,{phase:'database',category:'permission_denied',code:'postgres_tool_failed_or_warned'});
  const line=`c01_restore_diagnostic phase=${diagnostic.phase} category=${diagnostic.category} code=${diagnostic.code}`;
  assert.deepEqual(parseSafeRestoreDiagnostic(line),diagnostic);
  assert.equal(line.includes(secret),false);
  assert.equal(pgRestoreCategory,'permission');
  return true;
 });
});

test('pg_restore stderr is reduced to fixed categories without public detail',()=>{
 const secret='postgresql://postgres:private@example.test/ciphertext';
 const cases=[
  [`ERROR: can only create extension in database postgres\nCommand was: CREATE EXTENSION pg_cron; ${secret}`,'pg_cron_database_mismatch'],
  [`ERROR: version 3.1.9 is not available ${secret}`,'extension_version'],
  [`ERROR: pg_cron can only be loaded via shared_preload_libraries ${secret}`,'extension_preload'],
  [`ERROR: extension pg_cron must be installed in schema pg_catalog ${secret}`,'extension_schema'],
  [`ERROR: permission denied for schema auth ${secret}`,'permission'],
  [`ERROR: role missing_user does not exist ${secret}`,'missing_role'],
  [`ERROR: unexplained failure ${secret}`,'other'],
 ];
 for(const [stderr,expected] of cases){
  const category=classifyPgRestoreStderr(Buffer.from(stderr));
  assert.equal(category,expected);
  const line=`c01_pg_restore_diagnostic category=${category}`;
  assert.equal(parseSafePgRestoreDiagnostic(line),expected);
  assert.equal(line.includes(secret),false);
 }
 assert.equal(parseSafePgRestoreDiagnostic(`c01_pg_restore_diagnostic category=${secret}`),null);
});

test('restore diagnostics never echo raw messages, unknown SQLSTATE, or forged tokens',()=>{
 const secret='postgresql://postgres:private@example.test/clinical-ciphertext';
 const unknown=safeRestoreDiagnostic(Object.assign(Error(secret),{code:'XX999'}),'database');
 assert.deepEqual(unknown,{phase:'database',category:'unknown',code:'unclassified'});
 assert.equal(JSON.stringify(unknown).includes(secret),false);
 assert.equal(parseSafeRestoreDiagnostic(`c01_restore_diagnostic phase=database category=sqlstate code=XX999`),null);
 assert.equal(parseSafeRestoreDiagnostic(`c01_restore_diagnostic phase=database category=unknown code=${secret}`),null);
 const hostile={get message(){throw Error(secret);},get code(){throw Error(secret);}};
 assert.deepEqual(safeRestoreDiagnostic(hostile,'database'),unknown);
});

test('Storage diagnostics accept only exact fixed errors in the Storage phase',()=>{
 const cases=[
  ['storage_restore_target_not_confirmed_loopback','target_guard'],
  ['storage_restore_inventory_bucket_configuration_mismatch','inventory'],
  ['storage_restore_download_failed','transfer'],
  ['storage_restore_foreign_bytes','conflict'],
  ['storage_restore_journal_mismatch','journal'],
 ];
 for(const [message,category] of cases){
  const code=message;
  const expected={phase:'storage',category,code};
  const diagnostic=safeRestoreDiagnostic(Error(message),'storage');
  assert.deepEqual(diagnostic,expected);
  const line=`c01_restore_diagnostic phase=storage category=${category} code=${code}`;
  assert.deepEqual(parseSafeRestoreDiagnostic(line),expected);
  assert.equal(parseSafeRestoreDiagnostic(line.replace('phase=storage','phase=database')),null);
  assert.deepEqual(safeRestoreDiagnostic(Error(message),'database'),{phase:'database',category:'unknown',code:'unclassified'});
 }
});

test('pending Storage restore keeps its message but publishes only a checked literal cause',()=>{
 const pending='storage_restore_pending: verified files preserved; resume the same package and target';
 const sensitive='patient/bucket/private-key HTTP body';
 const fixed=Object.assign(Error(pending),{c01StorageCauseCode:'storage_restore_upload_failed'});
 assert.deepEqual(safeRestoreDiagnostic(fixed,'storage'),{phase:'storage',category:'transfer',code:'storage_restore_upload_failed'});
 assert.equal(safeStorageRestoreCause(Object.assign(Error(sensitive),{cause:Error('storage_restore_download_failed')})),'unclassified');
 for(const hostile of [
  Object.assign(Error(pending),{c01StorageCauseCode:sensitive}),
  Object.assign(Error(pending),{c01StorageCauseCode:'storage_restore_upload_failed '+sensitive}),
  Object.assign(Error(pending),{cause:Error('storage_restore_upload_failed')}),
  Object.defineProperty(Error(pending),'c01StorageCauseCode',{get(){throw Error(sensitive);}}),
 ]){
  assert.deepEqual(safeRestoreDiagnostic(hostile,'storage'),{phase:'storage',category:'unknown',code:'unclassified'});
 }
 assert.deepEqual(safeRestoreDiagnostic(fixed,'database'),{phase:'database',category:'unknown',code:'unclassified'});
});

test('Storage diagnostic never publishes an arbitrary exception, path, bucket, or HTTP body',()=>{
 const sensitive='postgresql://private:secret@example.test/clinical/bucket patient HTTP body';
 for(const message of [sensitive,`storage_restore_pending: ${sensitive}`,`storage_restore_download_failed ${sensitive}`]){
  const diagnostic=safeRestoreDiagnostic(Object.assign(Error(message),{code:'HTTP_400'}),'storage');
  assert.deepEqual(diagnostic,{phase:'storage',category:'unknown',code:'unclassified'});
  const line=`c01_restore_diagnostic phase=${diagnostic.phase} category=${diagnostic.category} code=${diagnostic.code}`;
  assert.equal(line.includes(sensitive),false);
 }
 for(const line of [
  `c01_restore_diagnostic phase=storage category=transfer code=${sensitive}`,
  'c01_restore_diagnostic phase=storage category=transfer code=storage_restore_pending',
  'c01_restore_diagnostic phase=storage category=inventory code=storage_restore_download_failed',
 ])assert.equal(parseSafeRestoreDiagnostic(line),null);
});

test('Storage inspect HTTP diagnostic accepts only finite status and documented code tokens',()=>{
 const secret='secret bucket/path and response body';
 for(const [status,code] of [[400,'NoSuchKey'],[403,'AccessDenied'],[500,'InternalError']]){
  const expected={status:String(status),code};
  const detail=safeStorageInspectHttp(status,code);
  assert.deepEqual(detail,expected);
  const line=`c01_storage_inspect_http status=${detail.status} code=${detail.code}`;
  assert.deepEqual(parseSafeStorageInspectHttp(line),expected);
  assert.equal(line.includes(secret),false);
 }
 assert.deepEqual(safeStorageInspectHttp(599,secret),{status:'other',code:'other'});
 assert.deepEqual(safeStorageInspectFromError({c01StorageInspectHttp:{status:500,code:secret}}),{status:'500',code:'other'});
 assert.equal(safeStorageInspectFromError({get c01StorageInspectHttp(){throw Error(secret);}}),null);
 for(const line of [
  `c01_storage_inspect_http status=500 code=${secret}`,
  'c01_storage_inspect_http status=599 code=InternalError',
  'c01_storage_inspect_http status=500 code=ENOENT',
  'c01_storage_inspect_http status=200 code=NoSuchKey',
 ])assert.equal(parseSafeStorageInspectHttp(line),null);
});

test('Storage HTTP response handling extracts only bounded documented fields',async()=>{
 const secret='private object path, credential and full HTTP body';
 const missing=await safeStorageInspectResponse(new Response(JSON.stringify({statusCode:'404',code:'NoSuchKey',message:secret}),{status:400}));
 assert.deepEqual(missing,{status:'400',code:'NoSuchKey',missingStatusCode404:true});
 const serverError=await safeStorageInspectResponse(new Response(JSON.stringify({statusCode:'500',code:'InternalError',message:secret}),{status:500}));
 assert.deepEqual(serverError,{status:'500',code:'InternalError',missingStatusCode404:false});
 const oversized=await safeStorageInspectResponse(new Response(JSON.stringify({statusCode:'404',code:'NoSuchKey',message:secret.repeat(256)}),{status:400}));
 assert.deepEqual(oversized,{status:'400',code:'other',missingStatusCode404:false});
 assert.equal(JSON.stringify([missing,serverError,oversized]).includes(secret),false);
});

test('Storage launcher opt-in emits only a fixed diagnostic for an invalid loopback target',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'folio-c01-storage-diagnostic-'));
 try{
  const key=path.join(temporary,'recipient.key');
  const config=path.join(temporary,'restore.json');
  await writeFile(key,'synthetic-key');
  await writeFile(config,JSON.stringify({phase:'storage',recipientPrivateKeyFile:key,storageUrl:'https://example.test/',confirmStorageOrigin:'https://example.test/'}));
  const launcher=fileURLToPath(new URL('../../scripts/backup/restore-local.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[launcher,config],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'',FOLIO_BACKUP_RESTORE_DIAGNOSTICS:'c01'}});
  assert.equal(result.status,1);
  assert.deepEqual(parseSafeRestoreDiagnostic(result.stderr),{phase:'storage',category:'target_guard',code:'storage_restore_target_not_confirmed_loopback'});
  assert.equal(result.stderr.includes(temporary),false);
  assert.equal(result.stderr.includes('example.test'),false);
  assert.equal(result.stderr.includes('synthetic-key'),false);
 }finally{await rm(temporary,{recursive:true,force:true});}
});

test('restore launcher emits a fixed diagnostic when invoked without a config',()=>{
 const launcher=fileURLToPath(new URL('../../scripts/backup/restore-local.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[launcher],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'',FOLIO_BACKUP_RESTORE_DIAGNOSTICS:'c01'}});
 assert.equal(result.status,1);
 assert.match(result.stderr,/c01_restore_diagnostic/,result.stderr);
 assert.deepEqual(parseSafeRestoreDiagnostic(result.stderr),{phase:'unknown',category:'unknown',code:'unclassified'});
 assert.match(result.stderr,/restore_pending: database phase is transactional/);
});
