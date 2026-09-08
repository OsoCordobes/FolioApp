// Copy only this file, envelope.mjs, a PUBLIC recipient key and a short-lived
// manifest into an isolated Vercel deployment. Never deploy the private key.
import { readFileSync } from 'node:fs';
import { collectSecrets, sealSecrets } from './envelope.mjs';

try {
  const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  const expires = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(expires) || Date.now() > expires || expires - Date.now() > 3600000) throw new Error();
  if (!['canary', 'recover'].includes(manifest.mode) || manifest.environment !== 'production') throw new Error();
  if (process.env.VERCEL_ENV !== 'production') throw new Error();
  if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== manifest.projectId) throw new Error();
  const publicKey = readFileSync(new URL('./recipient-public.pem', import.meta.url), 'utf8');
  const { values, missing } = manifest.mode === 'canary'
    ? { values: { FOLIO_ENC_KEY: Buffer.alloc(32, 17).toString('base64'), FOLIO_ENC_HMAC_KEY: Buffer.alloc(32, 29).toString('base64') }, missing: [] }
    : collectSecrets(process.env);
  if (!values.FOLIO_ENC_KEY || !values.FOLIO_ENC_HMAC_KEY) throw new Error();
  const envelope = sealSecrets(values, publicKey, manifest);
  // Chunk ciphertext to avoid log line truncation. No original value is logged.
  const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64');
  const chunks = encoded.match(/.{1,1000}/g);
  for (let i = 0; i < chunks.length; i++) {
    await new Promise((resolve, reject) => process.stdout.write(`FOLIO_RECOVERY_V1 ${manifest.operationId} ${i + 1}/${chunks.length} ${chunks[i]}\n`, error => error ? reject(error) : resolve()));
  }
  await new Promise(resolve => process.stdout.write(JSON.stringify({ recoveryStatus: 'sealed', mode: manifest.mode, names: Object.keys(values), missing }) + '\n', resolve));
} catch {
  // Sanitized failure: crypto/library/ENV exceptions must never reach build logs.
  await new Promise(resolve => process.stderr.write('FOLIO_RECOVERY: safe failure; no deployment will be published.\n', resolve));
}
// Intentional failure prevents a READY deployment even if domain promotion were
// accidentally enabled. --skip-domain is an independent, mandatory safeguard.
process.exitCode = 42;
