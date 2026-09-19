// Explicit read-only owner recovery probe. Never used by tests or application.
// Reads at most five ciphertext rows and reports counts, never identifiers/PHI.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDecipheriv, createHmac } from 'node:crypto';
import { openEnvelope } from './envelope.mjs';

let stage = 'open_envelope';
let decryptedFields = 0;
let checkedIndexes = 0;
let authenticationFailures = 0;
let indexMismatches = 0;
let legacyEncodedFields = 0;
try {
  const directory = process.argv[2];
  if (!directory || process.argv[3] !== '--verify-owner-recovery-read-only') throw new Error();
  const values = openEnvelope(
    JSON.parse(readFileSync(resolve(directory, 'recover-verified.envelope.json'), 'utf8')),
    readFileSync(resolve(directory, 'recipient-private.encrypted.pem'), 'utf8'),
    process.env.FOLIO_RECOVERY_PASSPHRASE,
    { operationId: 'folio-recover-20260908-1', projectId: 'prj_ZULHSw01qxl3yfJAqM1Zg4Q9pL0C', environment: 'production' },
  );
  stage = 'read_ciphertext';
  const response = await fetch('https://grkpayhxndztlfwxobnt.supabase.co/rest/v1/paciente_identidad?select=organization_id,nombre_cifrado,nombre_hash,apellido_cifrado&nombre_cifrado=not.is.null&deleted_at=is.null&limit=5', {
    headers: { apikey: values.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${values.SUPABASE_SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) { stage = `read_http_${response.status}`; throw new Error(); }
  const rows = await response.json();
  for (const row of rows) {
    const decrypted = {};
    for (const field of ['nombre_cifrado', 'apellido_cifrado']) {
      if (!row[field]) continue;
      let wire = Buffer.from(row[field].slice(2), 'hex');
      // Historical JSON Buffer storage is diagnosed, never rewritten here.
      if (wire[0] === 123) {
        try {
          const legacy = JSON.parse(wire.toString('utf8'));
          if (legacy.type === 'Buffer' && Array.isArray(legacy.data) && legacy.data.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
            wire = Buffer.from(legacy.data);
            legacyEncodedFields++;
          }
        } catch { /* Not a legacy Buffer: authenticate the original bytes. */ }
      }
      if (wire.length < 28) continue; // explicit pseudonymization tombstone
      stage = 'authenticate_ciphertext';
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(values.FOLIO_ENC_KEY, 'base64'), wire.subarray(0, 12));
      decipher.setAuthTag(wire.subarray(12, 28));
      let plaintext;
      try { plaintext = Buffer.concat([decipher.update(wire.subarray(28)), decipher.final()]); }
      catch { authenticationFailures++; continue; }
      decryptedFields++;
      decrypted[field] = plaintext.toString('utf8');
      plaintext.fill(0);
    }
    if (decrypted.nombre_cifrado && decrypted.apellido_cifrado && row.nombre_hash) {
      stage = 'verify_search_index';
      const normalized = `${decrypted.nombre_cifrado} ${decrypted.apellido_cifrado}`.trim().toLowerCase();
      const candidates = [normalized, `${row.organization_id}:${normalized}`].map(input => createHmac('sha256', Buffer.from(values.FOLIO_ENC_HMAC_KEY, 'base64')).update(input, 'utf8').digest('hex'));
      if (candidates.includes(String(row.nombre_hash).replace(/^\\x/, ''))) checkedIndexes++;
      else indexMismatches++;
    }
  }
  stage = 'require_existing_evidence';
  if (decryptedFields === 0 || checkedIndexes === 0) throw new Error();
  const summary = { status: authenticationFailures || indexMismatches || legacyEncodedFields ? 'keys_verified_data_review_required' : 'verified_existing_ciphertext', rowsRead: rows.length, decryptedFields, checkedIndexes, authenticationFailures, indexMismatches, legacyEncodedFields, writes: 0, checkedAt: new Date().toISOString() };
  writeFileSync(resolve(directory, 'existing-ciphertext-verification.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(summary));
  delete process.env.FOLIO_RECOVERY_PASSPHRASE;
} catch { console.error(JSON.stringify({ status: 'verification_incomplete', stage, decryptedFields, checkedIndexes, writes: 0 })); process.exitCode = 1; }
