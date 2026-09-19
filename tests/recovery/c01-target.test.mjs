import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stageSyntheticTarget, syntheticTargetConfig, C01_PORTS} from '../../scripts/recovery/prepare-c01-synthetic.mjs';

const source = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
function setting(config, section, key) {
  let active = '';
  for (const line of config.split('\n')) {
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) active = header[1];
    if (active === section && line.startsWith(`${key} = `)) return line.slice(key.length + 3);
  }
  return undefined;
}

test('C01 target has exclusive ports, Auth/MFA/Storage and no source project identity or outgoing jobs', () => {
  const config = syntheticTargetConfig(source);
  assert.match(config, /^project_id = "folio-c01-recovery"$/m);
  assert.match(config, /^major_version = 17$/m);
  for (const [section, key, port] of [
    ['api','port',C01_PORTS.api], ['db','port',C01_PORTS.db],
    ['studio','port',C01_PORTS.studio], ['inbucket','port',C01_PORTS.inbucket],
    ['analytics','port',C01_PORTS.analytics], ['db.pooler','port',C01_PORTS.pooler],
    ['edge_runtime','inspector_port',C01_PORTS.inspector],
  ]) assert.equal(setting(config, section, key), String(port));
  assert.equal(setting(config, 'auth', 'site_url'), `"http://127.0.0.1:${C01_PORTS.app}"`);
  assert.equal(setting(config, 'auth.mfa.totp', 'enroll_enabled'), 'true');
  assert.equal(setting(config, 'auth.mfa.totp', 'verify_enabled'), 'true');
  assert.equal(setting(config, 'storage', 'enabled'), 'true');
  for (const section of ['db.migrations','db.seed','realtime','edge_runtime','analytics'])
    assert.equal(setting(config, section, 'enabled'), 'false');
  assert.doesNotMatch(config, /folio-local-clinical|localhost:4420/);
  assert.throws(() => syntheticTargetConfig(`${source}\n[auth.external.google]\nenabled = true\n`), /c01_external_configuration_present/);
  assert.throws(() => syntheticTargetConfig(`${source}\n[auth.email.smtp]\npass = "env(SECRET)"\n`), /c01_external_configuration_present/);
});

test('C01 staging creates a new target once and never overwrites an existing target', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'folio-c01-stage-'));
  const destination = path.join(parent, 'folio-c01-recovery-synthetic');
  try {
    const result = await stageSyntheticTarget(destination, source);
    assert.equal(result.started, false);
    const plan = JSON.parse(await readFile(path.join(destination,'c01-target-plan.json'),'utf8'));
    assert.equal(plan.dataRestored, false);
    assert.equal(plan.externalProviders, false);
    await assert.rejects(stageSyntheticTarget(destination, source), /c01_target_already_exists/);
    await assert.rejects(stageSyntheticTarget(path.join(parent, 'other'), source), /c01_target_path_invalid/);
  } finally {
    assert.ok(path.basename(parent).startsWith('folio-c01-stage-'));
    await rm(parent, {recursive:true, force:true});
  }
});
