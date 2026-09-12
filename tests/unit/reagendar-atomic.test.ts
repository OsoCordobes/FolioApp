import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const actual = createRequire(import.meta.url);
const id = "11900000-0000-4000-8000-000000000001";
const replacement = "11900000-0000-4000-8000-000000000002";
const input = { operacionId: id, turnoId: id, nuevoInicio: "2026-10-01T12:00:00Z", nuevaDuracionMin: 30 };
type Outcome = { ok: boolean; error?: { code: string; message: string }; data?: { nuevoTurnoId: string } };

/** Real data-layer/action bodies; only persistence/framework boundaries replaced.
 * The legacy two-request path can commit UPDATE and fail INSERT independently.
 * The replacement RPC rejection represents one rolled-back DB transaction.
 */
function fixture() {
  let originalState = "AGENDADO";
  let result: unknown = { data: null, error: { code: "23P01", message: "Synthetic slot conflict" } };
  let revoked = false;
  let cacheFailure = false;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const mutations: string[] = [];
  const cache: string[] = [];
  const row = { id, paciente_id: id, servicio_id: id, profesional_id: id, precio_cents: 12345,
    duracion_min: 30, nota_reserva_cifrado: "\\x01", modalidad: "telemedicina" };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "slot_ocupado") return { data: false, error: null };
      if (result instanceof Error) throw result;
      return result;
    },
    from: (table: string) => {
      let mode = "read";
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is"]) query[method] = () => query;
      query.update = (patch: { estado?: string }) => {
        mode = "update"; mutations.push(`${table}.update`);
        if (table === "turno" && patch.estado) originalState = patch.estado;
        return query;
      };
      query.insert = () => { mode = "insert"; mutations.push(`${table}.insert`); return query; };
      const value = () => mode === "insert"
        ? { data: null, error: { code: "23P01", message: "Synthetic destination race after UPDATE" } }
        : { data: mode === "read" ? { ...row, estado: originalState } : [row], error: null };
      query.maybeSingle = async () => value();
      query.single = async () => value();
      query.then = (accept: (v: unknown) => unknown) => Promise.resolve(value()).then(accept);
      return query;
    },
  };
  const session = { getActiveSession: async () => revoked
    ? { ok: false, error: { code: "forbidden", message: "Revoked" } }
    : { ok: true, data: { organizationId: id, memberId: id } } };
  const mocks: Record<string, unknown> = {
    "./session": session, "@/lib/db/session": session,
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "@/lib/after-response": { runAfterResponse: () => undefined },
    "next/cache": { revalidatePath: (path: string) => { cache.push(path); if (cacheFailure) throw Error("Cache unavailable"); } },
  };
  function load(file: string) {
    const exports: Record<string, (value: unknown) => Promise<Outcome>> = {};
    runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, { exports, Date, JSON, require: (name: string) => name in mocks ? mocks[name]
      : name === "zod" ? actual(name)
      : name === "./errors" || name === "@/lib/db/errors" ? actual(resolve("lib/db/errors.ts")) : {} });
    return exports;
  }
  const db = load("lib/db/turnos.ts");
  mocks["@/lib/db/turnos"] = db;
  const action = load("app/(app)/hoy/actions.ts");
  return { call: action.reagendarTurnoAction, state: () => originalState, mutations, calls, cache,
    set: (value: unknown) => { result = value; }, revoke: () => { revoked = true; }, failCache: () => { cacheFailure = true; } };
}

test("destination insertion failure preserves the original appointment and schedules no partial replacement", async () => {
  const f = fixture();
  assert.equal((await f.call(input)).error?.code, "conflict");
  assert.equal(f.state(), "AGENDADO", "Original appointment was lost before replacement committed");
  assert.deepEqual(f.mutations, []);
  assert.equal(f.calls[0].name, "reschedule_turno_atomic");
});

test("reschedule rejects missing operation before persistence", async () => {
  const f = fixture();
  assert.equal((await f.call({ ...input, operacionId: undefined })).error?.code, "validation");
  assert.equal(f.calls.length, 0);
});

test("reschedule never mutates with revoked membership", async () => {
  const f = fixture(); f.revoke();
  assert.equal((await f.call(input)).error?.code, "forbidden");
  assert.equal(f.calls.length, 0);
});

test("lost acknowledgement retries the same operation and unknown responses remain uncertain", async () => {
  const f = fixture();
  for (const value of [Error("Lost reply"), { data: {}, error: null }, { data: null, error: { code: "08006", message: "Private detail" } }]) {
    f.set(value); assert.equal((await f.call(input)).error?.code, "network");
  }
  f.set({ data: { nuevoTurnoId: replacement }, error: null });
  assert.equal((await f.call(input)).data?.nuevoTurnoId, replacement);
  assert.equal(new Set(f.calls.map(c => c.args.p_operation)).size, 1);
  assert.equal(f.calls[0].args.p_operation, input.operacionId);
  assert.deepEqual(f.mutations, []);
});

test("committed reschedule remains confirmed if cache refresh fails", async () => {
  const f = fixture(); f.set({ data: { nuevoTurnoId: replacement }, error: null }); f.failCache();
  assert.equal((await f.call(input)).data?.nuevoTurnoId, replacement);
});

for (const [code, expected] of [["42501", "forbidden"], ["23514", "validation"], ["22023", "validation"], ["40001", "conflict"], ["55000", "transition_invalid"]]) {
  test(`reschedule rejects ${code} without exposing database details`, async () => {
    const f = fixture(); f.set({ data: null, error: { code, message: "Private SQL detail" } });
    const value = await f.call(input);
    assert.equal(value.error?.code, expected);
    assert.equal(JSON.stringify(value).includes("Private SQL"), false);
  });
}
