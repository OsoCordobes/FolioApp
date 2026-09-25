import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const job = "13600000-0000-4000-8000-000000000001";
const entry = "13600000-0000-4000-8000-000000000002";
const token = "13600000-0000-4000-8000-000000000003";

function fixture(entryIds = [entry]) {
  const objects = new Map<string, string>();
  const calls: string[] = [];
  const listedPrefixes: string[] = [];
  const emptyScans = new Map(entryIds.map(id => [id, 0]));
  const cleaned = new Set<string>();
  let confirmed = false;
  const service = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name === "export_package_cleanup_renew") return { data: true, error: null };
    if (name === "export_package_cleanup_entry_read") return { data: entryIds
      .filter(id => !cleaned.has(id)).map(id => ({ entry_id: id, expected_fragments: 1 })), error: null };
    if (name === "export_package_cleanup_entry_confirm") {
      const id = String(args.p_entry);
      if (args.p_empty === false) { emptyScans.set(id, 0); return { data: false, error: null }; }
      const scans = (emptyScans.get(id) ?? 0) + 1;
      emptyScans.set(id, scans);
      if (scans >= 2) cleaned.add(id);
      return { data: cleaned.has(id), error: null };
    }
    if (name === "export_package_cleanup_confirm") {
      if (cleaned.size !== entryIds.length) throw Error("premature cleanup");
      confirmed = true;
      return { data: true, error: null };
    }
    throw Error(`Unexpected RPC ${name}`);
  } };
  const bucket = {
    list: async (prefix: string) => { listedPrefixes.push(prefix); return ({ error: null, data: [...objects]
      .filter(([path]) => path.startsWith(`${prefix}/`))
      .map(([path, id]) => ({ name: path.slice(prefix.length + 1), id })) }); },
    remove: async (paths: string[]) => {
      for (const path of paths) objects.delete(path);
      return { error: null };
    },
  };
  const js = ts.transpileModule(readFileSync("lib/patient/export-jobs-cleanup.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  runInNewContext(js, { exports, require: (name: string) => {
    if (name === "server-only") return {};
    if (name === "@/lib/db/errors") return { ok: (data: unknown) => ({ ok: true, data }),
      err: (code: string, message: string) => ({ ok: false, error: { code, message } }) };
    if (name === "@/lib/supabase/server") return { createSupabaseServiceClient: () => service };
    if (name === "./export-jobs-storage-client") return { privateExportBucket: () => bucket };
    throw Error(`Unexpected import ${name}`);
  } });
  return { objects, calls, listedPrefixes, state: () => ({ cleaned: cleaned.size === entryIds.length, confirmed }),
    step: () => exports.cleanupExportPackageStep(job, token, 1) };
}

test("deferred upload after first empty scan is removed and restarts stable-empty window", async () => {
  const f = fixture();
  const first = await f.step() as { ok: boolean; data: { complete: boolean } };
  assert.equal(first.ok, true);
  assert.equal(first.data.complete, false);
  assert.equal(f.state().confirmed, false);
  const path = `${job}/${entry}/00000.bin`;
  f.objects.set(path, "object-id"); // upload that completed after the first scan
  const second = await f.step() as { ok: boolean; data: { complete: boolean } };
  assert.equal(second.ok, true);
  assert.equal(second.data.complete, false);
  assert.equal(f.objects.has(path), false);
  assert.equal(f.state().confirmed, false);
  const third = await f.step() as { ok: boolean; data: { complete: boolean } };
  assert.equal(third.ok, true);
  assert.equal(third.data.complete, true);
  assert.equal(f.state().confirmed, true);
  assert.equal(f.calls.filter(x => x === "export_package_cleanup_entry_confirm").length, 4);
});

test("one maintenance invocation touches at most one entry even when SQL returns ten", async () => {
  const second = "13600000-0000-4000-8000-000000000004";
  const f = fixture([entry, second]);
  const result = await f.step() as { ok: boolean; data: { complete: boolean } };
  assert.equal(result.ok, true);
  assert.equal(result.data.complete, false);
  assert.equal(f.state().confirmed, false);
  assert.ok(f.listedPrefixes.length > 0);
  assert.ok(f.listedPrefixes.every(prefix => prefix === `${job}/${entry}`));
});

test("unexpected nested object prevents deletion and confirmation", async () => {
  const f = fixture();
  f.objects.set(`${job}/${entry}/../foreign.bin`, "object-id");
  const result = await f.step() as { ok: boolean };
  assert.equal(result.ok, false);
  assert.equal(f.state().confirmed, false);
  assert.equal(f.objects.size, 1);
  assert.doesNotMatch(JSON.stringify(result), /foreign\.bin|object-id/);
});
