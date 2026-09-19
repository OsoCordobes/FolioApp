import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEnvelope } from '../../scripts/recovery/extract.mjs';
const envelope = { context: { operationId: 'test-id' }, ciphertext: 'synthetic' };
const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64');
const middle = Math.ceil(encoded.length / 2);
const events = [
  { text: `FOLIO_RECOVERY_V1 test-id 2/2 ${encoded.slice(middle)}` },
  { text: `FOLIO_RECOVERY_V1 test-id 1/2 ${encoded.slice(0, middle)}` },
];
test('out of order complete log reconstructs exact envelope', () => assert.deepEqual(extractEnvelope(events, 'test-id'), envelope));
test('missing or conflicting log chunks never produce a recovery file', () => {
  assert.throws(() => extractEnvelope(events.slice(1), 'test-id'), /Incomplete/);
  assert.throws(() => extractEnvelope([...events, { text: 'FOLIO_RECOVERY_V1 test-id 1/2 AAAA' }], 'test-id'), /inconsistent/);
  assert.throws(() => extractEnvelope(events, 'another-id'), /Incomplete/);
});
