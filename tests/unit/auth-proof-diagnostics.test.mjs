import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dockerFailureKind} from '../../scripts/testing/auth-proof/diagnostics.mjs';

test('Docker proof failures expose a bounded cause without raw output',()=>{
 assert.equal(dockerFailureKind('toomanyrequests: rate limit exceeded'), 'registry_rate_limit');
 assert.equal(dockerFailureKind('dependency failed to start: container db is unhealthy'), 'unhealthy');
 assert.equal(dockerFailureKind('Cannot connect to the Docker daemon'), 'daemon_unavailable');
 assert.equal(dockerFailureKind('Client.Timeout exceeded while awaiting headers'), 'network');
 assert.equal(dockerFailureKind('service failed, password=private-value'), 'unknown');
});
