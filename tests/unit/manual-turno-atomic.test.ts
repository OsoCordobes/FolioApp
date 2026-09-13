import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
const actual = createRequire(import.meta.url);
const id = "11700000-0000-4000-8000-000000000001";
const input = { operacionId: id, pacienteNuevo: { nombre: "Synthetic", apellido: "Patient", telefono: "3515551170" }, servicioId: id, inicio: "2026-10-01T12:00:00Z", duracionMin: 30, origen: "WALK_IN" };
function fixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let next: unknown = { data: { turnoId: id, pacienteId: id }, error: null };
  let counter = 0;
  let invalidateFails = false;
  let access = true;
  const session = { getActiveSession: async () => access ? { ok: true, data: { organizationId: id, memberId: id } } : { ok: false, error: { code: "forbidden", message: "Revoked" } } };
  const boundary = { createSupabaseServerClient: async () => ({
    from: () => { throw Error("Nontransactional mutation attempted"); },
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); if (next instanceof Error) throw next; return next; },
  }) };
  const mocks: Record<string, unknown> = {
    "next/cache": { revalidatePath: () => { if (invalidateFails) throw Error("Cache unavailable"); } },
    "@/lib/db/session": session, "./session": session, "@/lib/supabase/server": boundary,
    "@/lib/crypto": { encryptColumn: (v: unknown) => v == null ? null : `\\x${++counter}`, blindIndex: (v: string) => createHash("sha256").update(v).digest("hex"), blindIndexPhone: () => "a".repeat(64) },
  };
  function load(file: string) {
    const exports: Record<string, (input: unknown) => Promise<{ ok: boolean; error?: { code: string }; data?: unknown }>> = {};
    runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, Date, JSON, require: (name: string) => name in mocks ? mocks[name]
        : ["node:crypto", "zod"].includes(name) ? actual(name)
        : name === "./errors" ? actual(resolve("lib/db/errors.ts"))
        : name === "@/lib/db/errors" ? actual(resolve("lib/db/errors.ts")) : {},
    });
    return exports;
  }
  const db = load("lib/db/manual-turno.ts");
  mocks["@/lib/db/manual-turno"] = db;
  const action = load("app/(app)/hoy/actions.ts");
  return { call: action.createTurnoAction, calls, set: (v: unknown) => { next = v; }, failCache: () => { invalidateFails = true; }, revoke: () => { access = false; } };
}
test("manual creation owns one RPC with a stable operation and fingerprint despite randomized encryption", async () => {
  const f = fixture();
  assert.equal((await f.call(input)).ok, true); assert.equal((await f.call(input)).ok, true);
  assert.deepEqual(f.calls.map(c => c.name), ["create_manual_turno_atomic", "create_manual_turno_atomic"]);
  assert.equal(f.calls[0].args.p_operation, id); assert.equal(f.calls[0].args.p_hash, f.calls[1].args.p_hash);
  assert.notDeepEqual(f.calls[0].args.p_identity, f.calls[1].args.p_identity);
  assert.equal(f.calls[0].args.p_origen, "WALK_IN");
});
test("manual intent changes alter the fingerprint, including case-sensitive names", async () => {
  const f = fixture(); await f.call(input);
  await f.call({ ...input, pacienteNuevo: { ...input.pacienteNuevo, nombre: "SYNTHETIC" } });
  assert.notEqual(f.calls[0].args.p_hash, f.calls[1].args.p_hash);
});
test("missing operation or ambiguous patient sources fail before database access", async () => {
  const f = fixture();
  for (const changed of [{ ...input, operacionId: undefined }, { ...input, pacienteId: id }]) assert.equal((await f.call(changed)).error?.code, "validation");
  assert.equal(f.calls.length, 0);
});
test("revoked access never enters the transactional writer", async () => {
  const f = fixture(); f.revoke(); assert.equal((await f.call(input)).error?.code, "forbidden"); assert.equal(f.calls.length, 0);
});
for (const [sqlstate, expected] of [["23P01", "conflict"], ["23514", "validation"], ["42501", "forbidden"], ["40001", "conflict"], ["22023", "validation"], ["08006", "network"], ["", "network"]]) {
  test(`manual creation classifies ${sqlstate || "missing SQL state"} as ${expected} without leaking database details`, async () => {
    const f = fixture(); f.set({ data: null, error: { code: sqlstate, message: "synthetic secret SQL detail" } });
    const result = await f.call(input); assert.equal(result.error?.code, expected);
    assert.equal(JSON.stringify(result).includes("secret SQL"), false); assert.equal(f.calls.length, 1);
  });
}
test("lost transport and malformed acknowledgement stay uncertain for the same-operation retry", async () => {
  const f = fixture();
  for (const outcome of [Error("Lost reply"), { error: null, data: {} }]) { f.set(outcome); assert.equal((await f.call(input)).error?.code, "network"); }
  f.set({ error: null, data: { turnoId: id, pacienteId: id } }); assert.equal((await f.call(input)).ok, true);
  assert.equal(new Set(f.calls.map(c => c.args.p_operation)).size, 1);
});
test("committed visit stays confirmed if cache invalidation fails", async () => {
  const f = fixture(); f.failCache(); assert.equal((await f.call(input)).ok, true); assert.equal(f.calls.length, 1);
});
