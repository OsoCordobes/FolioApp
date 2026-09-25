import assert from "node:assert/strict";
import test from "node:test";
import { frozenPackageJson, packageChunks, packageFragmentPath, PACKAGE_CHUNK_BYTES, sha256 } from "../../lib/patient/export-jobs-chunks";

const job = "13600000-0000-4000-8000-000000000001";
const entry = "13600000-0000-4000-8000-000000000002";

test("private fragment keys derive only from job, entry and ordinal", () => {
  assert.equal(packageFragmentPath(job, entry, 12), `${job}/${entry}/00012.bin`);
  assert.throws(() => packageFragmentPath(job, "../patient", 0));
  assert.throws(() => packageFragmentPath(job, entry, 10000));
});

test("chunks stay within private bucket limit and reconstruct the source", () => {
  const source = Buffer.alloc(PACKAGE_CHUNK_BYTES + 9, 7);
  const chunks = packageChunks(source);
  assert.deepEqual(chunks.map(x => x.byteLength), [PACKAGE_CHUNK_BYTES, 9]);
  assert.equal(sha256(Buffer.concat(chunks)), sha256(source));
  assert.throws(() => packageChunks(Buffer.alloc(0)));
  assert.throws(() => packageChunks(Buffer.alloc(50 * 1024 * 1024 + 1)));
});

test("JSON replay freezes generated dates without changing clinical dates", () => {
  const exported = { exported_at: "changed", historia_clinica: { firmado_en: "2020-01-01" },
    manifest: { lectura_iniciada_en: "changed", lectura_finalizada_en: "changed", alcance: "v2" } };
  const frozen = JSON.parse(Buffer.from(frozenPackageJson(exported, "2026-09-25T03:00:00Z")).toString());
  assert.equal(frozen.exported_at, "2026-09-25T03:00:00.000Z");
  assert.equal(frozen.manifest.lectura_finalizada_en, frozen.exported_at);
  assert.equal(frozen.historia_clinica.firmado_en, "2020-01-01");
  assert.equal(exported.exported_at, "changed");
});
