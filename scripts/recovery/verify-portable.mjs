import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openEnvelope } from './envelope.mjs';

const FAILURE = 'No se pudo verificar el sobre. Revise los archivos, el contexto y la entrada privada.\n';
const USAGE = 'node verify-portable.mjs --envelope <sobre.json> --private-key <privada-cifrada.pem> --operation-id <id> --project-id <id> --environment <entorno>\n';
const MAX_PHRASE_BYTES = 4096;

function parseArguments(argv) {
  const allowed = ['--envelope', '--private-key', '--operation-id', '--project-id', '--environment'];
  const options = {};
  if (argv.length !== allowed.length * 2) throw new Error();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!allowed.includes(name) || Object.hasOwn(options, name) || !value || value.startsWith('--')) throw new Error();
    options[name] = value;
  }
  const context = {
    operationId: options['--operation-id'],
    projectId: options['--project-id'],
    environment: options['--environment'],
  };
  if (Object.values(context).some(value => !/^[a-zA-Z0-9_-]{1,160}$/.test(value))) throw new Error();
  return { envelopePath: options['--envelope'], privateKeyPath: options['--private-key'], context };
}

async function readBounded(path, limit) {
  const file = await open(path, 'r');
  let bytes;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw new Error();
    // One extra byte detects growth without an unbounded readFile allocation.
    bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error();
    return bytes.subarray(0, length);
  } catch (error) {
    bytes?.fill(0);
    throw error;
  } finally {
    await file.close();
  }
}

// Exported for synthetic terminal tests; the CLI always uses the real process TTY.
export function readPrivatePhrase(input, prompt, signals = process) {
  if (!input.isTTY || !prompt.isTTY || input.readableEnded || input.destroyed || typeof input.setRawMode !== 'function') return Promise.reject(new Error());
  const wasRaw = Boolean(input.isRaw);
  const wasPaused = input.isPaused();
  const phrase = Buffer.alloc(MAX_PHRASE_BYTES);
  let length = 0;
  return new Promise((resolvePhrase, reject) => {
    let finished = false;
    const cancel = () => finish(false);
    const signalNames = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    function finish(success) {
      if (finished) return;
      finished = true;
      let result;
      try {
        input.removeListener('data', onData);
        for (const event of ['end', 'close', 'error']) input.removeListener(event, cancel);
        for (const signal of signalNames) signals.removeListener(signal, cancel);
        input.setRawMode(wasRaw);
        if (wasPaused) input.pause();
        else input.resume();
        prompt.write('\n');
        if (success && length) result = Buffer.from(phrase.subarray(0, length));
      } catch {
        result?.fill(0);
        result = undefined;
      } finally {
        phrase.fill(0);
      }
      if (result) resolvePhrase(result);
      else reject(new Error());
    }
    function onData(chunk) {
      if (!Buffer.isBuffer(chunk)) { finish(false); return; }
      try {
        for (const byte of chunk) {
          if (byte === 13 || byte === 10) { finish(true); return; }
          if (byte === 8 || byte === 127) {
            if (length) {
              let start = length - 1;
              while (start > 0 && (phrase[start] & 0xc0) === 0x80) start--;
              phrase.fill(0, start, length);
              length = start;
            }
          } else if (byte < 32 || length === MAX_PHRASE_BYTES) {
            finish(false);
            return;
          } else {
            phrase[length++] = byte;
          }
        }
      } finally {
        chunk.fill(0);
      }
    }
    try {
      input.setRawMode(true);
      input.on('data', onData);
      for (const event of ['end', 'close', 'error']) input.on(event, cancel);
      for (const signal of signalNames) signals.on(signal, cancel);
      prompt.write('Frase privada (sin eco; Enter para comprobar, Ctrl+C para cancelar): ');
      input.resume();
    } catch {
      finish(false);
    }
  });
}

export async function runPortableVerification({ argv, input = process.stdin, output = process.stdout, errorOutput = process.stderr, signals = process }) {
  let privateKey;
  let phrase;
  let values;
  try {
    if (argv.length === 1 && argv[0] === '--help') { output.write(USAGE); return 0; }
    const { envelopePath, privateKeyPath, context } = parseArguments(argv);
    if (!input.isTTY || !errorOutput.isTTY) throw new Error();
    const envelopeBytes = await readBounded(envelopePath, 2_100_000);
    const envelope = JSON.parse(envelopeBytes.toString('utf8'));
    privateKey = await readBounded(privateKeyPath, 65_536);
    const header = Buffer.from('-----BEGIN ENCRYPTED PRIVATE KEY-----');
    if (!privateKey.subarray(0, header.length).equals(header) ||
        !(privateKey[header.length] === 10 || (privateKey[header.length] === 13 && privateKey[header.length + 1] === 10))) throw new Error();
    phrase = await readPrivatePhrase(input, errorOutput, signals);
    values = openEnvelope(envelope, privateKey, phrase, context);
    output.write(`${JSON.stringify({ authenticated: true, secretCount: Object.keys(values).length })}\n`);
    return 0;
  } catch {
    errorOutput.write(FAILURE);
    return 1;
  } finally {
    phrase?.fill(0);
    privateKey?.fill(0);
    if (values) for (const name of Object.keys(values)) delete values[name];
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runPortableVerification({ argv: process.argv.slice(2) });
  // A resumed TTY can otherwise keep the finished CLI alive. Its raw/paused state
  // has already been restored; unref releases only this process's lifetime hold.
  process.stdin.unref?.();
}
