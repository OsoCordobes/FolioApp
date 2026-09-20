import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const realRequire = createRequire(import.meta.url);
const orgId = "12700000-0000-4000-8000-000000000010";
const memberId = "12700000-0000-4000-8000-000000000011";
const userId = "12700000-0000-4000-8000-000000000001";
const originalOrgRevision = "2026-09-20T00:00:00Z";
const originalProfileRevision = "2026-09-20T00:00:01Z";
const command = {
  organizationId: orgId, memberId,
  expectedOrganizationUpdatedAt: originalOrgRevision,
  expectedProfileUpdatedAt: originalProfileRevision,
};

interface Fixture {
  role?: string;
  currentRole?: string;
  activeOrg?: string;
  storedBio?: string | null;
  storedRevision?: string;
  lostResponse?: boolean;
  transportError?: boolean;
  invalidReceipt?: boolean;
  statusZeroForbidden?: boolean;
  failBeforeCommit?: boolean;
}

function load({ role = "OWNER", currentRole = role, activeOrg = orgId,
  storedBio = "Bio existente", storedRevision = originalOrgRevision,
  lostResponse = false, transportError = false, invalidReceipt = false,
  statusZeroForbidden = false,
  failBeforeCommit = false }: Fixture = {}) {
  const org: Record<string, string | null> = {
    id: orgId, updated_at: storedRevision, nombre: "Consultorio", bio: storedBio,
    ciudad: null, provincia: null, telefono_publico: null, direccion_completa: null,
    instagram_handle: null, timezone: "America/Argentina/Cordoba", especialidad: "kinesiologia",
  };
  const profile: Record<string, string | null> = {
    id: userId, updated_at: originalProfileRevision, nombre_cifrado: "enc:Ana",
    apellido_cifrado: "enc:Paz", matricula: null,
  };
  let writes = 0;
  let calls = 0;
  let lastOrgPatch: Record<string, string | null> = {};
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls++;
      assert.equal(_name, "save_consultorio_atomic");
      const orgPatch = args.p_org_patch as Record<string, string | null>;
      const profilePatch = args.p_profile_patch as Record<string, string | null>;
      lastOrgPatch = orgPatch;
      if (statusZeroForbidden) return { data: null, error: { code: "42501", message: "forbidden" }, status: 0 };
      if (currentRole !== "OWNER" && currentRole !== "DIRECTOR") {
        return { data: null, error: { code: "42501", message: "role revoked" } };
      }
      if (org.updated_at !== args.p_expected_org_updated_at && Object.keys(orgPatch).length) {
        return { data: null, error: { code: "40001", message: "stale org" } };
      }
      if (profile.updated_at !== args.p_expected_profile_updated_at && Object.keys(profilePatch).length) {
        return { data: null, error: { code: "40001", message: "stale profile" } };
      }
      if (failBeforeCommit) throw new Error("network before commit");
      Object.assign(org, orgPatch);
      Object.assign(profile, profilePatch);
      if (Object.keys(orgPatch).length) org.updated_at = "2026-09-20T00:00:02Z";
      if (Object.keys(profilePatch).length) profile.updated_at = "2026-09-20T00:00:03Z";
      writes++;
      if (lostResponse) throw new Error("network after commit");
      if (transportError) return { data: null, error: { code: "", message: "TypeError: fetch failed" }, status: 0 };
      if (invalidReceipt) return { data: { organizationUpdatedAt: "", profileUpdatedAt: "" }, error: null };
      return { data: { organizationUpdatedAt: org.updated_at, profileUpdatedAt: profile.updated_at }, error: null };
    },
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filters[key] = value; return query; },
        is: () => query,
        maybeSingle: async () => ({ data: filters.id === (table === "organization" ? orgId : userId)
          ? table === "organization" ? org : profile : null, error: null }),
      };
      return query;
    },
  };
  const mocks: Record<string, unknown> = {
    "@/lib/crypto": {
      encryptColumn: (value: string) => `enc:${value}`,
      decryptColumn: (value: string) => value.replace(/^enc:/, ""),
    },
    "@/lib/db/members": { listProfesionalesPublico: async () => ({ ok: true, data: [] }) },
    "@/lib/especialidades/meta": { ESPECIALIDAD_SLUGS: ["quiropraxia", "cardiologia", "psicologia", "kinesiologia", "nutricion"] },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client,
      createSupabaseServiceClient: () => { throw new Error("broad service writer must not be used"); } },
    "./active-context": { getActiveContext: async () => ({ ok: true, data: {
      organization: { id: activeOrg }, profile: { id: userId },
      session: { memberId, userId, role },
    } }) },
    "./errors": { ok: (data: unknown) => ({ ok: true, data }),
      err: (code: string, message: string) => ({ ok: false, error: { code, message } }),
      mapSupabaseError: (error: { code: string }) => ({ code: error.code === "42501" ? "forbidden" : "db_error", message: "Error DB" }) },
  };
  const exports: Record<string, (input: unknown) => Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>> = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/db/configuracion.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => name in mocks ? mocks[name] :
    realRequire(name.startsWith("@/") ? resolve(name.slice(2)) : name.startsWith("./") ? resolve("lib/db", name) : name) });
  return { save: exports.saveConsultorio,
    get calls() { return calls; }, get writes() { return writes; },
    get org() { return org; }, get profile() { return profile; },
    get lastOrgPatch() { return lastOrgPatch; } };
}

test("DIRECTOR saves explicit public bio and own profile atomically", async () => {
  const fixture = load({ role: "DIRECTOR" });
  const result = await fixture.save({ ...command,
    organization: { bio: "Nueva presentación" }, profile: { matricula: "MP 127" } });
  assert.equal(result.ok, true);
  assert.equal(fixture.org.bio, "Nueva presentación");
  assert.equal(fixture.profile.matricula, "MP 127");
  assert.equal(fixture.writes, 1);
});

test("omitting bio preserves the existing public description", async () => {
  const fixture = load();
  assert.equal((await fixture.save({ ...command, organization: { nombre: "Nombre nuevo" } })).ok, true);
  assert.deepEqual(Object.keys(fixture.lastOrgPatch), ["nombre"]);
  assert.equal(fixture.org.bio, "Bio existente");
});

test("a lower role or changed context never reaches the writer", async () => {
  for (const options of [{ role: "PROFESIONAL" }, { activeOrg: "12700000-0000-4000-8000-000000000099" }]) {
    const fixture = load(options);
    const result = await fixture.save({ ...command, organization: { bio: "Forbidden" } });
    assert.equal(result.ok, false);
    assert.equal(fixture.calls, 0);
  }
});

test("revoked role and stale revision do not overwrite another value", async () => {
  const revoked = load({ role: "DIRECTOR", currentRole: "PROFESIONAL" });
  assert.equal((await revoked.save({ ...command, organization: { bio: "Forbidden" } })).error?.code, "forbidden");
  assert.equal(revoked.writes, 0);
  const stale = load({ storedBio: "Tercera bio", storedRevision: "2026-09-20T00:00:09Z" });
  assert.equal((await stale.save({ ...command, organization: { bio: "Mi bio" } })).error?.code, "conflict");
  assert.equal(stale.org.bio, "Tercera bio");
  const definite = load({ storedBio: "Mi bio", statusZeroForbidden: true });
  assert.equal((await definite.save({ ...command, organization: { bio: "Mi bio" } })).error?.code, "forbidden");
});

test("lost commit response is confirmed by readback; uncommitted network loss stays uncertain", async () => {
  const committed = load({ lostResponse: true });
  assert.equal((await committed.save({ ...command, organization: { bio: "Nueva bio" } })).ok, true);
  assert.equal(committed.writes, 1);
  const returnedError = load({ transportError: true });
  assert.equal((await returnedError.save({ ...command, organization: { bio: "Nueva bio" } })).ok, true);
  assert.equal(returnedError.writes, 1);
  const malformed = load({ invalidReceipt: true });
  const malformedResult = await malformed.save({ ...command, organization: { bio: "Nueva bio" } });
  assert.equal(malformedResult.ok, true);
  assert.notEqual((malformedResult.data as { organizationUpdatedAt: string }).organizationUpdatedAt, "");
  const notCommitted = load({ failBeforeCommit: true });
  assert.equal((await notCommitted.save({ ...command, organization: { bio: "Nueva bio" } })).error?.code, "network");
  assert.equal(notCommitted.writes, 0);
});
