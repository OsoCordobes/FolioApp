import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const org = "13400000-0000-4000-8000-000000000010";
const patient = "13400000-0000-4000-8000-000000000101";
const id = (n: number) => `13400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const document = { id: id(301), organization_id: org, paciente_id: patient,
  storage_bucket: "documentos-clinicos", storage_path: `documentos-clinicos/${org}/${patient}/one.pdf`,
  deleted_at: null, tamanio_bytes: 100, content_sha256: "a".repeat(64), mime_type: "application/pdf" };
const withdrawn = { ...document, id: id(302), storage_path: `documentos-clinicos/${org}/${patient}/old.pdf`,
  deleted_at: "2026-09-01T00:00:00Z" };
const participant = (name: string, sha: string) => ({ path: `consentimientos-firmados/${org}/${patient}/${name}.png`, sha256: sha,
  rol: "PACIENTE", persona_ref: patient, registrado_en: "2026-09-01T00:00:00Z", registrado_por: id(500) });
const consent = { id: id(401), organization_id: org, paciente_id: patient, firma_storage_path: null,
  participantes: [participant("a", "b".repeat(64)), participant("b", "c".repeat(64))], revocado_en: "2026-09-02T00:00:00Z" };
const legacy = { ...consent, id: id(402), firma_storage_path: `consentimientos-firmados/${org}/${patient}/legacy.pdf`,
  participantes: null, revocado_en: null };
const publicExport = {
  historia_clinica: {
    documentos: [document, withdrawn].map(d => ({ id: d.id, deleted_at: d.deleted_at,
      content_sha256: d.content_sha256, tamanio_bytes: d.tamanio_bytes, mime_type: d.mime_type,
      bytes_incluidos: false, download_url: d.deleted_at === null ? `/api/documentos/${d.id}/archivo` : null,
      disponibilidad: d.deleted_at === null ? "requiere_descarga_autorizada" : "retirado_sin_descarga" })),
    consentimientos_evidencia: [consent, legacy].map(c => ({ id: c.id, revocado_en: c.revocado_en,
      firmas: c.participantes?.map((p, index) => ({ rol: p.rol, persona_ref: p.persona_ref,
        registrado_en: p.registrado_en, registrado_por: p.registrado_por,
        content_sha256: p.sha256, bytes_incluidos: false,
        download_url: `/api/consentimientos/${c.id}/firma?participante=${index}` })) ?? [{
        rol: "NO_ACREDITADO_LEGADO", content_sha256: null, bytes_incluidos: false,
        download_url: `/api/consentimientos/${c.id}/firma`,
      }] })),
  },
};

function fixture(options: { rows?: Record<string, Record<string, unknown>[]>; lateFailure?: string } = {}) {
  const rows: Record<string, Record<string, unknown>[]> = options.rows ??
    { documento_clinico: [document, withdrawn], consentimiento: [consent, legacy] };
  const calls: string[] = [];
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const js = ts.transpileModule(readFileSync("lib/patient/export-jobs-sources.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, require: (name: string) => {
    if (name === "server-only") return {};
    if (name === "@/lib/db/errors") return { ok: (data: unknown) => ({ ok: true, data }),
      err: (code: string, message: string) => ({ ok: false, error: { code, message } }) };
    if (name === "@/lib/db/portal-consentimientos") return {
      firmaPathMatchesFicha: (path: string, o: string, p: string) =>
        path.startsWith(`consentimientos-firmados/${o}/${p}/`) && !path.includes(".."),
    };
    if (name === "@/lib/storage/clinical-files") return {
      CLINICAL_BUCKET: "documentos-clinicos", CLINICAL_LEGACY_MAX_BYTES: 50 * 1024 * 1024,
      clinicalObjectPath: (path: string, o: string, p: string) =>
        path.startsWith(`documentos-clinicos/${o}/${p}/`) && !path.includes("..") ? path : null,
    };
    if (name === "./verified-collection") return {
      readVerifiedClinicalCollection: async (fetch: (from: number, to: number) => Promise<{
        data: Record<string, unknown>[]; count: number; error: unknown;
      }>) => {
        const first = await fetch(0, 499);
        const second = await fetch(0, 499);
        if (first.error || second.error || first.count !== second.count ||
            JSON.stringify(first.data) !== JSON.stringify(second.data)) return { data: null, error: {} };
        return first;
      },
    };
    throw Error(`Unexpected import ${name}`);
  } });
  const client = { from(table: string) {
    calls.push(table);
    const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
      then(resolve: (value: unknown) => unknown) {
        const count = calls.filter(x => x === table).length;
        return Promise.resolve(resolve({ data: rows[table] ?? [], count: (rows[table] ?? []).length,
          error: options.lateFailure === table && count === 2 ? { message: "SECRET STORAGE PATH" } : null }));
      } };
    return query;
  } };
  return { calls, run: (exportValue: unknown = publicExport) =>
    exports.readPackageSourcePlan(client, org, patient, exportValue) };
}

test("source plan matches every public item, keeps withdrawn inventory-only and two signatures", async () => {
  const f = fixture();
  const result = await f.run() as { ok: boolean; data: Record<string, unknown>[] };
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 5);
  const retired = result.data.find(s => s.kind === "withdrawn_document");
  assert.equal(retired?.sourceId, withdrawn.id);
  const signatures = result.data.filter(s => s.kind === "signature" && s.sourceId === consent.id);
  assert.deepEqual(Array.from(signatures, s => s.sourceIndex), [0, 1]);
  const old = result.data.find(s => s.kind === "signature" && s.sourceId === legacy.id);
  assert.equal(old?.recordedSha256, null);
  assert.equal(f.calls.filter(x => x === "documento_clinico").length, 2);
  assert.equal(f.calls.filter(x => x === "consentimiento").length, 2);
});

test("late RLS read failure cannot yield a partial source plan or raw details", async () => {
  const f = fixture({ lateFailure: "consentimiento" });
  const result = await f.run() as { ok: boolean };
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|STORAGE PATH/);
});

test("missing public item, cross-tenant path, changed participant or status fails closed", async () => {
  const changed = structuredClone(publicExport);
  changed.historia_clinica.documentos.pop();
  const cases = [
    fixture(),
    fixture({ rows: { documento_clinico: [{ ...document, storage_path: `documentos-clinicos/${id(999)}/${patient}/one.pdf` }, withdrawn], consentimiento: [consent, legacy] } }),
    fixture({ rows: { documento_clinico: [document, withdrawn], consentimiento: [{ ...consent, participantes: [consent.participantes[0]] }, legacy] } }),
    fixture({ rows: { documento_clinico: [document, withdrawn], consentimiento: [{ ...consent, participantes: [{ ...consent.participantes[0], rol: "REPRESENTANTE" }, consent.participantes[1]] }, legacy] } }),
    fixture({ rows: { documento_clinico: [document, { ...withdrawn, deleted_at: null }], consentimiento: [consent, legacy] } }),
  ];
  assert.equal((await cases[0].run(changed) as { ok: boolean }).ok, false);
  for (const f of cases.slice(1)) assert.equal((await f.run() as { ok: boolean }).ok, false);
});
