import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stageSyntheticTarget, syntheticTargetConfig, C01_PORTS} from '../../scripts/recovery/prepare-c01-synthetic.mjs';

function settings(config) {
  let active = '';
  const values = new Map();
  for (const line of config.split('\n')) {
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { active = header[1]; continue; }
    const entry = line.match(/^([a-z_]+) = (.+)$/);
    if (entry) values.set(`${active}.${entry[1]}`, entry[2]);
  }
  return values;
}

test('C01 config is a fixed local Supabase 17 allowlist with Auth/MFA/Storage', () => {
  const config = syntheticTargetConfig();
  const values = settings(config);
  assert.equal(values.get('.project_id'), '"folio-c01-recovery"');
  assert.equal(values.get('db.major_version'), '17');
  for (const [section, key, port] of [
    ['api','port',C01_PORTS.api], ['db','port',C01_PORTS.db],
    ['studio','port',C01_PORTS.studio], ['inbucket','port',C01_PORTS.inbucket],
    ['analytics','port',C01_PORTS.analytics], ['db.pooler','port',C01_PORTS.pooler],
    ['edge_runtime','inspector_port',C01_PORTS.inspector],
  ]) assert.equal(values.get(`${section}.${key}`), String(port));
  assert.equal(values.get('auth.site_url'), `"http://127.0.0.1:${C01_PORTS.app}"`);
  assert.equal(values.get('auth.mfa.totp.enroll_enabled'), 'true');
  assert.equal(values.get('auth.mfa.totp.verify_enabled'), 'true');
  assert.equal(values.get('storage.enabled'), 'true');
  for (const section of ['db.migrations','db.seed','realtime','edge_runtime','analytics'])
    assert.equal(values.get(`${section}.enabled`), 'false');
  const allowed = new Set(['','api','db','db.pooler','db.migrations','db.seed','realtime','studio','inbucket','storage','auth','auth.email','auth.sms','auth.mfa','auth.mfa.totp','auth.mfa.phone','edge_runtime','analytics']);
  for (const key of values.keys()) assert.ok(allowed.has(key.slice(0,key.lastIndexOf('.'))));
  assert.doesNotMatch(config, /\benv\s*\(|smtp|auth\.external|auth\.hook|auth\.third_party|folio-local-clinical|localhost:4420/i);
});

test('C01 staging creates a new target once and never overwrites an existing target', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'folio-c01-stage-'));
  const destination = path.join(parent, 'folio-c01-recovery-synthetic');
  try {
    const result = await stageSyntheticTarget(destination);
    assert.equal(result.started, false);
    assert.equal(await readFile(path.join(destination,'supabase','config.toml'),'utf8'), syntheticTargetConfig());
    const plan = JSON.parse(await readFile(path.join(destination,'c01-target-plan.json'),'utf8'));
    assert.equal(plan.dataRestored, false);
    assert.equal(plan.externalProviders, false);
    await assert.rejects(stageSyntheticTarget(destination), /c01_target_already_exists/);
    await assert.rejects(stageSyntheticTarget(path.join(parent, 'other')), /c01_target_path_invalid/);
  } finally {
    assert.ok(path.basename(parent).startsWith('folio-c01-stage-'));
    await rm(parent, {recursive:true, force:true});
  }
});

test('C01 target directory creation is exclusive under concurrent calls', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'folio-c01-stage-'));
  const destination = path.join(parent, 'folio-c01-recovery-synthetic');
  try {
    const outcomes = await Promise.allSettled([stageSyntheticTarget(destination), stageSyntheticTarget(destination)]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = outcomes.find(result => result.status === 'rejected');
    assert.match(rejected.reason.message, /c01_target_already_exists/);
    assert.equal(await readFile(path.join(destination,'supabase','config.toml'),'utf8'), syntheticTargetConfig());
  } finally {
    assert.ok(path.basename(parent).startsWith('folio-c01-stage-'));
    await rm(parent, {recursive:true, force:true});
  }
});
