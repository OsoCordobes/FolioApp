import test from 'node:test';
import assert from 'node:assert/strict';
import {postgresFailureCategory,parseConnection} from '../../scripts/backup/postgres.mjs';

test('backup diagnostics never expose raw SQL, credentials, host or patient data',()=>{
  const phi='patient@example.invalid secret=credential diagnosis=sensitive';
  assert.equal(postgresFailureCategory(`permission denied for table ${phi}`),'permission_denied');
  assert.equal(postgresFailureCategory(`SSL error certificate ${phi}`),'tls_certificate');
  assert.equal(postgresFailureCategory(`password authentication failed ${phi}`),'authentication_failed');
  assert.equal(postgresFailureCategory(`snapshot unavailable ${phi}`),'snapshot_unavailable');
  assert.equal(postgresFailureCategory(phi),'tool_failure_or_warning');
});
test('a private certificate authority preserves required TLS verification on remote backups',()=>{
  const c=parseConnection('postgresql://synthetic:synthetic@source.example.invalid:5432/postgres',{
    allowRemoteSource:true,confirmSourceHost:'source.example.invalid',certificateAuthority:'synthetic certificate fixture',
  });
  assert.deepEqual(c.ssl,{rejectUnauthorized:true,ca:'synthetic certificate fixture'});
});
