// Explicit owner verification, separate from automated tests and application code.
// Credentials stay in memory. Only connection metadata / counts are printed.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openEnvelope } from './envelope.mjs';

const PROJECT = 'grkpayhxndztlfwxobnt';
let stage = 'open_configuration';
try {
  const [directory, command] = process.argv.slice(2);
  if (!directory || !['check-redirects', 'probe-backup-source', 'check-encryption-format', 'scan-working-files'].includes(command)) throw new Error();
  const values = openEnvelope(
    JSON.parse(await readFile(resolve(directory, 'config-recovery/recover-verified.envelope.json'), 'utf8')),
    await readFile(resolve(directory, 'recipient-private.encrypted.pem'), 'utf8'),
    process.env.FOLIO_RECOVERY_PASSPHRASE,
    { operationId: 'folio-config-recover-20260908-1', projectId: 'prj_ZULHSw01qxl3yfJAqM1Zg4Q9pL0C', environment: 'production' },
  );
  delete process.env.FOLIO_RECOVERY_PASSPHRASE;
  if (command === 'scan-working-files') {
    stage = 'scan_versionable_working_files';
    const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
    const names = ['FOLIO_ENC_KEY','FOLIO_ENC_HMAC_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_JWT_SECRET','POSTGRES_PASSWORD','GOOGLE_OAUTH_CLIENT_SECRET','MP_ACCESS_TOKEN','MP_WEBHOOK_SECRET','CRON_SECRET','UPSTASH_REDIS_REST_TOKEN','SENTRY_AUTH_TOKEN','TURNSTILE_SECRET_KEY'];
    const secrets = names.filter(name => typeof values[name] === 'string' && values[name].trim().length >= 16);
    const files = [...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024}).split('\0').filter(Boolean))];
    const findings=[];
    let scanned=0;
    for (const file of files) {
      const absolute=resolve(root,file);
      if (!absolute.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error();
      let content;
      try { content=await readFile(absolute); } catch (error) { if(error.code==='ENOENT') continue; throw error; }
      scanned++;
      for (const name of secrets) if(content.includes(Buffer.from(values[name].trim()))) findings.push({file,variable:name});
    }
    console.log(JSON.stringify({scanned,secretNamesChecked:secrets.length,findings,writes:0,scope:'tracked-and-unignored-working-files-not-git-history'}));
    if(findings.length) process.exitCode=1;
  } else if (command === 'check-encryption-format') {
    stage = 'check_encryption_format';
    const { encryptionConfigurationStatus } = await import('../../lib/security/encryption-configuration.ts');
    const status = encryptionConfigurationStatus(values);
    console.log(JSON.stringify({ ...status, writes: 0 }));
    if (!status.ok) process.exitCode = 1;
  } else if (command === 'check-redirects') {
    stage = 'check_redirects';
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${PROJECT}.supabase.co`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = values.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.APP_URL = 'https://foliosalud.com';
    await import('../check-auth-redirect.mjs');
  } else {
    stage = 'validate_source';
    const url = new URL(values.POSTGRES_URL_NON_POOLING);
    if (!(url.hostname === `db.${PROJECT}.supabase.co` ||
        (url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username) === `postgres.${PROJECT}`)) ||
        (url.port && url.port !== '5432') || url.pathname !== '/postgres') throw new Error();
    const client = new pg.Client({
      host: url.hostname, port: Number(url.port || 5432), database: 'postgres',
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: true, ca: await readFile(resolve(directory, 'supabase-prod-ca-2021.crt'), 'utf8') }, connectionTimeoutMillis: 10000, statement_timeout: 10000,
      application_name: 'folio-owner-backup-probe',
    });
    try {
      stage = 'connect_verified_tls';
      await client.connect();
      stage = 'read_metadata';
      await client.query('BEGIN READ ONLY');
      const {rows:[metadata]} = await client.query("select current_setting('server_version') as version, pg_database_size(current_database()) as bytes");
      await client.query('ROLLBACK');
      console.log(JSON.stringify({status:'verified',host:url.hostname,port:Number(url.port||5432),...metadata,writes:0}));
    } finally { await client.end().catch(()=>undefined); }
  }
} catch (error) {
  const safeCodes = new Set(['ENOTFOUND','ENETUNREACH','ETIMEDOUT','ECONNREFUSED','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','28P01','42501']);
  console.error(JSON.stringify({status:'verification_incomplete',stage,code:safeCodes.has(error?.code)?error.code:'unclassified',writes:0}));
  process.exitCode=1;
}
