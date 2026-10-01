import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';

export const DOCS_ONLY_PATHS = Object.freeze([
  'docs/AGENT-SETUP-20260926.md',
  'docs/AVANCES.md',
  'docs/BRANCH-STATUS.md',
  'docs/C05-GOOGLE-PROOF-CONTRACT.md',
  'docs/D-CALIDAD-PILOTO.md',
  'docs/DESIGN-COHERENCE-PLAN.md',
  'docs/GUIA-PRUEBA-FOLIO.md',
  'docs/LAUNCH-BOARD.md',
  'docs/NEXT-LAUNCH-CYCLE.md',
  'docs/PROVIDER-FACTS-20260929.md',
]);
const allowedPaths = new Set(DOCS_ONLY_PATHS);
const shaPattern = /^[0-9a-f]{40}$/;
const decoder = new TextDecoder('utf-8', {fatal: true});

function git(repoRoot, args) {
  return execFileSync('git', ['--no-replace-objects', '--no-optional-locks', ...args], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function full(reason) {
  return {docsOnly: false, reason, paths: []};
}

function textBlob(repoRoot, sha) {
  const text = decoder.decode(git(repoRoot, ['cat-file', 'blob', sha]));
  // Tabs/newlines are text; other C0 controls and DEL are not Markdown input.
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text);
}

/** Inspect committed objects only. Uncertainty always selects the full pipeline. */
export function classifyDocsOnly({repoRoot = process.cwd(), eventName, baseSha, headSha, mergeSha}) {
  if (eventName !== 'pull_request') return full('not_pull_request');
  if (![baseSha, headSha, mergeSha].every(sha => typeof sha === 'string' && shaPattern.test(sha))) {
    return full('invalid_sha');
  }
  try {
    const checkedOut = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim();
    if (checkedOut !== mergeSha) return full('checkout_mismatch');
    const parents = git(repoRoot, ['show', '--no-patch', '--format=%P', mergeSha]).toString().trim().split(/\s+/u);
    if (parents.length !== 2 || parents[0] !== baseSha || parents[1] !== headSha) {
      return full('merge_parents_mismatch');
    }
    const helper = decoder.decode(git(repoRoot, ['ls-tree', '-z', baseSha, '--', 'scripts/ci/docs-only.mjs']));
    if (!/^100644 blob [0-9a-f]{40}\tscripts\/ci\/docs-only\.mjs\0$/u.test(helper)) {
      return full('base_classifier_unavailable');
    }

    // --no-renames exposes both endpoints as delete/add, with NUL-delimited paths.
    const raw = decoder.decode(git(repoRoot, [
      'diff', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv',
      baseSha, mergeSha, '--',
    ]));
    if (!raw) return full('empty_diff');
    const parts = raw.split('\0');
    if (parts.pop() !== '' || parts.length % 2 !== 0) return full('invalid_diff');
    const paths = [];
    for (let i = 0; i < parts.length; i += 2) {
      const metadata = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])$/u.exec(parts[i]);
      if (!metadata) return full('invalid_diff');
      const [, oldMode, newMode, oldSha, newSha, status] = metadata;
      const changedPath = parts[i + 1];
      if (!allowedPaths.has(changedPath)) return full('outside_allowlist');
      if (!['A', 'D', 'M'].includes(status)) return full('unsupported_change');
      const oldPresent = oldMode !== '000000';
      const newPresent = newMode !== '000000';
      if ((oldPresent && oldMode !== '100644') || (newPresent && newMode !== '100644')) {
        return full('non_regular_markdown');
      }
      if ((status === 'A' && (oldPresent || !newPresent))
        || (status === 'D' && (!oldPresent || newPresent))
        || (status === 'M' && (!oldPresent || !newPresent))) return full('invalid_diff');
      if ((oldPresent && !textBlob(repoRoot, oldSha)) || (newPresent && !textBlob(repoRoot, newSha))) {
        return full('non_text_markdown');
      }
      paths.push(changedPath);
    }
    return {docsOnly: true, reason: 'allowlisted_markdown', paths};
  } catch {
    // Missing objects, shallow/incoherent history, undecodable paths/blobs and Git errors.
    return full('git_or_text_error');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = classifyDocsOnly({
    eventName: process.env.GITHUB_EVENT_NAME,
    baseSha: process.env.DOCS_ONLY_BASE_SHA,
    headSha: process.env.DOCS_ONLY_HEAD_SHA,
    mergeSha: process.env.DOCS_ONLY_MERGE_SHA,
  });
  console.error(`Docs-only classifier: ${result.reason}`);
  // The workflow accepts only this exact token, after executing the base's copy.
  console.log(`docs_only=${result.docsOnly ? 'true' : 'false'}`);
}
