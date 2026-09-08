import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const actualRequire = createRequire(import.meta.url);
type Action = (...args: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>;
function load(file: string, overrides: Record<string, unknown>): Record<string, Action> {
  const exports = {};
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(js, { exports, require: (name: string) => name in overrides ? overrides[name] : actualRequire(name.startsWith("@/") ? resolve(name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : name), console, process, Blob, File, FormData, Uint8Array, Buffer, crypto, Date, URL, AbortSignal, Request, Response });
  return exports;
}
const org = "10200000-0000-4000-8000-000000000010";
const patient = "10200000-0000-4000-8000-000000000020";
const otherPatient = "10200000-0000-4000-8000-000000000021";
const turn = "10200000-0000-4000-8000-000000000030";
const session = "10200000-0000-4000-8000-000000000040";
const docId = "10200000-0000-4000-8000-000000000050";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=", "base64");
function scenario(options: { hiddenPatient?: boolean; documentPath?: string; documentOrganization?: string; sessionPatient?: string; bytes?: Uint8Array; deletedDocument?: boolean; uploadFailure?: boolean; revokeAfterDownload?: boolean; hash?: string; role?: string; esColegiado?: boolean } = {}) {
  const uploads: unknown[] = [], inserts: unknown[] = [], downloads: string[] = [], signs: string[] = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    paciente: options.hiddenPatient ? [] : [{ id: patient, organization_id: org, deleted_at: null, pseudonimizado_en: null }],
    turno: [{ id: turn, organization_id: org, paciente_id: patient }],
    sesion: [{ id: session, turno_id: turn, organization_id: org, paciente_id: options.sessionPatient ?? patient }],
    documento_clinico: [{ id: docId, organization_id: options.documentOrganization ?? org, paciente_id: patient, sesion_id: session, storage_bucket: "documentos-clinicos", storage_path: options.documentPath ?? `documentos-clinicos/${org}/${patient}/scan.png`, mime_type: "image/png", tamanio_bytes: png.length, content_sha256: options.hash, deleted_at: options.deletedDocument ? "2026-09-08" : null }],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    rpc: async () => ({ data: { required: true, allowed: true, isStaff: true, hasVerifiedFactor: true, sessionValid: true }, error: null }),
    storage: { from: () => ({
      upload: async (...args: unknown[]) => { uploads.push(args); if (options.uploadFailure) throw new Error("synthetic interrupted upload"); return { data: {}, error: null }; },
      download: async (path: string) => { downloads.push(path); if (options.revokeAfterDownload) rows.paciente = []; return { data: new Blob([new Uint8Array(options.bytes ?? png)]), error: null }; },
      createSignedUrl: async (path: string) => { signs.push(path); return { data: { signedUrl: "https://storage.invalid/signed" }, error: null }; },
      remove: async () => ({ error: null }),
    }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let added: Record<string, unknown> | undefined;
      const q = { select() { return q; }, eq(key: string, value: unknown) { filters.push([key, value]); return q; }, is(key: string, value: unknown) { filters.push([key, value]); return q; }, order() { return q; }, range() { return q; },
        insert(value: Record<string, unknown>) { added = { id: docId, ...value }; inserts.push(value); return q; }, update() { return q; },
        maybeSingle: async () => ({ data: added ?? (rows[table] ?? []).find(row => filters.every(([key, value]) => row[key] === value)) ?? null, error: null }),
        single: async () => ({ data: added ?? rows[table]?.[0] ?? null, error: null }),
        then: (fn: (value: unknown) => unknown) => Promise.resolve({ data: (rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value)), count: rows[table]?.length ?? 0, error: null }).then(fn),
      };
      return q;
    },
  };
  const active = { ok: true, data: { userId: "user", memberId: "member", organizationId: org, role: options.role ?? "OWNER", esColegiado: options.esColegiado ?? false } };
  const overrides: Record<string, unknown> = {
    "server-only": {}, "next/cache": { revalidatePath() {} },
    "@/lib/db/session": { getActiveSession: async () => active }, "./session": { getActiveSession: async () => active },
    "@/lib/db/active-context": { getActiveContext: async () => ({ ok: true, data: { session: active.data } }) },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client, createSupabaseServiceClient: () => client },
    "@/lib/crypto": { encryptColumn: () => null, tryDecrypt: () => null },
  };
  const docs = load("lib/db/documentos.ts", overrides);
  overrides["@/lib/db/documentos"] = docs;
  return { docs, uploads, inserts, downloads, signs, actions: () => load("app/(app)/pacientes/actions.ts", overrides), route: load("app/api/documentos/[id]/archivo/route.ts", overrides).GET as unknown as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> };
}
function uploadForm(bytes: Uint8Array, mime: string, name = "scan.png") {
  const fd = new FormData(); fd.set("file", new File([new Uint8Array(bytes)], name, { type: mime }));
  fd.set("pacienteId", patient); fd.set("turnoId", turn); fd.set("tipo", "RADIOGRAFIA"); return fd;
}
for (const mime of ["image/jpeg", "application/pdf", "image/svg+xml"]) {
  test(`upload refuses HTML disguised as ${mime} before writing storage`, async () => {
    const s = scenario(); const result = await s.actions().uploadDocumentoPacienteAction(uploadForm(Buffer.from("<html><script>alert(1)</script></html>"), mime));
    assert.equal(result.ok, false); assert.equal(s.uploads.length, 0); assert.equal(s.inserts.length, 0);
  });
}
test("upload verifies patient scope independently before sending privileged bytes", async () => {
  const s = scenario({ hiddenPatient: true }); const result = await s.actions().uploadDocumentoPacienteAction(uploadForm(png, "image/png"));
  assert.equal(result.ok, false); assert.equal(s.uploads.length, 0);
});
test("document registration rejects a path belonging to another patient in the same org", async () => {
  const s = scenario(); const result = await s.docs.createDocumentoClinico({ pacienteId: patient, sesionId: session, tipo: "RADIOGRAFIA", storagePath: `documentos-clinicos/${org}/${otherPatient}/scan.png`, mimeType: "image/png", tamanioBytes: png.length });
  assert.equal(result.ok, false); assert.equal(s.inserts.length, 0);
});
test("download URL refuses malformed persisted path before storage access", async () => {
  const s = scenario({ documentPath: `documentos-clinicos/${org}/${otherPatient}/scan.png` });
  assert.equal((await s.docs.refreshSignedUrl(docId)).ok, false); assert.equal(s.signs.length, 0);
});
test("deleted attachment cannot be downloaded", async () => {
  const s = scenario({ deletedDocument: true }); assert.equal((await s.docs.refreshSignedUrl(docId)).ok, false); assert.equal(s.signs.length, 0);
});

test("valid PNG is verified, registered with actual digest, and never signed", async () => {
  const s = scenario(); const result = await s.actions().uploadDocumentoPacienteAction(uploadForm(png, "image/png", "untrusted-name.html"));
  assert.equal(result.ok, true); assert.equal(s.uploads.length, 1); assert.equal(s.inserts.length, 1);
  const insert = s.inserts[0] as Record<string, unknown>;
  assert.equal(insert.mime_type, "image/png"); assert.equal(insert.tamanio_bytes, png.length);
  assert.match(String(insert.content_sha256), /^[a-f0-9]{64}$/);
  assert.match(String(insert.storage_path), /\.png$/);
  assert.equal(s.signs.length, 0);
});
test("upload transport failure returns a recoverable result", async () => {
  const s = scenario({ uploadFailure: true });
  assert.equal((await s.actions().uploadDocumentoPacienteAction(uploadForm(png, "image/png"))).ok, false);
  assert.equal(s.inserts.length, 0);
});
test("new upload rejects more than 4 MiB before storage", async () => {
  const s = scenario();
  assert.equal((await s.actions().uploadDocumentoPacienteAction(uploadForm(new Uint8Array(4 * 1024 * 1024 + 1), "image/png"))).ok, false);
  assert.equal(s.uploads.length, 0);
});
for (const metadata of [{ tamanioBytes: png.length - 1 }, { mimeType: "image/jpeg" }]) {
  test(`finalize validates stored bytes against ${Object.keys(metadata)[0]}`, async () => {
    const s = scenario();
    const result = await s.docs.createDocumentoClinico({ pacienteId: patient, sesionId: session, tipo: "RADIOGRAFIA", storagePath: `documentos-clinicos/${org}/${patient}/scan.png`, mimeType: "image/png", tamanioBytes: png.length, ...metadata });
    assert.equal(result.ok, false); assert.equal(s.inserts.length, 0);
  });
}
test("legacy file is accessible only through the authenticated endpoint", async () => {
  const s = scenario();
  const url = await s.docs.getDocumentoDownloadUrl(docId);
  assert.equal(url.ok, true); assert.equal(url.data, `/api/documentos/${docId}/archivo`);
  const result = await s.docs.readDocumentoDownload(docId);
  assert.equal(result.ok, true); assert.equal(s.signs.length, 0);
});
test("revoked patient access during storage read prevents delivery", async () => {
  const s = scenario({ revokeAfterDownload: true });
  assert.equal((await s.docs.readDocumentoDownload(docId)).ok, false);
});
test("new file hash mismatch prevents delivery", async () => {
  const s = scenario({ hash: "a".repeat(64) });
  assert.equal((await s.docs.readDocumentoDownload(docId)).ok, false);
});

for (const role of ["ASISTENTE", "COORDINADOR", "DIRECTOR"]) {
  test(`${role} without clinical scope cannot resolve or read attachment bytes`, async () => {
    const s = scenario({ role });
    assert.equal((await s.docs.getDocumentoDownloadUrl(docId)).ok, false);
    assert.equal((await s.docs.readDocumentoDownload(docId)).ok, false);
    assert.equal(s.downloads.length, 0);
  });
}

test("real download route denies a revoked patient even when a caller supplies a Range", async () => {
  const s = scenario({ hiddenPatient: true });
  const response = await s.route(new Request("https://folio.invalid/file", { headers: { range: "bytes=0-3" } }), { params: Promise.resolve({ id: docId }) });
  assert.equal(response.status, 404); assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(s.downloads.length, 0); assert.equal(s.signs.length, 0);
});

test("real download route serves only authorized validated bytes with private range headers", async () => {
  const s = scenario();
  const response = await s.route(new Request("https://folio.invalid/file", { headers: { range: "bytes=0-7" } }), { params: Promise.resolve({ id: docId }) });
  assert.equal(response.status, 206); assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(Buffer.from(await response.arrayBuffer()).equals(png.subarray(0, 8)), true);
  assert.equal(s.signs.length, 0);
});

test("download route suppresses unexpected transport exception details and never caches them", async () => {
  const route = load("app/api/documentos/[id]/archivo/route.ts", { "@/lib/db/documentos": { readDocumentoDownload: async () => { throw new Error("synthetic-private-provider-detail"); } } }).GET as unknown as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
  const response = await route(new Request("https://folio.invalid/file"), { params: Promise.resolve({ id: docId }) });
  assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal((await response.text()).includes("synthetic-private-provider-detail"), false);
});

test("an existing document in another organization is invisible before privileged storage", async () => {
  const s = scenario({ documentOrganization: "10200000-0000-4000-8000-000000000099" });
  assert.equal((await s.docs.readDocumentoDownload(docId)).ok, false);
  assert.equal(s.downloads.length, 0);
});

test("a session that exists for a different patient cannot receive the attachment", async () => {
  const s = scenario({ sessionPatient: otherPatient });
  const result = await s.docs.createDocumentoClinico({ pacienteId: patient, sesionId: session, tipo: "RADIOGRAFIA", storagePath: `documentos-clinicos/${org}/${patient}/scan.png`, mimeType: "image/png", tamanioBytes: png.length });
  assert.equal(result.ok, false); assert.equal(s.downloads.length, 0); assert.equal(s.inserts.length, 0);
});
