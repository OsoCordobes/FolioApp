import { constants, createCipheriv, createDecipheriv, createHash, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';

// Application credentials only. Platform login/OIDC tokens are deliberately absent.
export const SECRET_NAMES = Object.freeze([
  'FOLIO_ENC_KEY', 'FOLIO_ENC_HMAC_KEY', 'FOLIO_ENC_KEY_NEXT', 'FOLIO_ENC_HMAC_KEY_NEXT',
  'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'DATABASE_URL_POOLED',
  'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL',
  'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'RESEND_API_KEY', 'TURNSTILE_SECRET_KEY', 'CRON_SECRET',
  'UPSTASH_REDIS_REST_TOKEN', 'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET',
  // Explicit reconstruction inventory, including managed integration aliases.
  'POSTGRES_USER', 'POSTGRES_HOST', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE',
  'SUPABASE_JWT_SECRET', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'UPSTASH_REDIS_REST_URL', 'KV_URL', 'KV_REST_API_READ_ONLY_TOKEN', 'REDIS_URL',
  'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'NEXT_PUBLIC_APP_URL', 'ALLOW_DEMO_SEED',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'SENTRY_PROJECT', 'SENTRY_ORG',
  'SENTRY_AUTH_TOKEN', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN',
  'GOOGLE_OAUTH_REDIRECT_URI', 'GOOGLE_OAUTH_CLIENT_ID',
  'NEXT_PUBLIC_MP_PLAN_PRICE_ARS', 'MP_PUBLIC_KEY',
]);

export function collectSecrets(environment) {
  const values = {};
  const missing = [];
  for (const name of SECRET_NAMES) {
    const value = environment[name];
    if (typeof value === 'string' && value.trim().length > 0) values[name] = value;
    else missing.push(name);
  }
  return { values, missing };
}

function validateValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid secret collection');
  for (const [name, value] of Object.entries(values)) {
    if (!SECRET_NAMES.includes(name)) throw new Error('Unsupported secret name');
    if (typeof value !== 'string' || value.length > 65536) throw new Error('Invalid secret value');
  }
}

function normalizeContext(context) {
  const normalized = {};
  for (const name of ['operationId', 'projectId', 'environment']) {
    if (typeof context?.[name] !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(context[name])) throw new Error('Invalid recovery context');
    normalized[name] = context[name];
  }
  return normalized;
}

function aad(envelope) {
  return Buffer.from(JSON.stringify({ version: envelope.version, algorithm: envelope.algorithm, recipient: envelope.recipient, context: normalizeContext(envelope.context) }));
}

export function sealSecrets(values, publicKeyPem, context) {
  validateValues(values);
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) throw new Error('Recovery requires RSA >=3072');
  const envelope = {
    version: 1,
    algorithm: 'RSA-OAEP-SHA256+A256GCM',
    recipient: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex'),
    context: normalizeContext(context),
  };
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(values));
  try {
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(aad(envelope));
    return { ...envelope,
      wrappedKey: publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dataKey).toString('base64'),
      iv: iv.toString('base64'),
      ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  } finally { dataKey.fill(0); plaintext.fill(0); }
}

export function openEnvelope(envelope, privateKeyPem, passphrase, expectedContext) {
  let dataKey;
  let plaintext;
  try {
    if (envelope?.version !== 1 || envelope.algorithm !== 'RSA-OAEP-SHA256+A256GCM') throw new Error();
    const context = normalizeContext(envelope.context);
    if (expectedContext && JSON.stringify(context) !== JSON.stringify(normalizeContext(expectedContext))) throw new Error();
    if (typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 2000000) throw new Error();
    const key = { key: privateKeyPem, passphrase, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };
    dataKey = privateDecrypt(key, Buffer.from(envelope.wrappedKey, 'base64'));
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (dataKey.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
    decipher.setAAD(aad(envelope));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    const values = JSON.parse(plaintext.toString('utf8'));
    validateValues(values);
    return values;
  } catch { throw new Error('Recovery verification failed'); }
  finally { dataKey?.fill(0); plaintext?.fill(0); }
}
