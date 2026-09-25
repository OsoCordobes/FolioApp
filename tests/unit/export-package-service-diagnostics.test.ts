import assert from 'node:assert/strict'
import test from 'node:test'
import { safeServiceState } from '../../scripts/testing/export-package-proof/service-diagnostics.mjs'

test('service diagnostics emit only finite status, exit code and health', () => {
  const raw = {
    Status: 'exited', ExitCode: 43, Health: { Status: 'unhealthy', Log: [{ Output: 'secret-body' }] },
    Error: 'postgres://sensitive@host/path', PID: 1234,
  }
  assert.deepEqual(safeServiceState('minio-createbucket', raw), {
    service: 'minio-createbucket', status: 'exited', exitCode: 43, health: 'unhealthy',
  })
  assert.deepEqual(safeServiceState('storage', { Status: 'bad-secret', ExitCode: '500', Health: { Status: 'secret' } }), {
    service: 'storage', status: 'unknown', exitCode: null, health: 'none',
  })
  assert.equal(safeServiceState('secret-service', raw).service, 'unknown')
  assert.doesNotMatch(JSON.stringify(safeServiceState('db', raw)), /secret|postgres|host|path|Output/)
})
