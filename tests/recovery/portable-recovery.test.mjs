import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sealSecrets } from '../../scripts/recovery/envelope.mjs';
import { readPrivatePhrase, runPortableVerification } from '../../scripts/recovery/verify-portable.mjs';

const sentinel = 'PRIVATE-SENTINEL-do-not-print-917';
const passphrase = 'synthetic-only-frase-á-917';
const context = { operationId: 'synthetic-operation', projectId: 'synthetic-project', environment: 'synthetic' };
const keys = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
});
const envelope = sealSecrets({ FOLIO_ENC_KEY: sentinel, MP_ACCESS_TOKEN: sentinel }, keys.publicKey, context);
const scriptPath = fileURLToPath(new URL('../../scripts/recovery/verify-portable.mjs', import.meta.url));

class Terminal extends EventEmitter {
  constructor({ raw = false, paused = true, tty = true } = {}) {
    super();
    this.isTTY = tty;
    this.isRaw = raw;
    this.paused = paused;
    this.rawChanges = [];
  }
  setRawMode(raw) { this.rawChanges.push(raw); this.isRaw = raw; }
  isPaused() { return this.paused; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
}

function channel(onPrompt, { tty = true } = {}) {
  return {
    isTTY: tty, text: '',
    write(value) {
      this.text += value;
      if (value.startsWith('Frase privada')) queueMicrotask(onPrompt);
    },
  };
}

function assertNoLeaks(...outputs) {
  for (const output of outputs) for (const forbidden of [sentinel, passphrase, 'FOLIO_ENC_KEY', 'MP_ACCESS_TOKEN', 'BEGIN ENCRYPTED', 'Error:', ' at ']) {
    assert.equal(output.includes(forbidden), false, `public output contains forbidden material: ${forbidden}`);
  }
}

function assertRestored(input, signals, { raw = false, paused = true } = {}) {
  assert.equal(input.isRaw, raw);
  assert.equal(input.isPaused(), paused);
  for (const event of ['data', 'end', 'close', 'error']) assert.equal(input.listenerCount(event), 0);
  for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(signals.listenerCount(event), 0);
}

async function fixture(fn, { wire = envelope, key = keys.privateKey } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'folio-portable-synthetic-'));
  const envelopePath = join(directory, 'synthetic.json');
  const privateKeyPath = join(directory, 'synthetic.pem');
  const wireBytes = typeof wire === 'string' || Buffer.isBuffer(wire) ? wire : JSON.stringify(wire);
  await writeFile(envelopePath, wireBytes, { flag: 'wx' });
  await writeFile(privateKeyPath, key, { flag: 'wx' });
  const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
  const before = await Promise.all([hash(envelopePath), hash(privateKeyPath)]);
  const argv = ['--envelope', envelopePath, '--private-key', privateKeyPath,
    '--operation-id', context.operationId, '--project-id', context.projectId, '--environment', context.environment];
  try {
    await fn(argv, directory);
    assert.deepEqual(await Promise.all([hash(envelopePath), hash(privateKeyPath)]), before, 'inputs must remain byte identical');
  } finally {
    // Only this test's freshly generated synthetic temporary directory is removed.
    await rm(directory, { recursive: true });
  }
}

async function run(argv, { phrase = passphrase, input = new Terminal(), action, promptTTY = true } = {}) {
  const signals = new EventEmitter();
  const output = channel(() => {});
  const errorOutput = channel(() => action ? action(input, signals) : input.emit('data', Buffer.from(`${phrase}\r`)), { tty: promptTTY });
  const exitCode = await runPortableVerification({ argv, input, output, errorOutput, signals });
  assertNoLeaks(output.text, errorOutput.text);
  assertRestored(input, signals);
  return { exitCode, output, errorOutput, input };
}

test('synthetic success authenticates and prints only the count; inputs unchanged', async () => {
  await fixture(async argv => {
    const result = await run(argv);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.text, '{"authenticated":true,"secretCount":2}\n');
    assert.deepEqual(result.input.rawChanges, [true, false]);
  });
});

test('wrong phrase and every incorrect expected context fail generically', async () => {
  await fixture(async argv => {
    const cases = [await run(argv, { phrase: 'incorrect-synthetic' })];
    for (const flag of ['--operation-id', '--project-id', '--environment']) {
      const wrong = [...argv];
      wrong[wrong.indexOf(flag) + 1] = 'incorrect-context';
      cases.push(await run(wrong));
    }
    for (const result of cases) {
      assert.equal(result.exitCode, 1);
      assert.equal(result.output.text, '');
      assert.match(result.errorOutput.text, /No se pudo verificar el sobre/);
      assert.deepEqual(result.input.rawChanges, [true, false], 'must reach authentication after private entry');
    }
    assert.equal(new Set(cases.map(result => result.errorOutput.text)).size, 1);
  });
});

test('tampered authenticated ciphertext and malformed JSON fail without partial output', async () => {
  const damaged = structuredClone(envelope);
  const ciphertext = Buffer.from(damaged.ciphertext, 'base64');
  ciphertext[0] ^= 1;
  damaged.ciphertext = ciphertext.toString('base64');
  for (const wire of [damaged, `invalid-${sentinel}`]) {
    await fixture(async argv => {
      const result = await run(argv);
      assert.equal(result.exitCode, 1);
      assert.equal(result.output.text, '');
    }, { wire });
  }
});

test('missing context, duplicate flags, and any phrase flag fail before prompting', async () => {
  await fixture(async argv => {
    for (const bad of [argv.slice(0, -2), [...argv, '--passphrase', sentinel], [...argv.slice(0, -2), '--project-id', 'duplicate']]) {
      const result = await run(bad);
      assert.equal(result.exitCode, 1);
      assert.equal(result.errorOutput.text.includes('Frase privada'), false);
      assert.deepEqual(result.input.rawChanges, []);
    }
  });
});

test('no TTY on input or private prompt refuses the channel before reading a phrase', async () => {
  await fixture(async argv => {
    for (const options of [{ input: new Terminal({ tty: false }) }, { promptTTY: false }]) {
      const result = await run(argv, options);
      assert.equal(result.exitCode, 1);
      assert.equal(result.errorOutput.text.includes('Frase privada'), false);
      assert.deepEqual(result.input.rawChanges, []);
    }
  });
});

test('empty phrase, cancellation, EOF, stream errors and signals restore the terminal', async () => {
  await fixture(async argv => {
    const actions = [
      input => input.emit('data', Buffer.from('\r')),
      input => input.emit('data', Buffer.from(`${sentinel}\x03`)),
      input => input.emit('data', Buffer.from(`${sentinel}\x04`)),
      ...['end', 'close', 'error'].map(event => input => {
        input.emit('data', Buffer.from(sentinel));
        input.emit(event, event === 'error' ? new Error(sentinel) : undefined);
      }),
      ...['SIGINT', 'SIGTERM', 'SIGHUP'].map(event => (input, signals) => {
        input.emit('data', Buffer.from(sentinel));
        signals.emit(event);
      }),
    ];
    for (const action of actions) {
      const result = await run(argv, { action });
      assert.equal(result.exitCode, 1);
      assert.equal(result.output.text, '');
      assert.deepEqual(result.input.rawChanges, [true, false]);
    }
  });
});

test('raw and running prior terminal state and existing signal listener are preserved', async () => {
  const input = new Terminal({ raw: true, paused: false });
  const signals = new EventEmitter();
  const existing = () => {};
  signals.on('SIGINT', existing);
  const prompt = channel(() => input.emit('data', Buffer.from(`${passphrase}\r`)));
  const phrase = await readPrivatePhrase(input, prompt, signals);
  assert.equal(phrase.toString('utf8'), passphrase);
  phrase.fill(0);
  assert.equal(signals.listeners('SIGINT')[0], existing);
  signals.removeListener('SIGINT', existing);
  assertRestored(input, signals, { raw: true, paused: false });
  assertNoLeaks(prompt.text);
});

test('UTF-8 phrase supports backspace without echo and wipes consumed input buffers', async () => {
  const input = new Terminal();
  const signals = new EventEmitter();
  const chunk = Buffer.from('frase-á\x7fz\r');
  const prompt = channel(() => input.emit('data', chunk));
  const phrase = await readPrivatePhrase(input, prompt, signals);
  assert.equal(phrase.toString('utf8'), 'frase-z');
  phrase.fill(0);
  assert.equal(chunk.every(byte => byte === 0), true);
  assert.equal(prompt.text.includes('frase-z'), false);
  assertRestored(input, signals);
});

test('private entry overflow and prompt failure close the private channel', async () => {
  const input = new Terminal();
  const signals = new EventEmitter();
  await assert.rejects(readPrivatePhrase(input, channel(() => input.emit('data', Buffer.alloc(4097, 65))), signals));
  assertRestored(input, signals);
  const brokenPrompt = { isTTY: true, write() { throw new Error(sentinel); } };
  await assert.rejects(readPrivatePhrase(input, brokenPrompt, signals));
  assertRestored(input, signals);
});

test('already closed input fails immediately without changing terminal state', async () => {
  for (const state of ['readableEnded', 'destroyed']) {
    const input = new Terminal();
    input[state] = true;
    const signals = new EventEmitter();
    const prompt = channel(() => { throw new Error('must not prompt'); });
    await assert.rejects(readPrivatePhrase(input, prompt, signals));
    assertRestored(input, signals);
    assert.equal(prompt.text, '');
    assert.deepEqual(input.rawChanges, []);
  }
});

test('oversized files and a plaintext private key fail before private entry', async () => {
  const plaintextKey = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
  for (const options of [{ wire: Buffer.alloc(2_100_001, 32) }, { key: Buffer.alloc(65_537, 32) }, { key: plaintextKey }]) {
    await fixture(async argv => {
      const result = await run(argv);
      assert.equal(result.exitCode, 1);
      assert.equal(result.errorOutput.text.includes('Frase privada'), false);
      assert.deepEqual(result.input.rawChanges, []);
    }, options);
  }
});

test('real CLI rejects redirected private input and supports safe help', async () => {
  await fixture(async argv => {
    const result = spawnSync(process.execPath, [scriptPath, ...argv], { input: passphrase, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('Frase privada'), false);
    assertNoLeaks(result.stdout, result.stderr);
  });
  const help = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0);
  assert.equal(help.stderr, '');
  assert.match(help.stdout, /--operation-id <id> --project-id <id> --environment <entorno>/);
});
