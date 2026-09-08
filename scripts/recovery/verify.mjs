import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractEnvelope } from './extract.mjs';
import { openEnvelope } from './envelope.mjs';
try {
  const [directory, mode, operationId, keyDirectory = directory] = process.argv.slice(2);
  if (!directory || !['canary', 'recover'].includes(mode) || !operationId) throw new Error();
  const events = JSON.parse(readFileSync(resolve(directory, `${mode}-events.json`), 'utf8').replace(/^\uFEFF/, ''));
  const envelope = extractEnvelope(events, operationId);
  const privateKey = readFileSync(resolve(keyDirectory, 'recipient-private.encrypted.pem'), 'utf8');
  const values = openEnvelope(envelope, privateKey, process.env.FOLIO_RECOVERY_PASSPHRASE, { operationId, projectId: 'prj_ZULHSw01qxl3yfJAqM1Zg4Q9pL0C', environment: 'production' });
  if (Buffer.from(values.FOLIO_ENC_KEY ?? '', 'base64').length !== 32 || Buffer.from(values.FOLIO_ENC_HMAC_KEY ?? '', 'base64').length !== 32) throw new Error();
  if (mode === 'canary' && (values.FOLIO_ENC_KEY !== Buffer.alloc(32, 17).toString('base64') || values.FOLIO_ENC_HMAC_KEY !== Buffer.alloc(32, 29).toString('base64'))) throw new Error();
  writeFileSync(resolve(directory, `${mode}-verified.envelope.json`), JSON.stringify(envelope, null, 2), { flag: 'wx', mode: 0o600 });
  const summary = { status: 'verified', mode, operationId, names: Object.keys(values), encryptionKeyBytes: 32, searchKeyBytes: 32 };
  writeFileSync(resolve(directory, `${mode}-verification.json`), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(summary));
  delete process.env.FOLIO_RECOVERY_PASSPHRASE;
} catch { console.error('Recovery verification failed; no secret values were printed.'); process.exitCode = 1; }
