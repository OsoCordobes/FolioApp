import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the actual action module. Only framework/network boundaries are faked.
const realRequire = createRequire(import.meta.url);
function load(file: string, overrides: Record<string, unknown>): Record<string, (...args: unknown[]) => Promise<{ ok: boolean; data?: unknown }>> {
  const exports = {};
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    return realRequire(name.startsWith("@/") ? resolve(name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : name);
  }, console, process, FormData, File, Uint8Array, URL, Request, Response });
  return exports;
}

function scenario(role = "OWNER", completed = false, deleted: string | null = null, candidateEmail?: string) {
  const writes: string[] = [];
  const events: string[] = [];
  const additionalCandidates: unknown[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const user = { id: "user", email: "owner@example.test", email_confirmed_at: "2026-01-01" as string | null };
  const organization = { id: "org", slug: "consultorio", onboarding_completed: completed, deleted_at: deleted };
  const member = { id: "member", organization_id: "org", role, deleted_at: null };
  const session = { ok: true, data: { userId: user.id, organizationId: "org", memberId: "member", role } };
  const client = {
    storage: { from: () => ({ remove: async () => { writes.push("storage"); return { error: null }; } }) },
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (name === "mfa_access_status") return { data: { required: true, allowed: true, isStaff: true, hasVerifiedFactor: true, sessionValid: true }, error: null };
      return { data: name === "paciente_cuenta_actual" ? "account" : true, error: null };
    },
    from(table: string) {
      let single = false;
      let update: Record<string, unknown> | undefined;
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "lt", "order", "or", "neq"]) query[method] = () => query;
      for (const method of ["insert", "update", "delete"]) query[method] = (values?: Record<string, unknown>) => { writes.push(table); if (method === "update") update = values; return query; };
      query.single = query.maybeSingle = () => { single = true; return query; };
      query.then = (fn: (value: unknown) => unknown) => {
        if (table === "organization" && update) Object.assign(organization, update);
        return Promise.resolve({ data: table === "member" ? member : table === "organization" ? single ? organization : candidateEmail ? [organization] : [] : table === "paciente_identidad" && candidateEmail ? [{ id: "identity", organization_id: "org", email_hash: candidateEmail, dni_hash: "123", telefono_hash: null, paciente: { id: "patient", cuenta_id: null, pseudonimizado_en: null, deleted_at: null } }, ...additionalCandidates] : [], error: null }).then(fn);
      };
      return query;
    },
  };
  const overrides = {
    "server-only": {},
    "next/headers": { headers: async () => new Map() },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client, createSupabaseServiceClient: () => client },
    "@/lib/db/session": { getActiveSession: async () => session },
    "@/lib/crypto": { encryptColumn: (v: string) => v, blindIndex: (v: string) => v, blindIndexPhone: (v: string) => v },
    "@/lib/observability/events": { trackEvent: { onboardingCompleted() { events.push("completed"); } } },
    "@/lib/security/rate-limit": { limitByKey: async () => ({ ok: true }), limitByIp: async () => ({ ok: true }) },
    "@/lib/security/turnstile": { verifyTurnstile: async () => true },
    "@/lib/db/audit": { writeAuditEntry: async () => undefined },
  };
  return { writes, events, additionalCandidates, user, rpcCalls, member, loadActions: () => load("app/(public)/onboarding/actions.ts", overrides), loadLinkage: () => load("lib/portal/link-actions.ts", overrides) };
}

for (const role of ["PROFESIONAL", "ASISTENTE", "COORDINADOR", "DIRECTOR"]) {
  test(`onboarding refuses ${role} before any privileged write`, async () => {
    const s = scenario(role);
    const result = await s.loadActions().updateOnboardingStep(6, { servicios: [] });
    assert.equal(result.ok, false);
    assert.deepEqual(s.writes, []);
  });
}
test("completed onboarding cannot erase the service catalog", async () => {
  const s = scenario("OWNER", true);
  assert.equal((await s.loadActions().updateOnboardingStep(6, { servicios: [] })).ok, false);
  assert.deepEqual(s.writes, []);
});
test("deleted organization cannot complete onboarding", async () => {
  const s = scenario("OWNER", false, "2026-09-01");
  assert.equal((await s.loadActions().finalizeOnboarding()).ok, false);
  assert.deepEqual(s.writes, []);
});
test("active owner can continue the wizard", async () => {
  const s = scenario();
  assert.equal((await s.loadActions().updateOnboardingStep(4, { acento: "#777777" })).ok, true);
  assert.ok(s.writes.includes("organization"));
});
test("unverified Auth identity cannot run portal linkage", async () => {
  const s = scenario();
  s.user.email_confirmed_at = null;
  assert.equal((await s.loadLinkage().runLinkageForCurrentAccount({ email: "victim@example.test" })).ok, false);
  assert.deepEqual(s.writes, []);
});

test("forged email argument cannot grant a victim's portal record", async () => {
  const s = scenario("OWNER", false, null, "victim@example.test");
  await s.loadLinkage().runLinkageForCurrentAccount({ email: "victim@example.test", dni: "123" });
  assert.equal(s.rpcCalls.some(c => c.name === "portal_link_verified_patient"), false);
  assert.equal(s.writes.includes("paciente"), false);
});
test("verified matching adult candidate reaches the atomic RPC with Auth email", async () => {
  const s = scenario("OWNER", false, null, "owner@example.test");
  const result = await s.loadLinkage().runLinkageForCurrentAccount({ email: "victim@example.test", dni: "123" });
  assert.equal(result.ok, true);
  const rpc = s.rpcCalls.find(c => c.name === "portal_link_verified_patient");
  assert.equal(rpc?.args.p_verified_email, s.user.email);
  assert.equal(rpc?.args.p_email_hash, s.user.email);
  assert.equal(s.writes.includes("paciente"), false);
});
test("fresh role revocation takes precedence over a previously resolved OWNER session", async () => {
  const s = scenario();
  s.member.role = "ASISTENTE";
  assert.equal((await s.loadActions().finalizeOnboarding()).ok, false);
  assert.deepEqual(s.writes, []);
});
test("completed wizard cannot remove a logo through its old action", async () => {
  const s = scenario("OWNER", true);
  assert.equal((await s.loadActions().removeOrgLogo()).ok, false);
  assert.deepEqual(s.writes, []);
});
for (const role of ["OWNER", "DIRECTOR"]) {
  test(`normal settings preserve logo removal for ${role} after onboarding`, async () => {
    const s = scenario(role, true);
    assert.equal((await s.loadActions().removeSettingsOrgLogo()).ok, true);
    assert.deepEqual(s.writes, ["storage", "organization"]);
  });
}
test("normal settings still deny assistant logo removal", async () => {
  const s = scenario("ASISTENTE", true);
  assert.equal((await s.loadActions().removeSettingsOrgLogo()).ok, false);
  assert.deepEqual(s.writes, []);
});

test("OWNER retries completed onboarding successfully without writes or duplicate events", async () => {
  const s = scenario("OWNER", true);
  const result = await s.loadActions().finalizeOnboarding() as { ok: boolean; slug?: string };
  assert.equal(result.ok, true);
  assert.equal(result.slug, "consultorio");
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.events, []);
});
for (const role of ["DIRECTOR", "PROFESIONAL", "ASISTENTE", "COORDINADOR"]) {
  test(`${role} cannot finalize an already completed wizard`, async () => {
    const s = scenario(role, true);
    assert.equal((await s.loadActions().finalizeOnboarding()).ok, false);
    assert.deepEqual(s.writes, []);
  });
}
test("linked household record still blocks a new automatic portal linkage", async () => {
  const s = scenario("OWNER", false, null, "owner@example.test");
  s.additionalCandidates.push({ id: "family-identity", organization_id: "org", email_hash: "owner@example.test", dni_hash: "other", telefono_hash: null,
    paciente: { id: "family-patient", cuenta_id: "existing-account", pseudonimizado_en: null, deleted_at: null } });
  await s.loadLinkage().runLinkageForCurrentAccount({ dni: "123" });
  assert.equal(s.rpcCalls.some(c => c.name === "portal_link_verified_patient"), false);
});

for (const [role, esColegiado, fullAllowed, singleAllowed] of [
  ["OWNER", false, true, true], ["DIRECTOR", true, true, true],
  ["DIRECTOR", false, false, false], ["PROFESIONAL", true, false, true],
  ["ASISTENTE", false, false, false], ["COORDINADOR", false, false, false],
] as const) {
  for (const kind of ["json", "pdf-full", "pdf-session"] as const) {
    test(`${kind}: ${role} colegiado=${esColegiado} needs sufficient clinical delivery scope`, async () => {
      let clinicalReads = 0;
      const read = async () => { clinicalReads++; return { ok: false, error: { code: "not_found", message: "Fixture patient unavailable" } }; };
      const api = load(kind === "json" ? "app/api/patient/export/route.ts" : "app/api/pacientes/[id]/ficha-pdf/route.ts", {
        "next/headers": { headers: async () => new Map() },
        "next/server": { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
        "@/lib/db/active-context": { getActiveContext: async () => ({ ok: true, data: { session: { role, esColegiado }, organization: { id: "org" } } }) },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => ({}) },
        "@/lib/patient/export-builder": { buildPatientExport: read },
        "@/lib/db/paciente-ficha": { getPacienteFicha: read },
        "@/lib/db/sesiones": {}, "@/lib/pdf/ficha-pdf": {},
        "@/lib/db/audit": {},
      });
      const id = "98000000-0000-4000-8000-000000000040";
      const request = new Request(`http://localhost/export?paciente=${id}${kind === "pdf-session" ? `&sesion=${id}` : ""}`);
      const response = await api.GET(request, { params: Promise.resolve({ id }) }) as unknown as Response;
      const allowed = kind === "pdf-session" ? singleAllowed : fullAllowed;
      assert.equal(response.status, allowed ? 404 : 403);
      assert.equal(clinicalReads, allowed ? 1 : 0);
      if (role === "PROFESIONAL" && kind !== "pdf-session") assert.match(await response.text(), /responsable/i);
    });
  }
}

test("lost successful finalize response can be retried without a second write or event", async () => {
  const s = scenario();
  const actions = s.loadActions();
  assert.equal((await actions.finalizeOnboarding()).ok, true);
  assert.equal((await actions.finalizeOnboarding()).ok, true);
  assert.deepEqual(s.writes, ["organization"]);
  assert.deepEqual(s.events, ["completed"]);
});
