import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = process.argv[2];
const passphrase = process.env.FOLIO_RECOVERY_PASSPHRASE;
if (!destination || !passphrase || passphrase.length < 24) {
  console.error('Recovery destination and protected passphrase are required.');
  process.exit(1);
}
const dir = resolve(destination);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const keys = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
});
// Never overwrite an earlier recovery identity.
writeFileSync(resolve(dir, 'recipient-public.pem'), keys.publicKey, { flag: 'wx', mode: 0o600 });
writeFileSync(resolve(dir, 'recipient-private.encrypted.pem'), keys.privateKey, { flag: 'wx', mode: 0o600 });
delete process.env.FOLIO_RECOVERY_PASSPHRASE;
console.log(JSON.stringify({ status: 'created', privateKeyEncrypted: true, destination: dir }));
