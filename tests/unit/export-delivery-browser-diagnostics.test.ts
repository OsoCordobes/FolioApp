import assert from 'node:assert/strict'
import test from 'node:test'
import {
  browserFailureDiagnostic,
  rethrowWithBrowserDiagnostic,
} from '../../scripts/testing/export-delivery-proof/prove-browser.mjs'

test('browser diagnostic emits only finite fields and discards session/error contents', () => {
  const secret = 'CANARY https://private.test/?token=secret patient=user-id body=clinical'
  const error = Object.assign(new Error(secret), {
    name: secret, stack: secret, url: secret, token: secret, body: secret, identity: secret,
  })
  const diagnostic = browserFailureDiagnostic(secret, error, secret)
  assert.deepEqual(diagnostic, {
    schemaVersion: 1, stage: 'unknown', errorKind: 'unknown', assertCode: null,
    navigationStatus: null,
  })
  assert.doesNotMatch(JSON.stringify(diagnostic), /CANARY|private|token|patient|clinical|user-id/)
})

test('browser diagnostic identifies the fixed timeout stage without its raw details', () => {
  const error = Object.assign(new Error('CANARY selector and browser URL'), { name: 'TimeoutError' })
  assert.deepEqual(browserFailureDiagnostic('save_confirmation', error, 200), {
    schemaVersion: 1, stage: 'save_confirmation', errorKind: 'TimeoutError',
    assertCode: null, navigationStatus: 200,
  })
})

test('browser diagnostic permits the assertion code but discards actual and expected values', () => {
  let error: unknown
  try { assert.equal('CANARY-actual', 'CANARY-expected', 'browser_archive_name') }
  catch (caught) { error = caught }
  const diagnostic = browserFailureDiagnostic('opfs_assertions', error, 200)
  assert.equal(diagnostic.assertCode, 'browser_archive_name')
  assert.equal(diagnostic.errorKind, 'AssertionError')
  assert.doesNotMatch(JSON.stringify(diagnostic), /CANARY|actual|expected|stack|message/)
  const unknown = Object.assign(new Error('browser_archive_name CANARY'), {
    name: 'AssertionError', code: 'ERR_ASSERTION',
  })
  assert.equal(browserFailureDiagnostic('opfs_assertions', unknown, 200).assertCode, null)
  assert.equal(browserFailureDiagnostic('opfs_assertions', new Error('browser_archive_name'), 200).assertCode, null)
})

test('browser diagnostic rejects non-allowlisted statuses and handles hostile error getters', () => {
  const hostile = Object.defineProperties({}, {
    name: { get() { throw new Error('CANARY') } },
    message: { get() { throw new Error('CANARY') } },
    stack: { get() { throw new Error('stack must never be accessed') } },
  })
  for (const status of ['200', 201, 999, NaN, Infinity, { status: 500 }]) {
    assert.deepEqual(browserFailureDiagnostic('opfs_read', hostile, status), {
      schemaVersion: 1, stage: 'opfs_read', errorKind: 'unknown', assertCode: null,
      navigationStatus: null,
    })
  }
  assert.equal(browserFailureDiagnostic('archive_navigation', new Error(), 503).navigationStatus, 503)
})

test('browser diagnostic rethrows the identical failure after writing a sanitized receipt', async () => {
  const original = new Error('CANARY original browser failure')
  let receipt: unknown
  await assert.rejects(
    rethrowWithBrowserDiagnostic(original, 'save_click', 200, async (diagnostic: unknown) => { receipt = diagnostic }),
    error => error === original,
  )
  assert.deepEqual(receipt, {
    schemaVersion: 1, stage: 'save_click', errorKind: 'Error', assertCode: null,
    navigationStatus: 200,
  })
})

test('diagnostic write failure cannot replace the original thrown value', async () => {
  for (const original of [new Error('original'), undefined, null, 'original string']) {
    try {
      await rethrowWithBrowserDiagnostic(original, 'launch', undefined, async () => {
        throw new Error('CANARY diagnostic filesystem failure')
      })
      assert.fail('expected original failure')
    } catch (error) { assert.equal(error, original) }
  }
})
