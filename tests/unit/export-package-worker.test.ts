import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { minimumPackageProgressCalls, PACKAGE_CAPACITY_MESSAGE,
  PACKAGE_MAX_PROGRESS_CALLS } from "../../lib/patient/export-package-capacity";

const jobId = "13600000-0000-4000-8000-000000000001";
const entryId = "13600000-0000-4000-8000-000000000002";
const actor = "13600000-0000-4000-8000-000000000003";
const member = "13600000-0000-4000-8000-000000000004";
const org = "13600000-0000-4000-8000-000000000005";
const patient = "13600000-0000-4000-8000-000000000006";
const token = "13600000-0000-4000-8000-000000000007";
const session = { userId: actor, memberId: member, organizationId: org };
const hash = "a".repeat(64);

function fixture(chunkCount = 2, sourcePlan: Array<{ kind: "document" | "signature" | "withdrawn_document";
  sizeBytes: number | null }> | null = []) {
  let version = "v1", finishCalls = 0, reads = 0, builds = 0, beginCalls = 0;
  const staged = new Map<number, string>();
  const job = { state: "leased", revision: 1, paciente_id: patient,
    source_fingerprint: "v1", actor_user_id: actor, actor_member_id: member,
    organization_id: org };
  const service = { rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "export_package_renew") return { data: true, error: null };
    if (name === "export_package_entry_register") return { data: [{ entry_id: entryId, registered_at: "2026-09-25T03:00:00Z" }], error: null };
    if (name === "export_package_fragment_read") return { data: [...staged].map(([ordinal, sha256]) =>
      ({ ordinal, bytes: 1, sha256 })), error: null };
    if (name === "export_package_fragment_register") { staged.set(args.p_ordinal as number, args.p_sha as string); return { data: true, error: null }; }
    if (name === "export_package_entry_verify") return { data: true, error: null };
    if (name === "export_package_inventory_read") {
      reads++;
      version = "v2"; // Source edits during this late ledger read.
      return { data: [{ entry_id: entryId, kind: "json", source_id: patient,
        source_index: 0, expected_fragments: 1, source_hash_kind: "not_applicable",
        source_sha256: null, computed_sha256: hash, verified_at: "2026-09-25T03:00:00Z",
        registered_at: "2026-09-25T03:00:00Z" }], error: null };
    }
    if (name === "export_package_finish") { finishCalls++; return { data: true, error: null }; }
    throw Error(`Unexpected RPC ${name}`);
  } };
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () =>
    ({ data: { nombre: "Organización" }, error: null }) }) }) }) };
  const js = ts.transpileModule(readFileSync("lib/patient/export-jobs-worker.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  runInNewContext(js, { exports, AbortSignal, Uint8Array, require: (name: string) => {
    if (name === "server-only") return {};
    if (name === "@/lib/db/errors") return { ok: (data: unknown) => ({ ok: true, data }),
      err: (code: string, message: string) => ({ ok: false, error: { code, message } }) };
    if (name === "@/lib/storage/clinical-files") return { CLINICAL_LEGACY_MAX_BYTES: 50 * 1024 * 1024 };
    if (name === "@/lib/supabase/server") return { createSupabaseServiceClient: () => service };
    if (name === "./export-builder") return { buildPatientExport: async () => {
      builds++;
      return { ok: true, data: { version, manifest: {} } };
    } };
    if (name === "./export-authorization") return { revalidateClinicalDelivery: async () => ({ ok: true }) };
    if (name === "./export-jobs-chunks") return { PACKAGE_CHUNK_BYTES: 3145728,
      frozenPackageJson: () => new Uint8Array([1, 2]),
      packageChunks: () => Array.from({ length: chunkCount }, (_, index) => new Uint8Array([index + 1])),
      sha256: () => hash };
    if (name === "./export-jobs-fingerprint") return { fingerprintExportPackage: (value: { version: string }) => value.version };
    if (name === "./export-jobs") return { readExportPackageJob: async () => ({ ok: true, data: job }),
      beginExportPackageJob: async () => { beginCalls++; return { ok: true, data: jobId }; } };
    if (name === "./export-jobs-sources") return { readPackageSourcePlan: async () => sourcePlan === null
      ? { ok: false, error: { code: "db_error", message: "Inventario ilegible" } }
      : { ok: true, data: sourcePlan } };
    if (name === "./export-package-capacity") return { PACKAGE_MAX_PROGRESS_CALLS,
      PACKAGE_CAPACITY_MESSAGE, minimumPackageProgressCalls };
    if (name === "./export-jobs-storage") return { putVerifiedFragment: async (_: unknown, _j: string, _e: string, ordinal: number) =>
      ({ bytes: 1, sha256: hash, ordinal }) };
    if (name === "./export-jobs-storage-client") return { privateExportBucket: () => ({}) };
    throw Error(`Unexpected import ${name}`);
  } });
  return { client, state: () => ({ finishCalls, reads, builds, beginCalls, staged: staged.size }),
    begin: () => exports.beginVerifiedExportPackage(client, session, patient, token),
    stage: (key: { kind: string; sourceId: string; sourceIndex: number }) =>
      exports.stageExportPackageEntry(client, session, jobId, token, 1, key),
    finish: () => exports.finishVerifiedExportPackage(client, session, jobId, token, 1) };
}

test("a changed source during inventory pagination prevents READY", async () => {
  const f = fixture(1);
  const result = await f.finish() as { ok: boolean };
  assert.equal(result.ok, false);
  assert.equal(f.state().reads, 1);
  assert.equal(f.state().builds, 2);
  assert.equal(f.state().finishCalls, 0);
});

test("mathematically impossible volume rejects before job creation or byte I/O", async () => {
  const possible = Array.from({ length: 1764 }, () => ({ kind: "document" as const,
    sizeBytes: 50 * 1024 * 1024 }));
  assert.ok(minimumPackageProgressCalls(possible, 3 * 1024 * 1024)! <= PACKAGE_MAX_PROGRESS_CALLS);
  const nearLimit = fixture(1, possible);
  assert.equal((await nearLimit.begin() as { ok: boolean }).ok, true);
  assert.equal(nearLimit.state().beginCalls, 1);
  const sources = Array.from({ length: 1800 }, () => ({ kind: "document" as const,
    sizeBytes: 50 * 1024 * 1024 }));
  assert.ok(minimumPackageProgressCalls(sources, 3 * 1024 * 1024)! > PACKAGE_MAX_PROGRESS_CALLS);
  const f = fixture(1, sources);
  const result = await f.begin() as { ok: boolean; error: { code: string; message: string } };
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation");
  assert.equal(result.error.message, PACKAGE_CAPACITY_MESSAGE);
  assert.equal(f.state().beginCalls, 0);
  assert.equal(f.state().staged, 0);
});

test("unreadable plan remains uncertain and is never recategorized as capacity", async () => {
  const f = fixture(1, null);
  const result = await f.begin() as { ok: boolean; error: { code: string } };
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "db_error");
  assert.equal(f.state().beginCalls, 0);
});

test("one fragment per call resumes from registered fragments, and bad JSON index fails before IO", async () => {
  const f = fixture();
  const invalid = await f.stage({ kind: "json", sourceId: patient, sourceIndex: 1 }) as { ok: boolean };
  assert.equal(invalid.ok, false);
  assert.equal(f.state().staged, 0);
  const first = await f.stage({ kind: "json", sourceId: patient, sourceIndex: 0 }) as
    { ok: boolean; data: { complete: boolean; remainingFragments: number } };
  assert.equal(first.ok, true);
  assert.equal(first.data.complete, false);
  assert.equal(first.data.remainingFragments, 1);
  assert.equal(f.state().staged, 1);
  const second = await f.stage({ kind: "json", sourceId: patient, sourceIndex: 0 }) as
    { ok: boolean; data: { complete: boolean; remainingFragments: number } };
  assert.equal(second.ok, true);
  assert.equal(second.data.complete, true);
  assert.equal(f.state().staged, 2);
});
