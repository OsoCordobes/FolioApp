import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {safeRestoreDiagnostic,parseSafeRestoreDiagnostic,classifyPgRestoreStderr,parseSafePgRestoreDiagnostic} from '../../scripts/backup/restore-diagnostics.mjs';
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

test('restore launcher emits a fixed diagnostic when invoked without a config',()=>{
 const launcher=fileURLToPath(new URL('../../scripts/backup/restore-local.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[launcher],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'',FOLIO_BACKUP_RESTORE_DIAGNOSTICS:'c01'}});
 assert.equal(result.status,1);
 assert.match(result.stderr,/c01_restore_diagnostic/,result.stderr);
 assert.deepEqual(parseSafeRestoreDiagnostic(result.stderr),{phase:'unknown',category:'unknown',code:'unclassified'});
 assert.match(result.stderr,/restore_pending: database phase is transactional/);
});
