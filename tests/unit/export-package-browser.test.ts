import assert from "node:assert/strict";
import test from "node:test";
import { BrowserPackageFailure, packageArchiveTransport, prepareBrowserPackage,
  readSavedPackageOperation, savePackageOperation } from "../../lib/patient/export-package-browser";
import { PACKAGE_CAPACITY_MESSAGE } from "../../lib/patient/export-package-capacity";

const patientId = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const orgId = "10000000-0000-4000-8000-000000000003";
const entryId = "10000000-0000-4000-8000-000000000004";
const scope = { userId: "10000000-0000-4000-8000-000000000005", organizationId: orgId };
const operation = (state = "ready") => ({ job_id: jobId, paciente_id: patientId,
  organization_id: orgId, actor_user_id: scope.userId, state, revision: 2, expected_entries: 1,
  expires_at: new Date(Date.now() + 120_000).toISOString(), lease_until: null });
const json = (value: Record<string, unknown>, status = 200) => new Response(JSON.stringify({ ok: true, ...value }),
  { status, headers: { "content-type": "application/json" } });

function mockStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } } });
}

test("uncertain begin retains one operation and a confirmed absent lookup reuses it", async () => {
  mockStorage();
  const seen: string[] = [];
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (input, init) => {
    call++; seen.push(`${init?.method ?? "GET"} ${input}`);
    if (call === 1) throw Error("lost response");
    if (call === 2) return new Response(null, { status: 404 });
    return json({ operation: operation() }, 201);
  };
  try {
    await assert.rejects(prepareBrowserPackage(scope, patientId),
      (error: unknown) => error instanceof BrowserPackageFailure && error.code === "unconfirmed");
    const saved = readSavedPackageOperation(scope, patientId);
    assert.match(saved ?? "", /^[a-f0-9-]{36}$/i);
    const result = await prepareBrowserPackage(scope, patientId);
    assert.equal(result.bound.operationId, saved);
    assert.equal(seen.length, 3);
    assert.match(seen[1], new RegExp(`/operations/${saved}\\?patientId=`));
    assert.equal(seen[0], "POST /api/patient/export-package");
    assert.equal(seen[2], "POST /api/patient/export-package");
  } finally { globalThis.fetch = original; }
});

test("redirect to login is auth loss and never creates a new operation", async () => {
  mockStorage();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null,
    { status: 307, headers: { location: "/login" } }); };
  try {
    await assert.rejects(prepareBrowserPackage(scope, patientId),
      (error: unknown) => error instanceof BrowserPackageFailure && error.code === "auth");
    assert.equal(calls, 1);
    const saved = readSavedPackageOperation(scope, patientId);
    assert.ok(saved);
    await assert.rejects(prepareBrowserPackage(scope, patientId),
      (error: unknown) => error instanceof BrowserPackageFailure && error.code === "auth");
    assert.equal(calls, 2);
    assert.equal(readSavedPackageOperation(scope, patientId), saved);
  } finally { globalThis.fetch = original; }
});

test("network failure in status does not submit another begin", async () => {
  mockStorage();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("network"); };
  try {
    await assert.rejects(prepareBrowserPackage(scope, patientId));
    await assert.rejects(prepareBrowserPackage(scope, patientId));
    assert.equal(calls, 2);
    assert.ok(readSavedPackageOperation(scope, patientId));
  } finally { globalThis.fetch = original; }
});

test("fragment request binds patient, operation, job, entry and ordinal and caps bytes", async () => {
  const original = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async input => {
    requested = String(input);
    return new Response(new Uint8Array([1, 2, 3]), { headers: {
      "content-type": "application/octet-stream", "content-length": "3",
      "x-folio-fragment-sha256": "a".repeat(64),
      "x-folio-file-sha256": "b".repeat(64), "x-folio-fragment-count": "1",
    } });
  };
  try {
    const transport = packageArchiveTransport({ patientId, operationId: orgId, jobId });
    const value = await transport.fragment({ entry_id: entryId } as never, 0);
    assert.deepEqual([...value.bytes], [1, 2, 3]);
    assert.equal(requested, `/api/patient/export-package/${jobId}/entries/${entryId}/fragments/0?patientId=${patientId}&operationId=${orgId}`);
  } finally { globalThis.fetch = original; }
});

test("saved operation is isolated by user, organization and patient", () => {
  mockStorage();
  savePackageOperation(scope, patientId, jobId);
  assert.equal(readSavedPackageOperation(scope, patientId), jobId);
  assert.equal(readSavedPackageOperation({ ...scope, userId: entryId }, patientId), null);
  assert.equal(readSavedPackageOperation({ ...scope, organizationId: entryId }, patientId), null);
  assert.equal(readSavedPackageOperation(scope, entryId), null);
});

test("operation response for a different principal is not accepted as prepared", async () => {
  mockStorage();
  const original = globalThis.fetch;
  globalThis.fetch = async () => json({ operation: { ...operation(), actor_user_id: entryId } }, 201);
  try {
    await assert.rejects(prepareBrowserPackage(scope, patientId),
      (error: unknown) => error instanceof BrowserPackageFailure && error.code === "unconfirmed");
  } finally { globalThis.fetch = original; }
});

test("only the exact bounded capacity response is classified as impossible volume", async () => {
  mockStorage();
  const original = globalThis.fetch;
  let exact = true;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: {
    code: "capacity", message: exact ? PACKAGE_CAPACITY_MESSAGE : "private arbitrary body",
  } }), { status: 413, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(prepareBrowserPackage(scope, patientId),
      (error: unknown) => error instanceof BrowserPackageFailure && error.code === "capacity");
    exact = false;
    await assert.rejects(prepareBrowserPackage(scope, patientId),
      (error: unknown) => error instanceof BrowserPackageFailure && error.code === "unconfirmed");
  } finally { globalThis.fetch = original; }
});
