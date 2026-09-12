import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { safeEnvironment } from './testing/isolation-policy.mjs';

const require = createRequire(import.meta.url);
const production = process.argv.includes('--production');
const config = { mode: production ? 'build' : 'app', appUrl: 'http://127.0.0.1:4410', supabaseUrl: 'http://127.0.0.1:54321' };
const env = {
  ...safeEnvironment(process.env, config),
  FOLIO_TEST_APP_CONFIG: JSON.stringify(config),
  NODE_OPTIONS: `--import=${new URL('./testing/app-bootstrap.mjs', import.meta.url).href}`,
};
const command = production ? ['start'] : ['dev', '--turbopack'];
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...command, '--hostname', '127.0.0.1', '--port', '4410'], { stdio: 'inherit', env });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
