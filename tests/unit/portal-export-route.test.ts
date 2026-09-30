import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

type Row = { id: string; organization_id: string; identidad_id: string | null; cuenta_id: string | null; pseudonimizado_en: string | null };
type IdentityRow = { id: string; organization_id: string; deleted_at: string | null };
type Code = "auth_required" | "mfa_required" | "forbidden" | "db_error";
const compile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Executes the real route, authority helper, portal aggregator, pagination and
 * MFA policy helper. Only Auth/PostgREST/audit and per-ficha assembly are fakes.
 * No Supabase client, env, key, network, DB or Storage is instantiated. */
function harness(count = 2) {
  const rows: Row[] = Array.from({ length: count }, (_, i) => ({ id: `p-${String(i).padStart(4, "0")}`,
    organization_id: `org-${i % 2}`, identidad_id: `identity-${i}`, cuenta_id: "account", pseudonimizado_en: null }));
  const initial = rows.map(row => ({ pacienteId: row.id, organizationId: row.organization_id,
    organizacionNombre: "Consultorio sintético", bookingSlug: null }));
  const identities: IdentityRow[] = rows.map(row => ({ id: row.identidad_id!, organization_id: row.organization_id, deleted_at: null }));
  const events: string[] = [];
  const assemblies: string[] = [];
  const control: {
    afterAudit?: () => void; initialError?: Code; user: string | null; account: string | null;
    allowed: boolean; required: boolean; statusError: boolean; accountError: boolean; authThrow: boolean;
    readError: boolean; badCount: boolean; omitFilter: boolean; pageCap: number; final: boolean;
    throwAudit: boolean; displayLimit: number; failAssembly: string | null;
    failPageFrom?: number;
    identityReadError?: boolean; identityBadCount?: boolean;
  } = { user: "actor", account: "account", allowed: true, required: false, statusError: false, accountError: false,
    authThrow: false, readError: false, badCount: false, omitFilter: false, pageCap: 129, final: false,
    throwAudit: false, displayLimit: count, failAssembly: null };
  const client = {
    auth: { getUser: async () => {
      events.push("auth"); control.final = true;
      if (control.authThrow) throw Error("SECRET auth transport");
      return { data: { user: control.user ? { id: control.user } : null }, error: null };
    } },
    rpc: async (name: string) => {
      events.push(name);
      if (name === "mfa_access_status") return { data: { allowed: control.allowed, required: control.required,
        isStaff: false, hasVerifiedFactor: control.required, sessionValid: true }, error: control.statusError ? "SECRET MFA" : null };
      assert.equal(name, "paciente_cuenta_actual");
      return { data: control.account, error: control.accountError ? "SECRET account" : null };
    },
    from: (table: string) => {
      assert.ok(table === "paciente" || table === "paciente_identidad");
      let account = "", from = 0, to = 499, requestedIds: string[] = [];
      const query = {
        select: (fields: string, options: { count: string }) => {
          assert.equal(fields, table === "paciente" ? "id, organization_id, identidad_id, cuenta_id, pseudonimizado_en"
            : "id, organization_id, deleted_at");
          assert.equal(options.count, "exact"); return query;
        },
        eq: (key: string, value: string) => { assert.equal(key, "cuenta_id"); account = value; return query; },
        in: (key: string, values: string[]) => {
          assert.equal(table, "paciente_identidad"); assert.equal(key, "id"); assert.ok(values.length <= 200);
          requestedIds = values; return query;
        },
        is: (key: string, value: null) => { assert.equal(key, table === "paciente" ? "pseudonimizado_en" : "deleted_at"); assert.equal(value, null); return query; },
        order: (key: string) => { assert.equal(key, "id"); return query; },
        range: (start: number, end: number) => { assert.ok(end - start < 500); from = start; to = end; return query; },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(() => {
          if (table === "paciente_identidad") {
            events.push(`${control.final ? "final" : "initial"}-identity-page-${from}`);
            // M71: identity visibility can disappear even when patient links stay unchanged.
            const visible = identities.filter(identity => requestedIds.includes(identity.id) && identity.deleted_at === null &&
              rows.some(row => row.identidad_id === identity.id && row.cuenta_id === control.account))
              .sort((a, b) => a.id.localeCompare(b.id));
            return { data: structuredClone(visible.slice(from, Math.min(to + 1, from + control.pageCap))),
              count: control.identityBadCount ? null : visible.length,
              error: control.identityReadError ? { message: "SECRET identity DB" } : null };
          }
          events.push(`${control.final ? "final" : "initial"}-page-${from}`);
          const visible = rows.filter(row => control.omitFilter || (row.cuenta_id === account && row.pseudonimizado_en === null))
            .sort((a, b) => a.id.localeCompare(b.id));
          return { data: structuredClone(visible.slice(from, Math.min(to + 1, from + control.pageCap))),
            count: control.badCount ? null : visible.length,
            error: control.readError || (control.failPageFrom !== undefined && from >= control.failPageFrom) ? { message: "SECRET DB" } : null };
        }).then(resolve, reject),
      };
      return query;
    },
  };
  let auditCount = 0;
  const imports: Record<string, unknown> = {
    "server-only": {}, "next/server": { NextResponse },
    "next/headers": { headers: async () => { events.push("headers"); return new Headers(); } },
    "@/lib/db/errors": { ok: (data: unknown) => ({ ok: true, data }),
      err: (code: string, message: string) => ({ ok: false, error: { code, message } }) },
    "@/lib/db/paciente-session": { getPacienteSession: async () => {
      events.push("session");
      return control.initialError ? { ok: false, error: { code: control.initialError, message: "SECRET initial" } }
        : { ok: true, data: { userId: "actor", cuentaId: "account", email: "synthetic@example.invalid",
          emailVerified: true, telefonoVerified: false, pacientes: initial.slice(0, control.displayLimit) } };
    } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "@/lib/db/audit": { writeAuditEntry: async (input: { payload: unknown; resourceId: string }) => {
      events.push("audit"); assert.ok(!JSON.stringify(input.payload).includes("Paciente sintético"));
      assert.ok(assemblies.includes(input.resourceId));
      if (control.throwAudit) throw Error("SECRET audit");
      auditCount++;
      if (auditCount === assemblies.length) control.afterAudit?.();
      return { ok: true };
    } },
    "@/lib/legal/versions": { PRIVACY_VERSION: "synthetic", TERMS_VERSION: "synthetic" },
    "@/lib/support": { SUPPORT_EMAIL: "support@example.invalid" },
    "./export-builder": { buildPatientExport: async (input: { pacienteId: string; organizationId: string; clinicalHistory?: unknown }) => {
      assert.equal(input.clinicalHistory, undefined, "portal must not opt in to clinical history");
      assemblies.push(input.pacienteId); events.push("assemble");
      if (control.failAssembly === input.pacienteId) return { ok: false, error: { code: "db_error", message: "SECRET assembly" } };
      return { ok: true, data: { ok: true, exported_by: "profesional", organizacion: { id: input.organizationId },
        paciente: { id: input.pacienteId, identidad: { get nombre() { events.push("serialize"); return "Paciente sintético"; } } },
        turnos: [], consentimientos: [], notas: [] } };
    } },
  };
  const cache: Record<string, unknown> = {};
  const paths: Record<string, string> = { "../db/errors": "@/lib/db/errors" };
  const load = (name: string): unknown => {
    name = paths[name] ?? name;
    if (name in imports) return imports[name];
    if (name in cache) return cache[name];
    const path = name.startsWith("@/") ? name.slice(2) + ".ts" : name;
    const exports = {}; cache[name] = exports;
    runInNewContext(compile(path), { exports, require: load, Date, Object, Map, Set, JSON, Promise });
    return exports;
  };
  const run = () => (load("app/api/portal/export/route.ts") as { GET: () => Promise<NextResponse> }).GET();
  return { rows, identities, control, events, assemblies, run };
}

async function rejected(h: ReturnType<typeof harness>, status: number, code: string) {
  const response = await h.run();
  assert.equal(response.status, status);
  assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.ok(body.length < 1000);
  for (const value of ["SECRET", "Paciente sintético", "synthetic@example.invalid", "organizaciones", "historia_clinica", "SOAP"]) {
    assert.equal(body.includes(value), false, value);
  }
  assert.equal(JSON.parse(body).error.code, code);
}

test("portal real handler keeps multi-org JSON and current non-staff MFA policy", async () => {
  const h = harness(); const response = await h.run();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition")!, /^attachment;/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json(); assert.equal(data.organizaciones.length, 2);
  assert.equal(data.canal, "portal");
  assert.equal(JSON.stringify(data).includes("historia_clinica"), false);
  // Explanatory notes may mention SOAP; narrative payload keys must be absent.
  assert.equal(/"(?:SOAP|soap|tool_data|sesiones|enmiendas)"\s*:/.test(JSON.stringify(data)), false);
  assert.ok(h.events.lastIndexOf("audit") < h.events.indexOf("auth"));
  assert.ok(h.events.lastIndexOf("serialize") < h.events.indexOf("audit"), "serialize before audit and final authority waits");
  assert.equal(h.events.at(-1), "final-identity-page-0", "no asynchronous work after last authority read");
});

test("complete fan-out survives 1001 links and shorter server pages without trusting display list", async () => {
  const h = harness(1001); h.control.displayLimit = 1;
  const response = await h.run(); assert.equal(response.status, 200);
  assert.equal((await response.json()).organizaciones.length, 1001);
  assert.ok(h.events.includes("initial-page-903")); assert.ok(h.events.includes("final-page-903"));
  assert.ok(h.events.includes("initial-identity-page-129")); assert.ok(h.events.includes("final-identity-page-129"));
});

for (const code of ["auth_required", "mfa_required", "forbidden"] as const) test(`initial ${code} is bounded and does not read fichas`, async () => {
  const h = harness(); h.control.initialError = code;
  await rejected(h, code === "auth_required" ? 401 : 403, code);
  assert.deepEqual(h.events, ["session"]);
});

const mutations: Array<[string, number, string, (h: ReturnType<typeof harness>) => void]> = [
  ["expired session", 401, "auth_required", h => { h.control.user = null; }],
  ["MFA no longer allowed", 403, "mfa_required", h => { h.control.allowed = false; h.control.required = true; }],
  ["different user", 409, "conflict", h => { h.control.user = "other-actor"; }],
  ["removed account", 403, "forbidden", h => { h.control.account = null; }],
  ["different account", 409, "conflict", h => { h.control.account = "other-account"; }],
  ["one link removed", 409, "conflict", h => { h.rows[1].cuenta_id = null; }],
  ["all links removed", 409, "conflict", h => { h.rows.forEach(row => { row.cuenta_id = null; }); }],
  ["same-size relinked ficha", 409, "conflict", h => { h.rows[1].id = "other-ficha"; }],
  ["same ficha relinked identity", 409, "conflict", h => { h.rows[1].identidad_id = "other-identity"; }],
  ["same ficha changed organization", 409, "conflict", h => { h.rows[1].organization_id = "other-org"; }],
  ["missing identity", 409, "conflict", h => { h.rows[1].identidad_id = null; }],
  ["pseudonymized ficha", 409, "conflict", h => { h.rows[1].pseudonimizado_en = "2026-09-30"; }],
  ["missing exact count", 503, "network", h => { h.control.badCount = true; }],
  ["DB failure", 503, "network", h => { h.control.readError = true; }],
  ["Auth transport failure", 503, "network", h => { h.control.authThrow = true; }],
  ["MFA verification failure", 503, "network", h => { h.control.statusError = true; }],
  ["account RPC failure", 503, "network", h => { h.control.accountError = true; }],
];
for (const [name, status, code, mutate] of mutations) test(`${name} during final audit returns no exported data or attachment`, async () => {
  const h = harness(); h.control.afterAudit = () => mutate(h);
  await rejected(h, status, code); assert.equal(h.assemblies.length, 2);
});

test("an added link during audit aborts the previously assembled aggregate", async () => {
  const h = harness(); h.control.afterAudit = () => { h.rows.push({ ...h.rows[0], id: "p-new", identidad_id: "identity-new" }); };
  await rejected(h, 409, "conflict");
});
test("foreign row from faulty boundary fails closed before any assembly", async () => {
  const h = harness(); h.control.omitFilter = true; h.rows[1].cuenta_id = "other-account";
  await rejected(h, 409, "conflict"); assert.equal(h.assemblies.length, 0);
});
test("empty account never produces an empty successful download", async () => {
  const h = harness(0); await rejected(h, 404, "not_found");
});
test("a failed later ficha does not release the earlier aggregate", async () => {
  const h = harness(); h.control.failAssembly = h.rows[1].id;
  await rejected(h, 500, "db_error"); assert.equal(h.events.includes("audit"), false);
});
test("thrown audit returns a bounded transport error without a prepared attachment", async () => {
  const h = harness(); h.control.throwAudit = true; await rejected(h, 503, "network");
});
test("an existing allowed MFA requirement remains valid without adding clinical role gates", async () => {
  const h = harness(); h.control.required = true;
  assert.equal((await h.run()).status, 200);
});
test("an incomplete later final page cannot certify previously serialized bytes", async () => {
  const h = harness(130); h.control.afterAudit = () => { h.control.failPageFrom = 129; };
  await rejected(h, 503, "network");
  assert.ok(h.events.includes("final-page-129"));
});

test("identity loses visibility during audit without changing any linked IDs", async () => {
  const h = harness(); const linksBefore = structuredClone(h.rows);
  h.control.afterAudit = () => { h.identities[1].deleted_at = "2026-09-30"; };
  await rejected(h, 409, "conflict");
  assert.deepEqual(h.rows, linksBefore); assert.equal(h.assemblies.length, 2);
});
test("identity already hidden at baseline prevents assembly", async () => {
  const h = harness(); h.identities[0].deleted_at = "2026-09-30";
  await rejected(h, 409, "conflict"); assert.equal(h.assemblies.length, 0);
});
test("visible identities remain present in the same multi-org download", async () => {
  const h = harness(); const response = await h.run(); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).organizaciones.map((org: { paciente: { id: string } }) => org.paciente.id), h.rows.map(row => row.id));
  assert.ok(h.events.indexOf("initial-identity-page-0") < h.events.indexOf("assemble"));
  assert.equal(h.events.at(-1), "final-identity-page-0");
});
for (const target of ["identityReadError", "identityBadCount"] as const) test(`${target} during final audit returns no download`, async () => {
  const h = harness(); h.control.afterAudit = () => { h.control[target] = true; };
  await rejected(h, 503, "network");
});
test("visible identity from a different organization cannot confirm the original binding", async () => {
  const h = harness(); h.control.afterAudit = () => { h.identities[0].organization_id = "other-org"; };
  await rejected(h, 409, "conflict");
});
