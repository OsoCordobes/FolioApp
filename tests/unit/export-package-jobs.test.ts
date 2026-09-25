import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const id = (n: number) => `13400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = (user = 1, org = 10, role = "OWNER") => ({
  userId: id(user), memberId: id(user + 10), organizationId: id(org),
  role, esColegiado: role === "DIRECTOR", email: "spec@invalid.test",
  emailVerified: true, isInternalAccount: true,
});
const job = (overrides: Record<string, unknown> = {}) => ({
  job_id: id(100), actor_user_id: id(1), actor_member_id: id(11),
  organization_id: id(10), paciente_id: id(101),
  source_fingerprint: "a".repeat(64), state: "pending", revision: 0,
  expires_at: new Date(Date.now() + 60000).toISOString(), ...overrides,
});

function fixture(options: { authorized?: boolean; denyOnRevalidation?: number; rpcError?: boolean;
  rpcThrows?: boolean; emptyRead?: boolean; malformedRead?: boolean } = {}) {
  const calls: string[] = [];
  let revalidations = 0;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const source = readFileSync("lib/patient/export-jobs.ts", "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, {
    exports,
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name === "@/lib/auth/clinical-export-scope") return {
        canExportCompleteClinicalHistory: (role: string, colegiado: boolean) =>
          role === "OWNER" || (role === "DIRECTOR" && colegiado),
      };
      if (name === "@/lib/db/errors") return {
        ok: (data: unknown) => ({ ok: true, data }),
        err: (code: string, message: string) => ({ ok: false, error: { code, message } }),
      };
      if (name === "@/lib/supabase/server") return {
        createSupabaseServiceClient: () => ({
          rpc: async (method: string, params: Record<string, unknown>) => {
            calls.push(method);
            if (method === "export_package_begin") {
              assert.equal(params.p_actor, id(1));
              assert.equal(params.p_org, id(10));
            }
            if (options.rpcThrows) throw Error("SECRET endpoint bucket path");
            return { data: method === "export_package_begin" ? id(100)
              : method === "export_package_claim" ? [{ lease_token: id(501), revision: 1 }]
                : options.emptyRead && method === "export_package_read" ? []
                  : options.malformedRead && method === "export_package_read" ? { job_id: id(100) }
                    : [job()],
              error: options.rpcError ? { message: "SECRET endpoint bucket path" } : null };
          },
        }),
      };
      if (name === "./export-authorization") return {
        revalidateClinicalDelivery: async () => {
          calls.push("revalidate");
          revalidations += 1;
          return options.authorized === false || options.denyOnRevalidation === revalidations
            ? { ok: false, error: { code: "mfa_required", message: "MFA required" } }
            : { ok: true, data: undefined };
        },
      };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  return { calls, exports };
}

test("start binds authenticated actor and revalidates before privileged RPC", async () => {
  const f = fixture();
  const result = await f.exports.beginExportPackageJob(null, session(), {
    pacienteId: id(101), idempotencyKey: id(301),
    verifiedInventoryFingerprint: "a".repeat(64), expectedEntries: 2,
  }) as { ok: boolean; data: string };
  assert.equal(result.ok, true);
  assert.equal(result.data, id(100));
  assert.deepEqual(f.calls, ["revalidate", "export_package_begin"]);
});

test("revocation or MFA loss never reaches privileged creation or delivery", async () => {
  const f = fixture({ authorized: false });
  const started = await f.exports.beginExportPackageJob(null, session(), {
    pacienteId: id(101), idempotencyKey: id(301),
    verifiedInventoryFingerprint: "a".repeat(64), expectedEntries: 2,
  }) as { ok: boolean; error: { code: string } };
  assert.equal(started.ok, false);
  assert.equal(started.error.code, "mfa_required");
  const continued = await f.exports.authorizeExportPackageJob(null, session(), job()) as { ok: boolean };
  assert.equal(continued.ok, false);
  assert.deepEqual(f.calls, ["revalidate", "revalidate"]);
});

test("different principal, organization, member, role or expired job fails before clinical read", async () => {
  const f = fixture();
  for (const [who, row] of [
    [session(2), job()], [session(1, 20), job()], [session(), job({ actor_member_id: id(99) })],
    [session(1, 10, "ASISTENTE"), job()],
    [session(), job({ expires_at: new Date(Date.now() - 1000).toISOString() })],
    [session(), job({ state: "expired" })],
  ] as const) {
    const result = await f.exports.authorizeExportPackageJob(null, who, row) as { ok: boolean };
    assert.equal(result.ok, false);
  }
  assert.deepEqual(f.calls, []);
});

test("uncertain service response remains sanitized and never asserts creation", async () => {
  for (const options of [{ rpcError: true }, { rpcThrows: true }]) {
    const f = fixture(options);
    const result = await f.exports.beginExportPackageJob(null, session(), {
      pacienteId: id(101), idempotencyKey: id(301),
      verifiedInventoryFingerprint: "a".repeat(64), expectedEntries: 2,
    }) as { ok: boolean; error: { message: string } };
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|endpoint|bucket/i);
  }
});

test("claim reads bound job, checks current MFA twice and returns CAS lease", async () => {
  const f = fixture();
  const result = await f.exports.claimExportPackageJob(null, session(), id(100), 0) as
    { ok: boolean; data: { leaseToken: string; revision: number } };
  assert.equal(result.ok, true);
  assert.equal(result.data.leaseToken, id(501));
  assert.equal(result.data.revision, 1);
  assert.deepEqual(f.calls, ["export_package_read", "revalidate", "export_package_claim", "revalidate"]);
});

test("claim never calls privileged mutation after MFA revocation", async () => {
  const f = fixture({ authorized: false });
  const result = await f.exports.claimExportPackageJob(null, session(), id(100), 0) as { ok: boolean };
  assert.equal(result.ok, false);
  assert.deepEqual(f.calls, ["export_package_read", "revalidate"]);
});

test("MFA loss after claim does not return the acquired lease", async () => {
  const f = fixture({ denyOnRevalidation: 2 });
  const result = await f.exports.claimExportPackageJob(null, session(), id(100), 0) as
    { ok: boolean; error: { code: string }; data?: unknown };
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "mfa_required");
  assert.equal(result.data, undefined);
  assert.deepEqual(f.calls, ["export_package_read", "revalidate", "export_package_claim", "revalidate"]);
});

test("read distinguishes confirmed absence from an uncertain service error", async () => {
  const failed = fixture({ rpcError: true });
  const uncertain = await failed.exports.readExportPackageJob(null, session(), id(100)) as
    { ok: boolean; error: { code: string; message: string } };
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.error.code, "db_error");
  assert.doesNotMatch(JSON.stringify(uncertain), /SECRET|endpoint|bucket/i);
  const absent = fixture({ emptyRead: true });
  const missing = await absent.exports.readExportPackageJob(null, session(), id(100)) as
    { ok: boolean; error: { code: string } };
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not_found");
  const malformed = fixture({ malformedRead: true });
  const uncertainShape = await malformed.exports.readExportPackageJob(null, session(), id(100)) as
    { ok: boolean; error: { code: string } };
  assert.equal(uncertainShape.ok, false);
  assert.equal(uncertainShape.error.code, "db_error");
});
