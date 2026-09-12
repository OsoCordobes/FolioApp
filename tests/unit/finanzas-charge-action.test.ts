import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { capabilitiesFor, type Role } from "../../lib/auth/capabilities";
import { finanzasScopeMemberId } from "../../lib/auth/finanzas-scope";
import { err, mapSupabaseError, ok, type Result } from "../../lib/db/errors";

const PAYMENT_ID = "00000000-0000-4000-8000-000000000001";
const EXISTING_TIMESTAMP = "2026-09-10T13:00:00.000Z";
type Payment = {
  id: string;
  estado: string;
  pagado_ts: string | null;
  turno: { organization_id: string; profesional_id: string | null } | null;
};
type DbError = { code: string; message: string };
type Options = {
  role?: Role;
  sessionError?: boolean;
  initial?: Payment | null;
  beforeUpdate?: Payment | null;
  suppressUpdate?: boolean;
  readErrorAt?: number;
  updateError?: DbError;
};
const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: PAYMENT_ID,
  estado: "PENDIENTE",
  pagado_ts: null,
  turno: { organization_id: "active-org", profesional_id: "active-member" },
  ...overrides,
});
const source = ts.transpileModule(readFileSync("app/(app)/finanzas/actions.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the real action; only session, persistence and framework boundaries are replaced.
function scenario(options: Options = {}) {
  let stored = options.initial === undefined ? payment() : structuredClone(options.initial);
  const reads: string[] = [];
  const writes: { values: { estado: string; pagado_ts: string }; filters: unknown[][] }[] = [];
  const revalidated: string[] = [];
  let clients = 0;
  const client = { from(table: string) {
    assert.equal(table, "pago");
    return {
      select(columns: string) {
        // Both reads must carry the joined authorization data.
        assert.equal(columns, "id, estado, turno:turno_id!inner(organization_id, profesional_id)");
        return { eq(column: string, id: string) {
          assert.equal(column, "id");
          assert.equal(id, PAYMENT_ID);
          return { async maybeSingle() {
            reads.push(id);
            if (options.readErrorAt === reads.length) {
              return { data: null, error: { code: "42501", message: "synthetic read denied" } };
            }
            return { data: structuredClone(stored), error: null };
          } };
        } };
      },
      update(values: { estado: string; pagado_ts: string }) {
        const write = { values, filters: [] as unknown[][] };
        writes.push(write);
        const query = {
          eq(column: string, value: unknown) { write.filters.push(["eq", column, value]); return query; },
          neq(column: string, value: unknown) { write.filters.push(["neq", column, value]); return query; },
          async select(columns: string) {
            assert.equal(columns, "id");
            if ("beforeUpdate" in options) stored = structuredClone(options.beforeUpdate ?? null);
            if (options.updateError) return { data: null, error: options.updateError };
            const matches = stored && write.filters.every(([op, column, value]) =>
              op === "eq" ? stored![column as keyof Payment] === value : stored![column as keyof Payment] !== value);
            if (!matches || options.suppressUpdate) return { data: [], error: null };
            stored = { ...stored!, ...values };
            return { data: [{ id: stored.id }], error: null };
          },
        };
        return query;
      },
    };
  } };
  const exports: { marcarPagoCobradoAction?: (id: string) => Promise<Result<void>> } = {};
  runInNewContext(source, { exports, require(name: string) {
    switch (name) {
      case "zod": return { z };
      case "next/cache": return { revalidatePath: (path: string) => revalidated.push(path) };
      case "@/lib/auth/capabilities": return { capabilitiesFor };
      case "@/lib/auth/finanzas-scope": return { finanzasScopeMemberId };
      case "@/lib/db/errors": return { err, mapSupabaseError, ok };
      case "@/lib/db/session": return { getActiveSession: async () => options.sessionError
        ? err("auth_required", "Volvé a iniciar sesión.")
        : ok({ role: options.role ?? "PROFESIONAL", esColegiado: true,
          organizationId: "active-org", memberId: "active-member" }) };
      case "@/lib/supabase/server": return { createSupabaseServerClient: async () => { clients++; return client; } };
      // These exports are outside this action's path. Fail if any gets invoked.
      case "@/lib/afip/comprobantes":
      case "@/lib/auth/guard":
      case "@/lib/db/active-context":
      case "@/lib/db/finanzas-read":
      case "@/lib/finanzas/filter-schema": return {};
      default: throw new Error(`Unexpected dependency: ${name}`);
    }
  } });
  return { execute: exports.marcarPagoCobradoAction!, reads, writes, revalidated,
    get stored() { return stored; }, get clients() { return clients; } };
}

function assertFailure(result: Result<void>, code: string) {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
}

test("empty payment update followed by an absent payment cannot announce collection", async () => {
  const run = scenario({ beforeUpdate: null });
  assertFailure(await run.execute(PAYMENT_ID), "not_found");
  assert.equal(run.writes.length, 1);
  assert.equal(run.reads.length, 2);
  assert.deepEqual(run.revalidated, []);
});

test("invalid input, inactive session and forbidden roles stop before persistence", async () => {
  for (const [options, id, code] of [
    [{}, "invalid", "validation"],
    [{ sessionError: true }, PAYMENT_ID, "auth_required"],
    [{ role: "COORDINADOR" }, PAYMENT_ID, "forbidden"],
    [{ role: "ASISTENTE" }, PAYMENT_ID, "forbidden"],
  ] as const) {
    const run = scenario(options);
    assertFailure(await run.execute(id), code);
    assert.equal(run.clients, 0);
    assert.deepEqual(run.writes, []);
    assert.deepEqual(run.revalidated, []);
  }
});

test("initial read rejects absent, unjoined, foreign organization and other professional payments", async () => {
  for (const [initial, code] of [
    [null, "not_found"],
    [payment({ turno: null }), "not_found"],
    [payment({ turno: { organization_id: "foreign-org", profesional_id: "active-member" } }), "not_found"],
    [payment({ turno: { organization_id: "active-org", profesional_id: "other-member" } }), "forbidden"],
  ] as const) {
    const run = scenario({ initial });
    assertFailure(await run.execute(PAYMENT_ID), code);
    assert.equal(run.writes.length, 0);
    assert.deepEqual(run.revalidated, []);
  }
});

test("already collected payment succeeds without a write or timestamp change", async () => {
  const run = scenario({ initial: payment({ estado: "PAGADO", pagado_ts: EXISTING_TIMESTAMP }) });
  assert.deepEqual(await run.execute(PAYMENT_ID), { ok: true, data: undefined });
  assert.equal(run.writes.length, 0);
  assert.equal(run.stored?.pagado_ts, EXISTING_TIMESTAMP);
});

test("a returned updated row confirms collection for pending and partial payments", async () => {
  for (const estado of ["PENDIENTE", "PARCIAL"]) {
    const run = scenario({ initial: payment({ estado }) });
    assert.deepEqual(await run.execute(PAYMENT_ID), { ok: true, data: undefined });
    assert.equal(run.writes.length, 1);
    assert.equal(run.reads.length, 1);
    assert.equal(run.stored?.estado, "PAGADO");
    assert.ok(Number.isFinite(Date.parse(run.stored!.pagado_ts!)));
    assert.deepEqual(run.writes[0].filters, [["eq", "id", PAYMENT_ID], ["neq", "estado", "PAGADO"]]);
    assert.deepEqual(run.revalidated, ["/finanzas"]);
  }
});

test("owner and director retain access to another professional in the active organization", async () => {
  for (const role of ["OWNER", "DIRECTOR"] as const) {
    const run = scenario({ role, initial: payment({ turno: { organization_id: "active-org", profesional_id: "other-member" } }) });
    assert.equal((await run.execute(PAYMENT_ID)).ok, true);
    assert.equal(run.writes.length, 1);
  }
});

test("concurrent collection succeeds only after rereading and preserves its recorded timestamp", async () => {
  const run = scenario({ beforeUpdate: payment({ estado: "PAGADO", pagado_ts: EXISTING_TIMESTAMP }) });
  assert.deepEqual(await run.execute(PAYMENT_ID), { ok: true, data: undefined });
  assert.equal(run.reads.length, 2);
  assert.equal(run.writes.length, 1);
  assert.equal(run.stored?.pagado_ts, EXISTING_TIMESTAMP);
  assert.deepEqual(run.revalidated, ["/finanzas"]);
});

test("empty update with a still unpaid payment returns a recoverable conflict without retry", async () => {
  for (const estado of ["PENDIENTE", "PARCIAL"]) {
    const run = scenario({ beforeUpdate: payment({ estado }), suppressUpdate: true });
    assertFailure(await run.execute(PAYMENT_ID), "conflict");
    assert.equal(run.reads.length, 2);
    assert.equal(run.writes.length, 1);
    assert.equal(run.stored?.pagado_ts, null);
    assert.deepEqual(run.revalidated, []);
  }
});

test("reread cannot confirm a paid payment after organization or professional reassignment", async () => {
  for (const [turno, code] of [
    [{ organization_id: "foreign-org", profesional_id: "active-member" }, "not_found"],
    [{ organization_id: "active-org", profesional_id: "other-member" }, "forbidden"],
    [null, "not_found"],
  ] as const) {
    const run = scenario({ beforeUpdate: payment({ estado: "PAGADO", pagado_ts: EXISTING_TIMESTAMP, turno }) });
    assertFailure(await run.execute(PAYMENT_ID), code);
    assert.equal(run.writes.length, 1);
    assert.equal(run.reads.length, 2);
    assert.deepEqual(run.revalidated, []);
  }
});

test("initial and confirmation read errors retain their mapped error without announcing success", async () => {
  for (const readErrorAt of [1, 2]) {
    const run = scenario({ readErrorAt, suppressUpdate: true });
    assertFailure(await run.execute(PAYMENT_ID), "forbidden");
    assert.equal(run.writes.length, readErrorAt - 1);
    assert.deepEqual(run.revalidated, []);
  }
});

test("update errors are mapped and cannot trigger a retry or successful revalidation", async () => {
  const run = scenario({ updateError: { code: "23514", message: "synthetic constraint failure" } });
  assertFailure(await run.execute(PAYMENT_ID), "validation");
  assert.equal(run.writes.length, 1);
  assert.equal(run.reads.length, 1);
  assert.deepEqual(run.revalidated, []);
});
