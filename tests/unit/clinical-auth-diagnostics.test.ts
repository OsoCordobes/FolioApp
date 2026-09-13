import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicalAuthFailureMessage } from '../fixtures/clinical-auth-diagnostics';

const context = {
  expectedRole: 'OWNER', expectedUserId: 'synthetic-user-private',
  claims: { sub: 'synthetic-user-private', session_id: 'synthetic-session-private', aal: 'aal2', exp: 200 },
  elapsedMs: 12001.2, nowMs: 100000,
};
function diagnostic(error: unknown, patch: Partial<typeof context> | Record<string, unknown> = {}) {
  const message = clinicalAuthFailureMessage(error, { ...context, ...patch });
  assert.match(message, /^Local clinical fixture failed: browser Auth identity\. /);
  assert.doesNotMatch(message, /synthetic-user-private|synthetic-session-private|DO_NOT_PRINT/);
  return JSON.parse(message.slice(message.indexOf('{')));
}

test('Auth diagnostics distinguish provider rejection without serializing identity or session', () => {
  assert.deepEqual(diagnostic({ name: 'AuthApiError', code: 'session_not_found', status: 401 }), {
    expectedRole: 'OWNER', httpStatus: 401, errorClass: 'AuthApiError', errorCode: 'session_not_found',
    elapsedMs: 12001, subMatches: true, aal2: true, expired: false,
  });
  assert.deepEqual(diagnostic({ name: 'AuthRetryableFetchError', status: 503 }), {
    expectedRole: 'OWNER', httpStatus: 503, errorClass: 'AuthRetryableFetchError', errorCode: 'unknown',
    elapsedMs: 12001, subMatches: true, aal2: true, expired: false,
  });
});

test('Auth diagnostics never inspect or serialize provider messages, causes, tokens, or arbitrary fields', () => {
  const error = Object.assign(new Error('DO_NOT_PRINT password'), {
    name: 'DO_NOT_PRINT cookie', code: 'DO_NOT_PRINT access_token', status: 'DO_NOT_PRINT secret',
    cause: { token: 'DO_NOT_PRINT refresh_token' }, stack: 'DO_NOT_PRINT stack',
    response: { headers: { authorization: 'DO_NOT_PRINT Bearer' } },
    toJSON() { throw Error('DO_NOT_PRINT toJSON'); },
  });
  for (const key of ['message', 'cause', 'stack', 'response', 'originalError']) {
    Object.defineProperty(error, key, { get() { throw Error(`DO_NOT_PRINT ${key}`); } });
  }
  const result = diagnostic(error, { expectedRole: 'DO_NOT_PRINT role' });
  assert.equal(result.expectedRole, 'unknown');
  assert.equal(result.httpStatus, 'unknown');
  assert.equal(result.errorClass, 'unknown');
  assert.equal(result.errorCode, 'unknown');
  for (const malformed of [null, undefined, 'DO_NOT_PRINT error', ['DO_NOT_PRINT'], 401]) {
    const safe = diagnostic(malformed);
    assert.equal(safe.errorClass, 'unknown');
    assert.equal(safe.httpStatus, 'unknown');
  }
});

test('Auth diagnostics contain hostile getters and do not coerce malformed token fields', () => {
  const hostile = new Proxy({}, { get() { throw Error('DO_NOT_PRINT getter'); } });
  const deceptive = { toString() { throw Error('DO_NOT_PRINT coercion'); }, toJSON() { throw Error('DO_NOT_PRINT JSON'); } };
  for (const claims of [hostile, null, 'DO_NOT_PRINT token', { sub: deceptive, aal: deceptive, exp: deceptive }]) {
    const result = diagnostic(hostile, { claims, expectedUserId: deceptive });
    assert.equal(result.errorClass, 'unknown');
    assert.equal(result.errorCode, 'unknown');
    assert.equal(result.httpStatus, 'unknown');
    assert.equal(result.subMatches, false);
    assert.equal(result.aal2, false);
    assert.equal(result.expired, false);
  }
  assert.equal(diagnostic(null, { claims: { sub: '', aal: 'aal2', exp: '1' }, expectedUserId: '' }).subMatches, false);
  assert.equal(diagnostic(null, { claims: { sub: 'other-private-user', aal: 'aal1', exp: '1' } }).expired, false);
});

test('Auth diagnostics only admit bounded HTTP numbers and exact allowed classes and codes', () => {
  for (const status of [99, 600, 401.5, '401', NaN, Infinity, -Infinity, {}, null]) {
    assert.equal(diagnostic({ status }).httpStatus, 'unknown');
  }
  for (const status of [100, 401, 429, 500, 599]) assert.equal(diagnostic({ status }).httpStatus, status);
  for (const error of [{ name: 'AuthApiError DO_NOT_PRINT', code: 'bad_jwt DO_NOT_PRINT' }, { name: new String('AuthApiError'), code: ['bad_jwt'] }]) {
    assert.equal(diagnostic(error).errorClass, 'unknown');
    assert.equal(diagnostic(error).errorCode, 'unknown');
  }
  assert.equal(diagnostic({ name: 'TimeoutError', code: 'request_timeout' }).errorCode, 'request_timeout');
});

test('Auth diagnostics report expiration at the actual boundary and sanitize elapsed time and roles', () => {
  for (const expectedRole of ['OWNER', 'ASISTENTE', 'COORDINADOR']) assert.equal(diagnostic(null, { expectedRole }).expectedRole, expectedRole);
  for (const [exp, expired] of [[99, true], [100, true], [101, false], [NaN, false], [Infinity, false]] as const) {
    assert.equal(diagnostic(null, { claims: { ...context.claims, exp } }).expired, expired);
  }
  for (const elapsedMs of ['DO_NOT_PRINT duration', -1, NaN, Infinity, {}, null]) {
    assert.equal(diagnostic(null, { elapsedMs }).elapsedMs, 'unknown');
  }
  assert.equal(diagnostic(null, { elapsedMs: 0 }).elapsedMs, 0);
  assert.equal(diagnostic(null, { elapsedMs: 1.7 }).elapsedMs, 2);
});
