import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, basename, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {classifyDocsOnly, DOCS_ONLY_PATHS} from '../../scripts/ci/docs-only.mjs';

const classifierSource = readFileSync(new URL('../../scripts/ci/docs-only.mjs', import.meta.url));
const scratchPrefix = 'folio-ci-docs-';
const noGlobalConfig = process.platform === 'win32' ? 'NUL' : '/dev/null';

function fixture(t, {helper = true, helperSource = classifierSource, omitted = []} = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), scratchPrefix));
  t.after(() => {
    const target = resolve(repoRoot);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(target).startsWith(scratchPrefix));
    assert.ok(lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink());
    rmSync(target, {recursive: true});
  });
  const env = {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: noGlobalConfig};
  const git = (args, input) => execFileSync('git', args, {cwd: repoRoot, env, input, stdio: ['pipe', 'pipe', 'pipe']}).toString().trim();
  git(['init', '--quiet', '--initial-branch=master']);
  for (const [key, value] of Object.entries({
    'user.name': 'Folio CI synthetic', 'user.email': 'ci-docs@example.invalid',
    'commit.gpgsign': 'false', 'core.autocrlf': 'false', 'core.filemode': 'true', 'core.protectNTFS': 'false',
  })) git(['config', key, value]);
  mkdirSync(join(repoRoot, 'empty-hooks'));
  git(['config', 'core.hooksPath', join(repoRoot, 'empty-hooks')]);
  for (const path of DOCS_ONLY_PATHS.filter(path => !omitted.includes(path))) {
    mkdirSync(resolve(repoRoot, path, '..'), {recursive: true});
    writeFileSync(join(repoRoot, path), '# Synthetic documentation\n');
  }
  mkdirSync(join(repoRoot, 'app'), {recursive: true});
  writeFileSync(join(repoRoot, 'app/runtime.ts'), 'export const synthetic = true;\n');
  if (helper) {
    mkdirSync(join(repoRoot, 'scripts/ci'), {recursive: true});
    writeFileSync(join(repoRoot, 'scripts/ci/docs-only.mjs'), helperSource);
  }
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'synthetic base']);
  const baseSha = git(['rev-parse', 'HEAD']);
  function merge(changes) {
    git(['read-tree', baseSha]);
    for (const change of changes) {
      if (change.remove) git(['update-index', '--force-remove', '--', change.path]);
      else {
        const sha = change.mode === '160000' ? baseSha : git(['hash-object', '-w', '--stdin'], change.content ?? '# Updated synthetic documentation\n');
        git(['update-index', '--add', '--cacheinfo', change.mode ?? '100644', sha, change.path]);
      }
    }
    const tree = git(['write-tree']);
    const headSha = git(['commit-tree', tree, '-p', baseSha], 'synthetic head\n');
    const mergeSha = git(['commit-tree', tree, '-p', baseSha, '-p', headSha], 'synthetic merge\n');
    git(['update-ref', 'HEAD', mergeSha]);
    return {repoRoot, eventName: 'pull_request', baseSha, headSha, mergeSha};
  }
  return {repoRoot, git, env, baseSha, merge};
}

test('only the ten literal allowlisted Markdown files select docs-only', t => {
  assert.equal(DOCS_ONLY_PATHS.length, 10);
  const f = fixture(t);
  const result = classifyDocsOnly(f.merge(DOCS_ONLY_PATHS.map(path => ({path}))));
  assert.equal(result.docsOnly, true);
  assert.deepEqual([...result.paths].sort(), [...DOCS_ONLY_PATHS].sort());
});

test('additions and deletions of regular text in the allowlist are accepted', t => {
  const added = 'docs/BRANCH-STATUS.md';
  const f = fixture(t, {omitted: [added]});
  assert.equal(classifyDocsOnly(f.merge([{path: added}, {path: 'docs/AVANCES.md', remove: true}])).docsOnly, true);
});

for (const path of ['app/runtime.ts', '.github/workflows/app-ci.yml', 'scripts/ci/docs-only.mjs',
  'package.json', 'pnpm-lock.yaml', 'supabase/migrations/new.sql', 'next.config.ts', 'public/image.svg',
  'docs/unknown.md', 'docs/design/design-directions.html', 'AGENTS.md', 'docs/AVANCES.mdx',
  'docs/a b.md', 'docs/AVANCES.md\toutside.md', 'docs/AVANCES.md\napp/runtime.ts']) {
  test(`mixed docs with ${JSON.stringify(path)} always selects full CI`, t => {
    const f = fixture(t);
    assert.equal(classifyDocsOnly(f.merge([{path: 'docs/LAUNCH-BOARD.md'}, {path}])).docsOnly, false);
  });
}

for (const mode of ['100755', '120000', '160000']) {
  test(`allowlisted path with Git mode ${mode} selects full CI`, t => {
    const f = fixture(t);
    assert.equal(classifyDocsOnly(f.merge([{path: 'docs/AVANCES.md', mode}])).docsOnly, false);
  });
}

for (const content of [Buffer.from([0, 1, 2]), Buffer.from([0xc3, 0x28]), Buffer.from('text\x1b[31m')]) {
  test(`binary, invalid UTF-8 or control bytes select full CI (${content.toString('hex')})`, t => {
    const f = fixture(t);
    assert.equal(classifyDocsOnly(f.merge([{path: 'docs/AVANCES.md', content}])).docsOnly, false);
  });
}

test('both old and new Markdown blobs must be textual', t => {
  const f = fixture(t);
  const old = f.merge([{path: 'docs/AVANCES.md', content: Buffer.from([0, 1])}]);
  f.git(['update-ref', 'HEAD', old.headSha]);
  const baseSha = old.headSha;
  f.git(['read-tree', baseSha]);
  const sha = f.git(['hash-object', '-w', '--stdin'], '# Text now\n');
  f.git(['update-index', '--cacheinfo', '100644', sha, 'docs/AVANCES.md']);
  const tree = f.git(['write-tree']);
  const headSha = f.git(['commit-tree', tree, '-p', baseSha], 'text replaces binary\n');
  const mergeSha = f.git(['commit-tree', tree, '-p', baseSha, '-p', headSha], 'synthetic merge\n');
  f.git(['update-ref', 'HEAD', mergeSha]);
  assert.equal(classifyDocsOnly({...old, baseSha, headSha, mergeSha}).docsOnly, false);
});

test('rename entirely inside the allowlist is checked as delete/add', t => {
  const destination = 'docs/BRANCH-STATUS.md';
  const f = fixture(t, {omitted: [destination]});
  const result = classifyDocsOnly(f.merge([{path: 'docs/AVANCES.md', remove: true}, {path: destination}]));
  assert.equal(result.docsOnly, true);
  assert.deepEqual(result.paths.sort(), ['docs/AVANCES.md', destination].sort());
});

test('rename from outside the allowlist to an allowed path still selects full CI', t => {
  const f = fixture(t);
  assert.equal(classifyDocsOnly(f.merge([{path: 'app/runtime.ts', remove: true}, {path: 'docs/AVANCES.md'}])).docsOnly, false);
});

test('empty delta selects full CI', t => {
  const f = fixture(t);
  assert.equal(classifyDocsOnly(f.merge([])).reason, 'empty_diff');
});

test('the first classifier PR is full because the base has no classifier', t => {
  const f = fixture(t, {helper: false});
  assert.equal(classifyDocsOnly(f.merge([{path: 'docs/AVANCES.md'}])).reason, 'base_classifier_unavailable');
});

test('push, dispatch, missing event and malformed SHAs all select full CI', t => {
  const f = fixture(t);
  const input = f.merge([{path: 'docs/AVANCES.md'}]);
  for (const eventName of ['push', 'workflow_dispatch', undefined]) {
    assert.equal(classifyDocsOnly({...input, eventName}).docsOnly, false);
  }
  for (const value of [undefined, '', 'master', 'f'.repeat(39), 'F'.repeat(40), 'HEAD; echo unsafe']) {
    for (const key of ['baseSha', 'headSha', 'mergeSha']) assert.equal(classifyDocsOnly({...input, [key]: value}).docsOnly, false);
  }
});

test('checkout mismatch, stale base, stale head and missing objects select full CI', t => {
  const f = fixture(t);
  const input = f.merge([{path: 'docs/AVANCES.md'}]);
  for (const override of [{mergeSha: f.baseSha}, {baseSha: 'f'.repeat(40)}, {headSha: f.baseSha}, {repoRoot: join(f.repoRoot, 'absent')}]) {
    assert.equal(classifyDocsOnly({...input, ...override}).docsOnly, false);
  }
});

test('the base copy rejects a candidate classifier that lies about source changes', t => {
  const f = fixture(t);
  const input = f.merge([{path: 'scripts/ci/docs-only.mjs', content: 'console.log("docs_only=true");\n'}]);
  const trusted = join(f.repoRoot, 'trusted-base.mjs');
  writeFileSync(trusted, f.git(['show', `${input.baseSha}:scripts/ci/docs-only.mjs`]));
  const stdout = execFileSync(process.execPath, [trusted], {cwd: f.repoRoot, env: {
    ...process.env, GITHUB_EVENT_NAME: 'pull_request', DOCS_ONLY_BASE_SHA: input.baseSha,
    DOCS_ONLY_HEAD_SHA: input.headSha, DOCS_ONLY_MERGE_SHA: input.mergeSha,
  }, stdio: ['ignore', 'pipe', 'pipe']}).toString().trim();
  assert.equal(stdout, 'docs_only=false');
});

test('a shallow checkout without verified merge parents selects full CI', t => {
  const f = fixture(t);
  const input = f.merge([{path: 'docs/AVANCES.md'}]);
  const shallow = join(f.repoRoot, 'shallow');
  f.git(['clone', '--quiet', '--depth=1', pathToFileURL(f.repoRoot).href, shallow]);
  assert.equal(classifyDocsOnly({...input, repoRoot: shallow}).docsOnly, false);
});

function workflowBootstrap(name) {
  const lines = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8').split(/\r?\n/u);
  const start = lines.findIndex(line => line.includes('- name: Classify documentation-only PR from verified base'));
  assert.notEqual(start, -1);
  const run = lines.findIndex((line, index) => index > start && line.trim() === 'run: |');
  let end = run + 1;
  while (end < lines.length && (lines[end].startsWith('          ') || !lines[end].trim())) end++;
  return lines.slice(run + 1, end).map(line => line.slice(10)).join('\n');
}

function runBootstrap(f, input, workflow = 'app-ci.yml', {prefix = '', overrides = {}} = {}) {
  const output = join(f.repoRoot, 'step-output.txt');
  writeFileSync(output, '');
  const runnerTemp = join(f.repoRoot, 'runner-temp');
  mkdirSync(runnerTemp, {recursive: true});
  const bash = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';
  execFileSync(bash, ['-c', `${prefix}\n${workflowBootstrap(workflow)}`], {cwd: f.repoRoot, env: {
    ...f.env, GITHUB_EVENT_NAME: input.eventName, DOCS_ONLY_BASE_SHA: input.baseSha,
    DOCS_ONLY_HEAD_SHA: input.headSha, DOCS_ONLY_MERGE_SHA: input.mergeSha,
    RUNNER_TEMP: runnerTemp.replaceAll('\\', '/'), GITHUB_OUTPUT: output.replaceAll('\\', '/'), ...overrides,
  }, stdio: ['ignore', 'pipe', 'pipe']});
  return readFileSync(output, 'utf8').trim();
}

test('both actual workflow bootstraps accept a verified docs-only PR and keep other events full', t => {
  const f = fixture(t);
  const input = f.merge([{path: 'docs/AVANCES.md'}]);
  for (const workflow of ['app-ci.yml', 'pgtap.yml']) {
    assert.equal(runBootstrap(f, input, workflow), 'docs_only=true');
    for (const eventName of ['push', 'workflow_dispatch']) {
      assert.equal(runBootstrap(f, {...input, eventName}, workflow), 'docs_only=false');
    }
    assert.equal(runBootstrap(f, input, workflow, {overrides: {DOCS_ONLY_BASE_SHA: ''}}), 'docs_only=false');
  }
});

for (const helperSource of ['', 'console.log("docs_only=true\\nextra");\n', 'throw new Error("synthetic failure");\n']) {
  test(`workflow fallback rejects absent, unexpected or failed classifier output (${helperSource.length} bytes)`, t => {
    const f = fixture(t, {helperSource});
    const input = f.merge([{path: 'docs/AVANCES.md'}]);
    assert.equal(runBootstrap(f, input), 'docs_only=false');
  });
}

test('workflow fallback stays full when Git or Node cannot run', t => {
  const f = fixture(t);
  const input = f.merge([{path: 'docs/AVANCES.md'}]);
  for (const prefix of ['git() { return 1; }', 'node() { return 127; }']) {
    assert.equal(runBootstrap(f, input, 'app-ci.yml', {prefix}), 'docs_only=false');
  }
});
