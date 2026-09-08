import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { blindIndex, blindIndexCandidatos, blindIndexPhoneCandidatos } from "../../lib/crypto";
import { directoryRequestSchema, type DirectoryPage } from "../../lib/pacientes/directory";

const id = "11400000-0000-4000-8000-000000000001";
const session = { organizationId: "11400000-0000-4000-8000-000000000010", memberId: id };
function fixture() {
  let current = session;
  let fail = false;
  let encryptedFailure = false;
  const calls: Record<string, unknown>[] = [];
  const response = { rows: [{ paciente_id: id, nombre_cifrado: "Test", apellido_cifrado: "Synthetic", telefono_cifrado: "3515550100", email_cifrado: null,
    sesiones_completadas: 0, tipo_paciente: "ACTIVO", ultima_visita: "2026-09-08T02:59:59Z", proximo_turno: null, tags: [], estado: "activo", cobertura_nombre: "Synthetic coverage", cobertura_plan: null }],
    total: 51, counts: { todos: 51 }, coberturas: ["Synthetic coverage"], revision: "a".repeat(32), cutoff: "2026-09-08T00:00:00.123456+00:00",
    next_cursor: { createdAt: "2026-01-01T00:00:00.123456+00:00", id } };
  const exports: { getPacientesDirectorio?: (input?: unknown, cutoff?: string, context?: typeof session) => Promise<{ ok: boolean; data: DirectoryPage }> } = {};
  const imports: Record<string, unknown> = {
    "server-only": {},
    "node:crypto": { createHash },
    "@/lib/crypto": { blindIndex, blindIndexCandidatos, blindIndexPhoneCandidatos, decryptColumn: (x: unknown) => { if (encryptedFailure) throw new Error("SYNTHETIC SECRET SDK CONTENT"); return x; } },
    "@/lib/pacientes/directory": { directoryRequestSchema },
    "./session": { getActiveSession: async () => ({ ok: true, data: current }) },
    "./errors": { ok: (data: unknown) => ({ ok: true, data }), err: (code: string, message: string) => ({ ok: false, error: { code, message } }) },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "pacientes_directory_page"); calls.push(args); return { data: response, error: fail ? { message: "SYNTHETIC SECRET SDK CONTENT" } : null };
    } }) },
  };
  runInNewContext(ts.transpileModule(readFileSync("lib/db/pacientes-dir.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Buffer, Intl, Date, Set, require: (name: string) => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; } });
  return { load: exports.getPacientesDirectorio!, calls, response, context: (org: string) => { current = { ...session, organizationId: org }; }, fail: () => { fail = true; }, badCipher: () => { encryptedFailure = true; } };
}
test("directory loader uses all salted and legacy candidate indexes and preserves microsecond cursor", async () => {
  const f = fixture();
  const first = await f.load({ query: "3515550100" });
  assert.equal(first.ok, true);
  assert.equal(first.data.rows[0].tipo, "recurrente");
  assert.equal(first.data.rows[0].ultima, "2026-09-07");
  assert.deepEqual(Array.from(f.calls[0].p_hashes as string[]), [...new Set([...blindIndexCandidatos("3515550100", session.organizationId), ...blindIndexCandidatos("3515550100")])]);
  assert.deepEqual(Array.from(f.calls[0].p_phone_hashes as string[]), [...new Set([...blindIndexPhoneCandidatos("3515550100", session.organizationId), ...blindIndexPhoneCandidatos("3515550100")])]);
  await f.load({ query: "3515550100", cursor: first.data.nextCursor });
  assert.equal(f.calls[1].p_before_created, "2026-01-01T00:00:00.123456+00:00");
  assert.equal(f.calls[1].p_limit, 50);
});
for (const change of ["query", "organization", "signature"] as const) {
  test(`directory cursor cannot be reused with changed ${change}`, async () => {
    const f = fixture(); const initial = await f.load({});
    let cursor = initial.data.nextCursor;
    assert.ok(cursor);
    if (change === "organization") f.context("different-org");
    if (change === "signature") {
      const token = JSON.parse(Buffer.from(cursor, "base64url").toString()); token.id = "11400000-0000-4000-8000-000000000099";
      cursor = Buffer.from(JSON.stringify(token)).toString("base64url");
    }
    const result = await f.load({ cursor, query: change === "query" ? "Another" : "" });
    assert.equal(result.ok, false); assert.equal(f.calls.length, 1);
  });
}
test("directory expected export context checked by same session used for query", async () => {
  const f = fixture(); f.context("other-org");
  assert.equal((await f.load({}, undefined, session)).ok, false); assert.equal(f.calls.length, 0);
});
for (const failure of ["SDK", "cipher", "missing-coverage-page"] as const) {
  test(`directory ${failure} failure stays generic and does not invent Particular`, async () => {
    const f = fixture(); if (failure === "SDK") f.fail(); else if (failure === "cipher") f.badCipher(); else f.response.coberturas = null as never;
    const result = await f.load({}); assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("SECRET"), false);
  });
}

test("directory cursor binding preserves case-sensitive coverage filters", async () => {
  const f = fixture();
  const initial = await f.load({ coverage: "PAMI" });
  assert.equal(initial.ok, true);
  const changed = await f.load({ coverage: "pami", cursor: initial.data.nextCursor });
  assert.equal(changed.ok, false);
  assert.equal(f.calls.length, 1);
});
