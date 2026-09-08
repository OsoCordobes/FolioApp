import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { collectSecrets, sealSecrets, openEnvelope } from '../../scripts/recovery/envelope.mjs';

const passphrase = 'synthetic-passphrase-only-for-tests';
const keys = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
});
const context = { operationId: 'synthetic-test-1', projectId: 'synthetic-project', environment: 'production' };
const secrets = { FOLIO_ENC_KEY: Buffer.alloc(32, 17).toString('base64'), FOLIO_ENC_HMAC_KEY: Buffer.alloc(32, 29).toString('base64') };

test('round trip retains original encryption and search keys using encrypted private key', () => {
  const envelope = sealSecrets(secrets, keys.publicKey, context);
  assert.deepEqual(openEnvelope(envelope, keys.privateKey, passphrase, context), secrets);
  const wire = JSON.stringify(envelope);
  assert.equal(wire.includes(secrets.FOLIO_ENC_KEY), false);
  assert.equal(wire.includes(secrets.FOLIO_ENC_HMAC_KEY), false);
});

test('collection excludes platform credentials and reports missing application secrets without exposing values', () => {
  const actual = collectSecrets({ ...secrets, VERCEL_TOKEN: 'platform-token-must-not-export', HOME: 'private-path', MP_ACCESS_TOKEN: 'synthetic-merchant-token' });
  assert.deepEqual(actual.values, { ...secrets, MP_ACCESS_TOKEN: 'synthetic-merchant-token' });
  assert.equal(actual.missing.includes('SUPABASE_SERVICE_ROLE_KEY'), true);
  assert.equal(JSON.stringify(actual.missing).includes('synthetic-merchant-token'), false);
});

test('ciphertext tampering fails authentication and does not return a partial secret', () => {
  const envelope = sealSecrets(secrets, keys.publicKey, context);
  const damaged = structuredClone(envelope);
  const bytes = Buffer.from(damaged.ciphertext, 'base64');
  bytes[0] ^= 1;
  damaged.ciphertext = bytes.toString('base64');
  assert.throws(() => openEnvelope(damaged, keys.privateKey, passphrase, context), /Recovery verification failed/);
});

test('wrong password, context substitution and unsupported version are rejected', () => {
  const envelope = sealSecrets(secrets, keys.publicKey, context);
  assert.throws(() => openEnvelope(envelope, keys.privateKey, 'wrong', context), /Recovery verification failed/);
  assert.throws(() => openEnvelope(envelope, keys.privateKey, passphrase, { ...context, projectId: 'another-project' }), /Recovery verification failed/);
  assert.throws(() => openEnvelope({ ...envelope, context: { ...context, operationId: 'another-operation' } }, keys.privateKey, passphrase), /Recovery verification failed/);
  assert.throws(() => openEnvelope({ ...envelope, version: 2 }, keys.privateKey, passphrase), /Recovery verification failed/);
});

test('nonallowlisted material cannot accidentally be sealed', () => {
  assert.throws(() => sealSecrets({ ...secrets, VERCEL_TOKEN: 'never' }, keys.publicKey, context), /Unsupported secret name/);
});

test('reconstruction includes Auth signing credentials and app provider configuration', () => {
  const configuration = {
    ...secrets, SUPABASE_JWT_SECRET: 'synthetic-signing-key',
    SUPABASE_SECRET_KEY: 'synthetic-service-key', SENTRY_AUTH_TOKEN: 'synthetic-project-upload-token',
    POSTGRES_PASSWORD: 'synthetic-db-password', NEXT_PUBLIC_APP_URL: 'https://example.test',
    GOOGLE_OAUTH_REDIRECT_URI: 'https://example.test/api/google/callback',
  };
  assert.deepEqual(collectSecrets(configuration).values, configuration);
  assert.deepEqual(openEnvelope(sealSecrets(configuration, keys.publicKey, context), keys.privateKey, passphrase, context), configuration);
});
