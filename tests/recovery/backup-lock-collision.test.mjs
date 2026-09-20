import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireBackupLock } from '../../scripts/backup/lock.mjs';

function legacyLinuxPort(directory) {
  const hash = createHash('sha256').update(directory).digest('hex');
  return 49152 + (parseInt(hash.slice(0, 8), 16) % 16384);
}

test('Windows named pipe lease still rejects overlap and can be reacquired', {
  skip: process.platform !== 'win32',
}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'folio-backup-lock-windows-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('folio-backup-lock-windows-'));
    await rm(directory, { recursive: true, force: true });
  });
  const lease = await acquireBackupLock(directory);
  try {
    await assert.rejects(acquireBackupLock(directory), /backup_capture_already_running_or_lock_unavailable/);
  } finally {
    await lease.release();
  }
  const reacquired = await acquireBackupLock(directory);
  await reacquired.release();
});

test('distinct Linux destinations with a legacy port collision keep independent leases', {
  skip: process.platform !== 'linux',
}, async t => {
  // Both holders run in this process's network namespace. Neither the old
  // loopback lease nor an abstract socket coordinates separate namespaces.
  const root = await mkdtemp(path.join(os.tmpdir(), 'folio-backup-lock-collision-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('folio-backup-lock-collision-'));
    await rm(root, { recursive: true, force: true });
  });
  const canonicalRoot = await realpath(root);
  const byPort = new Map();
  let pair;
  for (let i = 0; i < 20000; i++) {
    const candidate = path.join(canonicalRoot, `destination-${i}`);
    const port = legacyLinuxPort(candidate);
    // Stay above the usual ephemeral range so the old lock reaches the
    // intentional second-bind collision instead of an unrelated listener.
    if (port < 61000) continue;
    const previous = byPort.get(port);
    if (previous) { pair = [previous, candidate]; break; }
    byPort.set(port, candidate);
  }
  assert.ok(pair, 'the legacy 14-bit port mapping must collide');
  const [first, second] = pair;
  assert.notEqual(first, second);
  assert.equal(legacyLinuxPort(first), legacyLinuxPort(second));
  await mkdir(first);
  await mkdir(second);

  const firstLease = await acquireBackupLock(first);
  let secondLease;
  try {
    await assert.rejects(acquireBackupLock(first), /backup_capture_already_running_or_lock_unavailable/);
    secondLease = await acquireBackupLock(second);
  } finally {
    await secondLease?.release();
    await firstLease.release();
  }

  const reacquired = await acquireBackupLock(first);
  await reacquired.release();
});

test('a killed Linux lock holder releases the abstract lease', {
  skip: process.platform !== 'linux',
  timeout: 15000,
}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'folio-backup-lock-killed-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('folio-backup-lock-killed-'));
    await rm(directory, { recursive: true, force: true });
  });
  const moduleUrl = new URL('../../scripts/backup/lock.mjs', import.meta.url).href;
  child = spawn(process.execPath, [
    '--input-type=module', '-e',
    `import { acquireBackupLock } from ${JSON.stringify(moduleUrl)};
     await acquireBackupLock(process.argv[1]);
     process.stdout.write('LEASED');`,
    directory,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let childError = '';
  child.stderr.on('data', chunk => { childError += chunk; });
  const ready = await Promise.race([
    once(child.stdout, 'data').then(([chunk]) => String(chunk)),
    once(child, 'exit').then(() => `EXIT:${childError}`),
  ]);
  assert.equal(ready, 'LEASED');
  await assert.rejects(acquireBackupLock(directory), /backup_capture_already_running_or_lock_unavailable/);
  child.kill('SIGKILL');
  await once(child, 'exit');
  const reacquired = await acquireBackupLock(directory);
  await reacquired.release();
});
