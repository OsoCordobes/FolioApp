import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const actualRequire = createRequire(import.meta.url);
const privateValue = 'Paciente Ana ana@example.invalid diagnostico-privado bearer-secret';
function load(file: string, mocks: Record<string, unknown>, env: Record<string, string> = {}) { const exports: Record<string, unknown> = {}; const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; runInNewContext(js, { exports, require: (name: string) => name in mocks ? mocks[name] : actualRequire(name.startsWith('@/') ? resolve(name.slice(2)) : name.startsWith('.') ? resolve(dirname(file), name) : name), process: { env }, console, URL, Set }); return exports; }
for (const runtime of ['client', 'server', 'edge'])
  test(`Sentry ${runtime} drops secrets from every event channel and disables replay`, () => {
    let options: Record<string, unknown> = {};
    load(`sentry.${runtime}.config.ts`, { '@sentry/nextjs': { init: (o: Record<string, unknown>) => options = o, lazyLoadIntegration: () => Promise.resolve(() => ({})), addIntegration() { } } }, { NEXT_PUBLIC_SENTRY_DSN: 'https://synthetic.invalid/1' });
    const probe = { message: privateValue, exception: { values: [{ type: privateValue, value: privateValue, stacktrace: { frames: [{ filename: 'https://folio.invalid/api/documentos/patient/archivo?token=bearer-secret', function: privateValue, vars: { patient: privateValue }, lineno: 21 }] } }] }, request: { url: 'https://folio.invalid/t/bearer-secret?token=bearer-secret', headers: { authorization: privateValue, cookie: privateValue }, data: privateValue, query_string: privateValue }, user: { email: privateValue }, extra: { sql: privateValue }, tags: { patient: privateValue }, contexts: { app: { data: privateValue } }, breadcrumbs: [{ message: privateValue, data: { url: privateValue } }] };
    const hint = { attachments: [{ filename: 'clinical.txt', data: privateValue }] };
    const result = (options.beforeSend as (event: unknown, hint: unknown) => unknown)(probe, hint);
    assert.doesNotMatch(JSON.stringify({ result, hint }), /ana@example|diagnostico-privado|bearer-secret|clinical.txt/);
    assert.equal(options.tracesSampleRate, 0);
    assert.equal(options.sendDefaultPii, false);
    assert.equal((options.beforeBreadcrumb as (e: unknown) => unknown)({ data: privateValue }), null);
    assert.equal((options.beforeSendTransaction as (e: unknown) => unknown)(probe), null);
    if (runtime === 'client') {
      assert.equal(options.replaysOnErrorSampleRate, 0);
      assert.equal(options.replaysSessionSampleRate, 0);
    }
  });
test('server PostHog drops named clinical events and strips identifiers from permitted events', async () => {
  const captured: unknown[] = [];
  class Client {
    capture(event: unknown) { captured.push(event); }
  }
  const loaded = load('lib/observability/posthog.ts', { 'posthog-node': { PostHog: Client } }, { POSTHOG_KEY: 'synthetic' });
  const capture = loaded.captureServerEvent as (input: unknown) => Promise<void>;
  await capture({ distinctId: 'patient-uuid', event: 'soap.autosaved', properties: { patient: privateValue } });
  assert.equal(captured.length, 0);
  await capture({ distinctId: 'patient-uuid', event: 'onboarding.completed', properties: { steps_completed: 3, email: privateValue, url: privateValue, org_id: 'patient-uuid' } });
  assert.equal(captured.length, 1);
  assert.doesNotMatch(JSON.stringify(captured), /patient-uuid|ana@example|bearer-secret/);
  assert.match(JSON.stringify(captured), /steps_completed/);
});
import { operationalFacts, sanitizeAnalyticsEvent, sanitizeBrowserAnalyticsEvent, sanitizeSentryEvent } from '../../lib/observability/privacy';
import { safeLog } from '../../lib/observability/safe-log';
test('console keeps only registered operation, SQLSTATE, HTTP status and bounded counts', () => {
  const seen: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { seen.push(args); };
  try {
    safeLog('warn', 'auth.portal.otp', { code: '23505', status: 429, count: 2, message: privateValue, details: privateValue, cookie: privateValue, authorization: privateValue, name: privateValue }, privateValue);
    safeLog('warn', privateValue, { code: privateValue, status: 12345, count: NaN, total: -1 });
  }
  finally {
    console.warn = original;
  }
  const text = JSON.stringify(seen);
  assert.doesNotMatch(text, /ana@example|diagnostico-privado|bearer-secret/);
  assert.match(text, /23505/);
  assert.match(text, /429/);
  assert.match(text, /"count":2/);
  assert.match(text, /operation_unknown/);
});
test('analytics runtime allowlist rejects spoofed property names, clinical IDs and SDK URL defaults', () => {
  for (const name of ['soap.autosaved', 'documento.uploaded', 'turno.closed', '$pageview', '$snapshot', '$exception', '__proto__'])
    assert.equal(sanitizeAnalyticsEvent({ event: name, properties: { patient: privateValue } }), null);
  const sanitized = sanitizeBrowserAnalyticsEvent({ event: 'landing.cta_clicked', properties: { section: 'hero', target: '/onboarding?token=bearer-secret', $current_url: privateValue, $referrer: privateValue, $set: { email: privateValue }, distinct_id: privateValue }, uuid: privateValue, timestamp: privateValue });
  assert.doesNotMatch(JSON.stringify(sanitized), /ana@example|diagnostico-privado|bearer-secret/);
  assert.match(JSON.stringify(sanitized), /hero/);
  assert.deepEqual(operationalFacts({ name: privateValue, code: privateValue, count: Infinity, status: 321 }), {});
});
test('Sentry retains catalogued code locations and known errors without source snippets or variables', () => {
  const result = sanitizeSentryEvent({ exception: { values: [{ type: 'TypeError', value: privateValue, stacktrace: { frames: [{ filename: 'https://folio.invalid/lib/db/documentos.ts?token=bearer-secret', function: privateValue, lineno: 125, colno: 7, vars: { patient: privateValue }, context_line: privateValue }] } }] }, tags: { component: 'reconcile', patient: privateValue } }, { originalException: { code: '23514', message: privateValue, status: 503 } });
  const text = JSON.stringify(result);
  assert.match(text, /lib\/db\/documentos.ts/);
  assert.match(text, /TypeError/);
  assert.match(text, /23514/);
  assert.doesNotMatch(text, /ana@example|diagnostico-privado|bearer-secret|folio.invalid/);
});
test('application-owned runtime logs cannot bypass the central sanitizer', async () => {
  const { readdir } = await import('node:fs/promises');
  const files: string[] = [];
  const walk = async (dir: string) => { for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = dir + '/' + entry.name;
    if (entry.isDirectory())
      await walk(file);
    else if (/\.tsx?$/.test(file))
      files.push(file);
  } };
  for (const dir of ['app', 'lib', 'components'])
    await walk(dir);
  const unsafe: string[] = [];
  for (const file of files) {
    if (file === 'lib/observability/safe-log.ts')
      continue;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && node.expression.expression.getText(source) === 'console')
      unsafe.push(file); ts.forEachChild(node, visit); };
    visit(source);
  }
  assert.deepEqual(unsafe, []);
});
