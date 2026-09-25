import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintExportPackage, type PackageSourceFingerprint } from "../../lib/patient/export-jobs-fingerprint";

const base = {
  format_version: "folio.patient-export.v2",
  exported_at: "2026-09-25T01:00:00Z",
  manifest: { lectura_iniciada_en: "2026-09-25T00:59:59Z", lectura_finalizada_en: "2026-09-25T01:00:00Z", categorias: [{ id: "documentos", cantidad: 1 }] },
  historia_clinica: { documentos: [{ id: "document-1", bytes_incluidos: false, created_at: "2026-08-01T00:00:00Z" }] },
};
const document: PackageSourceFingerprint = {
  kind: "document", sourceId: "document-1", sourceIndex: 0,
  storageBucket: "documentos-clinicos", storagePath: "org/patient/one.pdf",
  deletedAt: null, sizeBytes: 123, recordedSha256: "a".repeat(64),
};

test("fingerprint ignores only generated export timestamps", () => {
  const changed = structuredClone(base);
  changed.exported_at = "2026-09-25T05:00:00Z";
  changed.manifest.lectura_iniciada_en = "2026-09-25T04:59:59Z";
  changed.manifest.lectura_finalizada_en = "2026-09-25T05:00:00Z";
  assert.equal(fingerprintExportPackage(base, [document]), fingerprintExportPackage(changed, [document]));
  assert.equal(base.exported_at, "2026-09-25T01:00:00Z");
});

test("changed private path changes digest even when public JSON and count do not", () => {
  const original = fingerprintExportPackage(base, [document]);
  const changed = fingerprintExportPackage(base, [{ ...document, storagePath: "org/patient/two.pdf" }]);
  assert.notEqual(original, changed);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(original, /org|patient|pdf/);
});

test("clinical timestamps and source status remain load-bearing", () => {
  const original = fingerprintExportPackage(base, [document]);
  const changedClinical = structuredClone(base);
  changedClinical.historia_clinica.documentos[0].created_at = "2026-08-02T00:00:00Z";
  assert.notEqual(original, fingerprintExportPackage(changedClinical, [document]));
  assert.notEqual(original, fingerprintExportPackage(base, [{ ...document, kind: "withdrawn_document", deletedAt: "2026-09-01T00:00:00Z" }]));
});

test("canonical key/source order is stable and duplicate source identity fails", () => {
  const other: PackageSourceFingerprint = { ...document, sourceId: "document-2", storagePath: "org/patient/another.pdf" };
  assert.equal(fingerprintExportPackage(base, [document, other]), fingerprintExportPackage({
    historia_clinica: base.historia_clinica, manifest: base.manifest,
    exported_at: base.exported_at, format_version: base.format_version,
  }, [other, document]));
  assert.throws(() => fingerprintExportPackage(base, [document, { ...document, storagePath: "different" }]));
});
