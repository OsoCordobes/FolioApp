import assert from "node:assert/strict";
import test from "node:test";
import { readRetiredDocumentMetadata } from "../../lib/patient/export-retired-documents";
import type { createSupabaseServerClient } from "../../lib/supabase/server";

const org = "13800000-0000-4000-8000-000000000010";
const patient = "13800000-0000-4000-8000-000000000101";
const row = { id: "13800000-0000-4000-8000-000000000302", organization_id: org,
  paciente_id: patient, sesion_id: null, tipo: "INFORME_EXTERNO", mime_type: "application/pdf",
  tamanio_bytes: 200, content_sha256: "a".repeat(64), fecha_estudio: null,
  descripcion_cifrado: null, subido_por_id: null, consentimiento_id: null,
  created_at: "2026-09-25T00:00:00Z", deleted_at: "2026-09-25T01:00:00Z" };
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
function client(getPage: (call: number) => unknown) {
  let calls = 0;
  return { get calls() { return calls; }, value: { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "export_retired_document_metadata");
    assert.equal(args.p_org, org);assert.equal(args.p_patient, patient);
    assert.equal(args.p_limit, 500);
    return getPage(++calls);
  } } as unknown as Client };
}

test("two complete reads retain metadata without a private Storage identity", async () => {
  const c = client(() => ({ data: { total: 1, all_total: 2, rows: [row] }, error: null }));
  const result = await readRetiredDocumentMetadata(c.value, org, patient);
  assert.equal(result.ok, true);if (!result.ok) return;
  assert.equal(c.calls, 2);assert.equal(result.data.allTotal, 2);
  assert.equal(result.data.rows[0].id, row.id);
  assert.doesNotMatch(JSON.stringify(result), /storage_path|storage_bucket|download_url/);
});

test("late edit, late permission failure or extra private path aborts without partial metadata", async () => {
  const cases = [
    (call: number) => ({ data: { total: 1, all_total: 2, rows: [{ ...row, tamanio_bytes: call === 2 ? 201 : 200 }] }, error: null }),
    (call: number) => call === 2 ? { data: null, error: { message: "SECRET PHI" } } :
      { data: { total: 1, all_total: 2, rows: [row] }, error: null },
    () => ({ data: { total: 1, all_total: 2, rows: [{ ...row, storage_path: "SECRET PATH" }] }, error: null }),
  ];
  for (const make of cases) {
    const c = client(make);
    const result = await readRetiredDocumentMetadata(c.value, org, patient);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|storage_path|SECRET PATH/);
  }
});

test("changing the count of all documents between passes fails closed", async () => {
  const c = client(call => ({ data: { total: 1, all_total: call === 2 ? 3 : 2, rows: [row] }, error: null }));
  assert.equal((await readRetiredDocumentMetadata(c.value, org, patient)).ok, false);
});
