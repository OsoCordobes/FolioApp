import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import { writeVerifiedPackageArchive, PackageArchiveFailure,
  type PackageArchiveEntry, type PackageArchivePage } from "../../lib/patient/export-package-archive";

const id = (n: number) => `14000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), byte =>
  byte.toString(16).padStart(2, "0")).join("");
const json = new TextEncoder().encode(JSON.stringify({ historia_clinica: { documentos: [
  { id: id(2), mime_type: "application/pdf", bytes_incluidos: false },
] } }));
const document = new Uint8Array(3 * 1024 * 1024 + 31).fill(31);
const signature = new Uint8Array([1, 2, 3, 4]);
const future = () => new Date(Date.now() + 120_000).toISOString();

function fixture() {
  const preparedAt = "2026-09-25T04:00:00.000Z", expiresAt = future();
  const source = [
    { kind: "json", source_id: id(1), source_index: 0, bytes: json },
    { kind: "document", source_id: id(2), source_index: 0, bytes: document },
    { kind: "signature", source_id: id(3), source_index: 1, bytes: signature },
    { kind: "withdrawn_document", source_id: id(4), source_index: 0, bytes: null },
  ] as const;
  const entries: PackageArchiveEntry[] = source.map((value, ordinal) => ({
    entry_id: id(100 + ordinal), kind: value.kind, source_id: value.source_id,
    source_index: value.source_index,
    expected_fragments: value.bytes ? Math.ceil(value.bytes.byteLength / (3 * 1024 * 1024)) : 0,
    total_bytes: value.bytes?.byteLength ?? 0,
    source_hash_kind: value.kind === "json" ? "not_applicable" :
      value.kind === "withdrawn_document" ? "not_recorded" : "recorded",
    source_sha256: value.kind === "json" || value.kind === "withdrawn_document" ? null : digest(value.bytes!),
    computed_sha256: value.bytes ? digest(value.bytes) : null, registered_at: preparedAt,
  }));
  const chunks: Uint8Array[] = [];
  let closed = false, aborted = false, pageReads = 0, fragments = 0, changedFinal = false;
  const page = async (offset: number, limit: number): Promise<PackageArchivePage> => {
    pageReads++;
    const rows = entries.slice(offset, offset + limit);
    return { format: "folio.export-package.v1",
      captureMeaning: "preparation_time_not_global_snapshot",
      expectedEntries: entries.length, expiresAt, preparedAt,
      entries: changedFinal && pageReads > 1 ? rows.map(row => ({ ...row,
        computed_sha256: row.kind === "json" ? "a".repeat(64) : row.computed_sha256 })) : rows };
  };
  const fragment = async (entry: PackageArchiveEntry, ordinal: number) => {
    fragments++;
    const original = source.find(item => item.source_id === entry.source_id)!.bytes!;
    const bytes = original.subarray(ordinal * 3 * 1024 * 1024,
      (ordinal + 1) * 3 * 1024 * 1024);
    return { bytes, sha256: digest(bytes), fileSha256: digest(original),
      totalFragments: Math.ceil(original.byteLength / (3 * 1024 * 1024)) };
  };
  const sink = {
    async write(value: Uint8Array) { chunks.push(Uint8Array.from(value)); },
    async close() { closed = true; },
    async abort() { aborted = true; },
  };
  return { entries, page, fragment, sink, chunks,
    get closed() { return closed; }, get aborted() { return aborted; },
    get pageReads() { return pageReads; }, get fragments() { return fragments; },
    changeFinal() { changedFinal = true; } };
}

test("standard TAR reconstructs JSON, two-fragment document and signature; withdrawn remains metadata only", async () => {
  const f = fixture();
  const result = await writeVerifiedPackageArchive(f, f.sink);
  assert.equal(f.closed, true);
  assert.equal(f.aborted, false);
  assert.equal(f.pageReads, 2);
  assert.equal(f.fragments, 4);
  const tar = Buffer.concat(f.chunks);
  assert.equal(result.archiveSha256, digest(tar));
  const folder = mkdtempSync(join(tmpdir(), "folio-tar-test-"));
  const archive = join(folder, "entrega.tar");
  try {
    writeFileSync(archive, tar);
    const names = execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
    assert.deepEqual(names, ["LEEME.txt", "historia.json", `documentos/${id(2)}.pdf`,
      `firmas/${id(3)}-1.bin`, "manifiesto.jsonl"]);
    const extracted = (name: string) => execFileSync("tar", ["-xOf", archive, name],
      { maxBuffer: 4 * 1024 * 1024 });
    assert.deepEqual(extracted("historia.json"), Buffer.from(json));
    assert.deepEqual(extracted(`documentos/${id(2)}.pdf`), Buffer.from(document));
    assert.deepEqual(extracted(`firmas/${id(3)}-1.bin`), Buffer.from(signature));
    const manifest = extracted("manifiesto.jsonl").toString("utf8");
    assert.match(manifest, /"status":"retirado_sin_bytes"/);
    assert.doesNotMatch(manifest, /storage_path|bucket|leaseToken/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("a changed final inventory aborts the uncommitted archive", async () => {
  const f = fixture(); f.changeFinal();
  await assert.rejects(() => writeVerifiedPackageArchive(f, f.sink), (error: unknown) => {
    assert.ok(error instanceof PackageArchiveFailure);
    assert.equal(error.code, "source_changed");
    assert.equal(error.abortConfirmed, true);
    return true;
  });
  assert.equal(f.closed, false);
  assert.equal(f.aborted, true);
});

test("a corrupt fragment aborts before the archive becomes visible", async () => {
  const f = fixture();
  const original = f.fragment;
  f.fragment = async (entry, ordinal) => {
    const data = await original(entry, ordinal);
    return entry.kind === "document" && ordinal === 1 ? { ...data, sha256: "0".repeat(64) } : data;
  };
  await assert.rejects(() => writeVerifiedPackageArchive(f, f.sink), (error: unknown) => {
    assert.ok(error instanceof PackageArchiveFailure);
    assert.equal(error.code, "fragment_mismatch");
    return true;
  });
  assert.equal(f.closed, false);
  assert.equal(f.aborted, true);
});

test("entry cap fails before a fragment read and never closes the writer", async () => {
  const f = fixture();
  f.page = async () => ({ format: "folio.export-package.v1",
    captureMeaning: "preparation_time_not_global_snapshot",
    expectedEntries: 10_001, expiresAt: future(), preparedAt: "2026-09-25T04:00:00.000Z",
    entries: [f.entries[0]] });
  await assert.rejects(() => writeVerifiedPackageArchive(f, f.sink), PackageArchiveFailure);
  assert.equal(f.fragments, 0);
  assert.equal(f.closed, false);
  assert.equal(f.aborted, true);
});

test("inventory metadata above 4 GiB passes TAR framing preflight without allocating source bytes", async () => {
  const f = fixture();
  const documents: PackageArchiveEntry[] = Array.from({ length: 85 }, (_, index) => ({
    entry_id: id(1000 + index), kind: "document", source_id: id(2000 + index),
    source_index: 0, expected_fragments: 17, total_bytes: 50 * 1024 * 1024,
    source_hash_kind: "recorded", source_sha256: "a".repeat(64),
    computed_sha256: "a".repeat(64), registered_at: "2026-09-25T04:00:00.000Z",
  }));
  const entries = [f.entries[0], ...documents];
  const expiresAt = future();
  let requestedDocument = false;
  f.page = async (offset, limit) => ({ format: "folio.export-package.v1",
    captureMeaning: "preparation_time_not_global_snapshot",
    expectedEntries: entries.length, expiresAt, preparedAt: "2026-09-25T04:00:00.000Z",
    entries: entries.slice(offset, offset + limit) });
  const original = f.fragment;
  f.fragment = async (entry, ordinal) => {
    if (entry.kind === "document") { requestedDocument = true; throw Error("synthetic_no_bytes"); }
    return original(entry, ordinal);
  };
  await assert.rejects(() => writeVerifiedPackageArchive(f, f.sink),
    (error: unknown) => error instanceof PackageArchiveFailure && error.code === "unconfirmed");
  assert.equal(requestedDocument, true);
  assert.equal(f.closed, false);
});
