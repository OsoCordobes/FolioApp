import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { CreateTurnoMeta } from "../../app/(app)/hoy/actions";
import type { Result } from "../../lib/db/errors";

const actual = createRequire(import.meta.url);
const sessionOrg = "12000000-0000-4000-8000-000000000001";
const otherOrg = "12000000-0000-4000-8000-000000000002";
const memberId = "12000000-0000-4000-8000-000000000003";
type Row = Record<string, unknown>;

function fixture(options: {
  revoked?: boolean;
  timezone?: string | null;
  organizationError?: boolean;
  missingOrganization?: boolean;
  deletedOrganization?: boolean;
} = {}) {
  const activity = { clients: 0, queries: [] as string[], directories: 0, professionals: 0 };
  const rows: Record<string, Row[]> = {
    organization: [
      { id: otherOrg, timezone: "Pacific/Auckland", deleted_at: null },
      ...options.missingOrganization ? [] : [{
        id: sessionOrg,
        timezone: options.timezone === undefined ? "Europe/Madrid" : options.timezone,
        deleted_at: options.deletedOrganization ? "2026-09-01T00:00:00Z" : null,
      }],
    ],
    servicio: [{ id: "service", organization_id: sessionOrg, nombre: "Consulta", duracion_min: 30, precio_cents: 15000, activo: true, deleted_at: null }],
  };

  // Evaluate query filters against two tenants, so an unscoped lookup cannot
  // accidentally obtain the authenticated organization's timezone.
  function from(table: string) {
    activity.queries.push(table);
    assert.ok(table in rows, `Unexpected metadata read: ${table}`);
    let selected = rows[table];
    let columns: string[] = [];
    const response = () => options.organizationError && table === "organization"
      ? { data: null, error: { code: "08006", message: "Synthetic database failure" } }
      : { data: selected.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))), error: null };
    const query = {
      select(projection: string) { columns = projection.split(",").map(column => column.trim()); return query; },
      eq(column: string, value: unknown) { selected = selected.filter(row => row[column] === value); return query; },
      is(column: string, value: unknown) { selected = selected.filter(row => row[column] === value); return query; },
      async single() {
        const result = response();
        return result.error || result.data?.length !== 1
          ? { data: null, error: result.error ?? { code: "PGRST116", message: "Expected one row" } }
          : { data: result.data[0], error: null };
      },
      async order() { return response(); },
    };
    return query;
  }

  const mocks: Record<string, unknown> = {
    "@/lib/db/session": { getActiveSession: async () => options.revoked
      ? { ok: false, error: { code: "forbidden", message: "Revoked session" } }
      : { ok: true, data: { userId: "user", email: "synthetic@example.invalid", emailVerified: true, organizationId: sessionOrg, memberId, role: "PROFESIONAL", esColegiado: true, isInternalAccount: true } } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => { activity.clients++; return { from }; } },
    "@/lib/db/pacientes": { listPacientesDirectorio: async () => { activity.directories++; return { ok: true, data: [] }; } },
    "@/lib/db/members": { listProfesionalesLite: async (organizationId: string) => {
      activity.professionals++;
      assert.equal(organizationId, sessionOrg);
      return { ok: true, data: [] };
    } },
  };
  const exports: { loadCreateTurnoMeta?: (...input: unknown[]) => Promise<Result<CreateTurnoMeta>> } = {};
  runInNewContext(ts.transpileModule(readFileSync("app/(app)/hoy/actions.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date, Intl, JSON,
    require: (name: string) => name in mocks ? mocks[name]
      : name === "zod" ? actual(name)
      : name === "@/lib/db/errors" ? actual(resolve("lib/db/errors.ts")) : {},
  });
  assert.ok(exports.loadCreateTurnoMeta);
  return { call: exports.loadCreateTurnoMeta, activity };
}

test("revoked Auth cannot load timezone or any creation metadata", async () => {
  const f = fixture({ revoked: true });
  const result = await f.call();
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "forbidden");
  assert.equal("data" in result, false);
  assert.deepEqual(f.activity, { clients: 0, queries: [], directories: 0, professionals: 0 });
});

test("creation metadata uses the session organization's timezone despite a different caller organization and browser zone", async () => {
  const f = fixture();
  const result = await f.call({ organizationId: otherOrg, timezone: "Pacific/Auckland" });
  assert.ok(result.ok);
  assert.equal(result.data.timezone, "Europe/Madrid");
  assert.equal(result.data.sessionMemberId, memberId);
  assert.equal(result.data.servicios[0]?.nombre, "Consulta");
  assert.equal(result.data.servicios[0]?.duracionMin, 30);
});

for (const [label, options, code] of [
  ["organization read fails", { organizationError: true }, "db_error"],
  ["organization is missing", { missingOrganization: true }, "db_error"],
  ["organization is archived", { deletedOrganization: true }, "db_error"],
  ["organization timezone is invalid", { timezone: "Mars/Olympus_Mons" }, "validation"],
] as const) {
  test(`creation metadata stays unavailable when ${label}`, async () => {
    const f = fixture(options);
    const result = await f.call();
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.code, code);
    assert.equal("data" in result, false);
    assert.deepEqual(f.activity.queries, ["organization"]);
    assert.equal(f.activity.directories, 0);
    assert.equal(f.activity.professionals, 0);
  });
}

test("a legacy null organization timezone uses Cordoba instead of the caller's timezone", async () => {
  const f = fixture({ timezone: null });
  const result = await f.call({ timezone: "Pacific/Auckland" });
  assert.ok(result.ok);
  assert.equal(result.data.timezone, "America/Argentina/Cordoba");
});
