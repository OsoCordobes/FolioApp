#!/usr/bin/env node
/**
 * Replay against a NEW, EMPTY local PostgreSQL 16 database.
 * LOCAL_SQL_TEST_URL=postgres://...@127.0.0.1:55439/folio_test_<name>
 * node scripts/testing/replay-local-sql.mjs [--security-red-green] [--through=M107]
 * Windows with psql installed in WSL: set LOCAL_SQL_TEST_WSL=Ubuntu.
 * Never loads .env.local, creates/drops databases, or connects remotely.
 * Supabase Auth/Storage here are CI stubs, not real service E2E coverage.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const value = process.env.LOCAL_SQL_TEST_URL;
if (!value) throw new Error('Set LOCAL_SQL_TEST_URL to a new, empty local test database.');
const url = new URL(value);
if (!['postgres:', 'postgresql:'].includes(url.protocol)
  || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  || !/^\/folio_test_[a-z0-9_]+$/.test(url.pathname)
  || url.search || url.hash || value.includes('grkpayhxndztlfwxobnt')) {
  throw new Error('Only loopback folio_test_<name> databases without URL options are allowed.');
}
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--security-red-green' && !/^--through=M[1-9][0-9]*$/.test(arg))) throw new Error('Unknown argument.');
if(args.filter(arg=>arg.startsWith('--through=')).length>1)throw new Error('Only one explicit migration bound is allowed.');
const through=args.find(arg=>arg.startsWith('--through='));
const maximum=through?Number(through.split('M')[1]):Infinity;
const withinBound=filename=>{const match=filename.match(/(?:^|_)M(\d+)(?:_|\.|$)/);return !match||Number(match[1])<=maximum;};
if(through)console.log(`Explicit replay bound: through M${maximum}; later migrations and numbered specs excluded.`);
const redGreen = args.includes('--security-red-green');

async function connect() {
  // Explicit fields prevent ambient PGHOST/PGSERVICE settings redirecting tests.
  const client = new pg.Client({
    host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
    database: url.pathname.slice(1), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), ssl: false,
    connectionTimeoutMillis: 5000, statement_timeout: 120000,
    application_name: 'folio-local-sql-replay',
  });
  await client.connect();
  return client;
}
const initial = await connect();
try {
  const { rows: [state] } = await initial.query(`SELECT
    current_setting('server_version_num')::int AS version,
    host(inet_server_addr()) AS address,
    ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%')
    + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
    + (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema')
      AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'))::int AS objects`);
  if (state.version < 160000 || state.version >= 170000) throw new Error('PostgreSQL 16 is required.');
  if (!['127.0.0.1', '::1'].includes(state.address)) throw new Error('Server is not listening on loopback.');
  if (state.objects !== 0) throw new Error('Refusing to modify a nonempty database. Create a fresh test database.');
  console.log(`PostgreSQL ${state.version}; isolated database ${url.pathname.slice(1)}; fresh session per migration.`);
} finally { await initial.end(); }

async function runFile(relative) {
  const client = await connect();
  try {
    const { rows: [setting] } = await client.query('SHOW check_function_bodies');
    if (setting.check_function_bodies !== 'on') throw new Error('Server default check_function_bodies must be on.');
  } finally { await client.end(); }
  // psql preserves each statement's transaction boundary. Sending an entire
  // file as one pg query silently creates an implicit transaction and breaks
  // tests of transaction-local GUC reset (notably M91).
  const psqlArgs = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-w',
    '--host', url.hostname.replace(/^\[|\]$/g, ''),
    '--port', url.port || '5432', '--username', decodeURIComponent(url.username),
    '--dbname', url.pathname.slice(1)];
  const distro = process.env.LOCAL_SQL_TEST_WSL;
  const result = spawnSync(distro ? 'wsl.exe' : 'psql',
    distro ? ['--distribution', distro, '--exec', 'psql', ...psqlArgs] : psqlArgs, {
      input: await readFile(path.join(root, relative), 'utf8'), encoding: 'utf8',
      timeout: 180000, maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password),
        PGOPTIONS: '-c statement_timeout=120000',
        WSLENV: [process.env.WSLENV, 'PGPASSWORD', 'PGOPTIONS'].filter(Boolean).join(':') },
    });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${relative}: ${result.stderr || result.stdout}`);
}

await runFile('scripts/testing/supabase-stubs.sql');
const migrations = (await readdir(path.join(root, 'supabase/migrations'))).filter(f => f.endsWith('.sql')&&withinBound(f)).sort();
let redVerified = false;
for (const filename of migrations) {
  if (redGreen && filename.includes('_M98_')) {
    try { await runFile('tests/sql/M98_security_boundaries.spec.sql'); }
    catch (error) {
      if (!error.message.includes('M98 FAIL: OWNER can exempt their own subscription')) throw error;
      console.log('RED verified: OWNER can exempt their own subscription before M98.');
      redVerified = true;
    }
    if (!redVerified) throw new Error('Expected M98 security regression did not fail on the baseline.');
  }
  try { await runFile(`supabase/migrations/${filename}`); }
  catch (error) { console.error(`Migration failed: ${filename}`); throw error; }
  console.log(`Applied ${filename}`);
  if (redGreen && filename.includes('_M98_')) {
    await runFile('tests/sql/M98_security_boundaries.spec.sql');
    console.log('GREEN verified: all M98 security boundaries pass.');
  }
}
if (redGreen && !redVerified) throw new Error('M98 migration not found.');
const specs = (await readdir(path.join(root, 'tests/sql'))).filter(f => f.endsWith('.spec.sql')&&withinBound(f)).sort();
for (const filename of specs) {
  try { await runFile(`tests/sql/${filename}`); }
  catch (error) { console.error(`Spec failed: ${filename}`); throw error; }
  console.log(`PASS ${filename}`);
}
console.log(`PASS: ${migrations.length} migrations with default checks; ${specs.length} SQL specs.`);
