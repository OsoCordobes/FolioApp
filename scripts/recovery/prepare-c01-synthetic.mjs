#!/usr/bin/env node
// Stages a NEW local Supabase 17 target. It never starts Docker or reads env files.
import { mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOutsideRepository } from '../backup/paths.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const C01_TARGET = 'C:\\Users\\amiun\\Documents\\Codex\\folio-c01-recovery-synthetic';
export const C01_PORTS = Object.freeze({app:4432,api:55421,db:55422,studio:55423,inbucket:55424,analytics:55427,pooler:55429,inspector:55483});

// Build from a closed list. Copying the application config could carry SMTP,
// OAuth, hooks, or future provider settings into the isolated target.
export function syntheticTargetConfig() {
  return `project_id = "folio-c01-recovery"

[api]
enabled = true
port = ${C01_PORTS.api}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]

[db]
port = ${C01_PORTS.db}
major_version = 17

[db.pooler]
enabled = false
port = ${C01_PORTS.pooler}

[db.migrations]
enabled = false

[db.seed]
enabled = false

[realtime]
enabled = false

[studio]
enabled = true
port = ${C01_PORTS.studio}

[inbucket]
enabled = true
port = ${C01_PORTS.inbucket}

[storage]
enabled = true
file_size_limit = "50MiB"

[auth]
enabled = true
site_url = "http://127.0.0.1:${C01_PORTS.app}"
additional_redirect_urls = ["http://127.0.0.1:${C01_PORTS.app}/api/auth/callback", "http://127.0.0.1:${C01_PORTS.app}/reset-password"]
enable_signup = true

[auth.email]
enable_signup = true
enable_confirmations = false

[auth.sms]
enable_signup = false

[auth.mfa]
max_enrolled_factors = 10

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true

[auth.mfa.phone]
enroll_enabled = false
verify_enabled = false

[edge_runtime]
enabled = false
inspector_port = ${C01_PORTS.inspector}

[analytics]
enabled = false
port = ${C01_PORTS.analytics}
`;
}

export async function stageSyntheticTarget(destination, {repo = repository} = {}) {
  if (!path.isAbsolute(destination) || path.basename(destination) !== 'folio-c01-recovery-synthetic')
    throw new Error('c01_target_path_invalid');
  const parent = path.dirname(destination);
  const parentState = await lstat(parent);
  if (!parentState.isDirectory() || parentState.isSymbolicLink()) throw new Error('c01_target_parent_invalid');
  await resolveOutsideRepository(await realpath(parent), repo);
  // The leaf creation is exclusive. A second caller must never enter an
  // existing target, even if the first caller has not written config yet.
  try { await mkdir(destination, {mode:0o700}); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('c01_target_already_exists');
    throw error;
  }
  await mkdir(path.join(destination, 'supabase'), {mode:0o700});
  await writeFile(path.join(destination, 'supabase', 'config.toml'), syntheticTargetConfig(), {flag:'wx', mode:0o600});
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
    console.log(JSON.stringify(await stageSyntheticTarget(C01_TARGET)));
  } catch (error) {
    console.error(JSON.stringify({status:'c01_stage_failed',reason:error.message}));
    process.exitCode = 1;
  }
}
