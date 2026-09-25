import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const id = (n: number) => `14000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), member = id(11), org = id(10), patient = id(101);
const jobId = id(200), operationId = id(201), entryId = id(301), documentId = id(302);
const bytes = Buffer.alloc(3 * 1024 * 1024, 7);
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const computed = digest(bytes);
const sha = computed;
const session = { userId: actor, memberId: member, organizationId: org,
  role: "OWNER", esColegiado: true };
const bound = { patientId: patient, operationId, jobId };
const future = () => new Date(Date.now() + 60000).toISOString();

function fixture() {
  let withdrawn = false, moved = false, revoked = false, expiresAt = future(), rows: unknown[] | null = null;
  let sourceBytes = bytes.byteLength;
  let state = "ready", leaseUntil: string | null = null;
  let downloadedBytes: Uint8Array = bytes;
  let onDownload = () => {};
  let operationError = false, operationAbsent = false, operationMalformed = false;
  const calls: string[] = [];
  let downloads = 0;
  const source = () => ({ kind: withdrawn ? "withdrawn_document" : "document",
    sourceId: documentId, sourceIndex: 0, storageBucket: withdrawn ? null : "clinical",
    storagePath: withdrawn ? null : "private/path", deletedAt: withdrawn ? "2026-09-25" : null,
    sizeBytes: sourceBytes, recordedSha256: sha, mimeType: "application/pdf" });
  const operation = () => ({ job_id: jobId, organization_id: org, paciente_id: patient,
    actor_user_id: actor, actor_member_id: member, source_fingerprint: "a".repeat(64),
    state, revision: 2, expected_entries: 2, expires_at: expiresAt,
    lease_until: leaseUntil });
  const page = (size = bytes.byteLength, fragments = 1) => ({ expected_entries: 2,
    expires_at: expiresAt, prepared_at: "2026-09-25T03:00:00Z",
    entry_id: entryId, kind: "document", source_id: documentId, source_index: 0,
    expected_fragments: fragments, actual_fragments: fragments, total_bytes: size,
    source_hash_kind: "recorded", source_sha256: sha,
    computed_sha256: computed, registered_at: "2026-09-25T03:00:00Z" });
  const fragment = () => ({ entry_id: entryId, kind: "document", source_id: documentId,
    source_index: 0, expected_fragments: 1, source_hash_kind: "recorded",
    source_sha256: sha, computed_sha256: computed,
    fragment_bytes: bytes.byteLength, fragment_sha256: computed, expires_at: expiresAt });
  const service = { rpc: async (name: string) => {
    calls.push(name);
    if (name === "export_package_operation_read") return { data: operationAbsent ? [] :
      operationMalformed ? { job_id: jobId } : [operation()],
      error: operationError ? { message: "SECRET bucket and SQL body" } : null };
    if (name === "export_package_delivery_page") return { data: rows ?? [page()], error: null };
    if (name === "export_package_delivery_fragment") return { data: [fragment()], error: null };
    throw Error(`unexpected rpc ${name}`);
  } };
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () =>
    ({ data: { nombre: "Synthetic" }, error: null }) }) }) }) };
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const js = ts.transpileModule(readFileSync("lib/patient/export-package-delivery.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, Buffer, Date, Map, Set, Uint8Array, AbortSignal,
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name === "@/lib/db/errors") return { ok: (data: unknown) => ({ ok: true, data }),
        err: (code: string, message: string) => ({ ok: false, error: { code, message } }) };
      if (name === "@/lib/supabase/server") return { createSupabaseServiceClient: () => service };
      if (name === "./export-builder") return { buildPatientExport: async () =>
        ({ ok: true, data: { version: withdrawn ? "withdrawn" : "original" } }) };
      if (name === "./export-authorization") return { revalidateClinicalDelivery: async () =>
        revoked ? { ok: false, error: { code: "mfa_required", message: "MFA required" } } :
          { ok: true, data: undefined } };
      if (name === "./export-jobs-chunks") return { PACKAGE_CHUNK_BYTES: 3145728,
        packageFragmentPath: () => "derived-only", sha256: digest };
      if (name === "./export-jobs-fingerprint") return { fingerprintExportPackage: (value: { version: string }) =>
        value.version === "original" ? "a".repeat(64) : "c".repeat(64) };
      if (name === "./export-jobs") return { readExportPackageJob: async () =>
        ({ ok: true, data: { ...operation(), paciente_id: patient } }),
        claimExportPackageJob: async () => { calls.push("claim"); return { ok: true, data: { leaseToken: id(400), revision: 3 } }; } };
      if (name === "./export-jobs-worker") return { beginVerifiedExportPackage: async () =>
        ({ ok: true, data: jobId }), stageExportPackageEntry: async () => ({ ok: true, data: {} }),
      finishVerifiedExportPackage: async () => ({ ok: true, data: undefined }) };
      if (name === "./export-jobs-sources") return { readPackageSourcePlan: async () =>
        ({ ok: true, data: moved ? [] : [source()] }) };
      if (name === "./export-jobs-storage-client") return { privateExportBucket: () => ({
        download: async () => { downloads++; onDownload(); return { data: new Blob([Uint8Array.from(downloadedBytes)]), error: null }; },
      }) };
      throw Error(`unexpected import ${name}`);
    }, Blob });
  return { client, exports, calls, page, source, operation,
    get downloads() { return downloads; },
    withdraw: () => { withdrawn = true; }, moveSource: () => { moved = true; },
    revoke: () => { revoked = true; },
    expire: () => { expiresAt = new Date(Date.now() - 1000).toISOString(); },
    sourceSize: (size: number) => { sourceBytes = size; },
    downloadBytes: (value: Uint8Array) => { downloadedBytes = value; },
    activeLease: () => { state = "leased"; leaseUntil = future(); },
    operationError: () => { operationError = true; },
    operationAbsent: () => { operationAbsent = true; },
    operationMalformed: () => { operationMalformed = true; },
    onDownload: (callback: () => void) => { onDownload = callback; },
    pageRows: (value: unknown[]) => { rows = value; } };
}

test("operation lookup distinguishes service failure from confirmed absence", async () => {
  const f = fixture();
  f.operationError();
  const uncertain = await f.exports.readPackageOperation(f.client, session, patient, operationId) as
    { ok: boolean; error: { code: string } };
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.error.code, "db_error");
  assert.doesNotMatch(JSON.stringify(uncertain), /SECRET|bucket|SQL/);
  const absent = fixture();
  absent.operationAbsent();
  const missing = await absent.exports.readPackageOperation(absent.client, session, patient, operationId) as
    { ok: boolean; error: { code: string } };
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not_found");
  const malformed = fixture();
  malformed.operationMalformed();
  const uncertainShape = await malformed.exports.readPackageOperation(malformed.client,
    session, patient, operationId) as { ok: boolean; error: { code: string } };
  assert.equal(uncertainShape.ok, false);
  assert.equal(uncertainShape.error.code, "db_error");
});

test("an operation lookup binds actor, member, organization, patient and operation", async () => {
  const f = fixture();
  const valid = await f.exports.readPackageOperation(f.client, session, patient, operationId, jobId) as
    { ok: boolean };
  assert.equal(valid.ok, true);
  const wrong = await f.exports.readPackageOperation(f.client,
    { ...session, memberId: id(99) }, patient, operationId, jobId) as { ok: boolean };
  assert.equal(wrong.ok, false);
  const otherPatient = await f.exports.readPackageOperation(f.client, session,
    id(199), operationId, jobId) as { ok: boolean };
  assert.equal(otherPatient.ok, false);
});

test("manifest is exact, bounded, and withheld after a source is withdrawn", async () => {
  const f = fixture();
  const good = await f.exports.readPackageManifestPage(f.client, session, bound, 1, 1) as
    { ok: boolean; data: { entries: unknown[]; expectedEntries: number } };
  assert.equal(good.ok, true);
  assert.equal(good.data.expectedEntries, 2);
  assert.equal(good.data.entries.length, 1);
  f.pageRows([]);
  const missing = await f.exports.readPackageManifestPage(f.client, session, bound, 1, 1) as { ok: boolean };
  assert.equal(missing.ok, false);
  f.withdraw();
  const retired = await f.exports.readPackageManifestPage(f.client, session, bound, 1, 1) as { ok: boolean };
  assert.equal(retired.ok, false);
});

test("50 MiB legacy metadata requires 17 bounded fragments, never 18 or oversize", async () => {
  const f = fixture();
  f.sourceSize(50 * 1024 * 1024);
  f.pageRows([{ ...f.page(50 * 1024 * 1024, 17) }]);
  const valid = await f.exports.readPackageManifestPage(f.client, session, bound, 1, 1) as { ok: boolean };
  assert.equal(valid.ok, true);
  f.pageRows([{ ...f.page(50 * 1024 * 1024, 18) }]);
  const extra = await f.exports.readPackageManifestPage(f.client, session, bound, 1, 1) as { ok: boolean };
  assert.equal(extra.ok, false);
  f.pageRows([{ ...f.page(50 * 1024 * 1024 + 1, 18) }]);
  const oversize = await f.exports.readPackageManifestPage(f.client, session, bound, 1, 1) as { ok: boolean };
  assert.equal(oversize.ok, false);
});

test("fragment hash is checked and post-read withdrawal, MFA loss or TTL denies bytes", async () => {
  for (const change of ["withdraw", "moveSource", "revoke", "expire"] as const) {
    const f = fixture();
    f.onDownload(() => f[change]());
    const result = await f.exports.readPackageFragment(f.client, session, bound, entryId, 0) as
      { ok: boolean; data?: { bytes: Uint8Array } };
    assert.equal(result.ok, false, change);
    assert.equal(result.data, undefined);
    assert.equal(f.downloads, 1);
  }
});

test("revocation during the audit callback prevents fragment bytes", async () => {
  const f = fixture();
  const result = await f.exports.readPackageFragment(f.client, session, bound, entryId, 0,
    async () => { f.revoke(); }) as { ok: boolean; data?: unknown };
  assert.equal(result.ok, false);
  assert.equal(result.data, undefined);
});

test("one 3 MiB verified fragment is returned; changed bytes fail before delivery", async () => {
  const f = fixture();
  const good = await f.exports.readPackageFragment(f.client, session, bound, entryId, 0) as
    { ok: boolean; data: { bytes: Uint8Array; sha256: string } };
  assert.equal(good.ok, true);
  assert.equal(good.data.bytes.byteLength, 3 * 1024 * 1024);
  assert.equal(good.data.sha256, computed);
  f.downloadBytes(Buffer.alloc(3 * 1024 * 1024, 8));
  const changed = await f.exports.readPackageFragment(f.client, session, bound, entryId, 0) as
    { ok: boolean; data?: unknown };
  assert.equal(changed.ok, false);
  assert.equal(changed.data, undefined);
});

test("withdrawn source before read cannot access a private fragment", async () => {
  const f = fixture();
  f.withdraw();
  const result = await f.exports.readPackageFragment(f.client, session, bound, entryId, 0) as { ok: boolean };
  assert.equal(result.ok, false);
  assert.equal(f.downloads, 0);
});

test("an active lease with lost token is not stolen; caller must inspect and wait", async () => {
  const f = fixture();
  f.activeLease();
  const claim = await f.exports.claimPackageOperation(f.client, session, bound, 2) as { ok: boolean };
  assert.equal(claim.ok, false);
  assert.equal(f.calls.includes("claim"), false);
});
