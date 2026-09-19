#!/usr/bin/env node
// Stages a NEW local Supabase 17 target. It never starts Docker or reads env files.
import { readFile, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOutsideRepository } from '../backup/paths.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const C01_TARGET = 'C:\\Users\\amiun\\Documents\\Codex\\folio-c01-recovery-synthetic';
export const C01_PORTS = Object.freeze({app:4432,api:55421,db:55422,studio:55423,inbucket:55424,analytics:55427,pooler:55429,inspector:55483});

function replaceValue(lines, section, key, value) {
  let active = '';
  let count = 0;
  const result = lines.map(line => {
    const header = line.match(/^\[([^\]]+)\]\s*$/);
    if (header) active = header[1];
    if (active !== section || !new RegExp(`^${key}\\s*=`).test(line)) return line;
    count++;
    return `${key} = ${value}`;
  });
  if (count !== 1) throw new Error('c01_source_config_changed');
  return result;
}

export function syntheticTargetConfig(source) {
  if (!/^major_version\s*=\s*17\s*$/m.test(source)) throw new Error('c01_requires_postgres_17');
  let section = '';
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1]; continue; }
    if (/\benv\s*\(/.test(line) ||
        (/^(auth\.external\.|auth\.sms\.|auth\.third_party\.|auth\.web3\.)/.test(section) && /^enabled\s*=\s*true\s*$/.test(line)))
      throw new Error('c01_external_configuration_present');
  }
  let lines = source.replace(/\r\n/g, '\n').split('\n');
  const changes = [
    ['', 'project_id', '"folio-c01-recovery"'],
    ['api', 'port', C01_PORTS.api],
    ['db', 'port', C01_PORTS.db],
    ['db.pooler', 'port', C01_PORTS.pooler],
    ['studio', 'port', C01_PORTS.studio],
    ['inbucket', 'port', C01_PORTS.inbucket],
    ['analytics', 'port', C01_PORTS.analytics],
    ['edge_runtime', 'inspector_port', C01_PORTS.inspector],
    ['auth', 'site_url', `"http://127.0.0.1:${C01_PORTS.app}"`],
    ['auth', 'additional_redirect_urls', `["http://127.0.0.1:${C01_PORTS.app}/api/auth/callback", "http://127.0.0.1:${C01_PORTS.app}/reset-password"]`],
    // The initial target is platform-only. No application migrations, seeds,
    // outbound cron jobs or third-party provider configuration are copied.
    ['db.migrations', 'enabled', 'false'],
    ['db.seed', 'enabled', 'false'],
    ['realtime', 'enabled', 'false'],
    ['edge_runtime', 'enabled', 'false'],
    ['analytics', 'enabled', 'false'],
  ];
  for (const [section, key, value] of changes) lines = replaceValue(lines, section, key, value);
  return lines.join('\n');
}

export async function stageSyntheticTarget(destination, sourceConfig, {repo = repository} = {}) {
  if (!path.isAbsolute(destination) || path.basename(destination) !== 'folio-c01-recovery-synthetic')
    throw new Error('c01_target_path_invalid');
  const parent = path.dirname(destination);
  const parentState = await lstat(parent);
  if (!parentState.isDirectory() || parentState.isSymbolicLink()) throw new Error('c01_target_parent_invalid');
  await resolveOutsideRepository(await realpath(parent), repo);
  try { await lstat(destination); throw new Error('c01_target_already_exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = syntheticTargetConfig(sourceConfig);
  await mkdir(path.join(destination, 'supabase'), {recursive:true, mode:0o700});
  await writeFile(path.join(destination, 'supabase', 'config.toml'), config, {flag:'wx', mode:0o600});
  await writeFile(path.join(destination, 'c01-target-plan.json'), JSON.stringify({
    version:1, purpose:'synthetic-recovery-only', projectId:'folio-c01-recovery',
    postgresMajor:17, ports:C01_PORTS, migrations:false, seeds:false,
    externalProviders:false, started:false, dataRestored:false,
    warning:'Supabase startup creates platform objects; verify restore compatibility before any database write.',
  }, null, 2)+'\n', {flag:'wx', mode:0o600});
  return {destination, projectId:'folio-c01-recovery', ports:C01_PORTS, started:false};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--stage-new-target') throw new Error('c01_usage');
    const source = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
    console.log(JSON.stringify(await stageSyntheticTarget(C01_TARGET, source)));
  } catch (error) {
    console.error(JSON.stringify({status:'c01_stage_failed',reason:error.message}));
    process.exitCode = 1;
  }
}
