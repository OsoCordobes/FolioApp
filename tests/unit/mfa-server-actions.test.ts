import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { verifyMfaSession } from "../../lib/auth/mfa-access";

function protectedActions(policyError = false) {
  const calls: string[] = [];
  const client = {
    auth: { getUser: async () => { calls.push("getUser"); return { data: { user: { id: "dual-user" } }, error: null }; } },
    rpc: async () => { calls.push("policy"); return { data: { required: true, allowed: false, isStaff: true, hasVerifiedFactor: true, sessionValid: false }, error: policyError ? {} : null }; },
  };
  const exports: Record<string, () => Promise<{ ok: boolean }>> = {};
  const compiled = ts.transpileModule(readFileSync("app/(app)/configuracion/datos/actions.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireModule = (name: string): unknown => {
    if (name === "@/lib/me/personal-export") {
      const moduleExports = {};
      const output = ts.transpileModule(readFileSync("lib/me/personal-export.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      runInNewContext(output, { exports: moduleExports, require: requireModule });
      return moduleExports;
    }
    if (name === "@/lib/auth/mfa-access") return { verifyMfaSession };
    if (name === "@/lib/supabase/server") return {
      createSupabaseServerClient: async () => client,
      createSupabaseServiceClient: () => { calls.push("service-role"); throw new Error("Privileged boundary reached"); },
    };
    return {};
  };
  runInNewContext(compiled, { exports, require: requireModule });
  return { calls, exports };
}

for (const action of ["exportMyDataAction", "requestAccountDeletionAction", "cancelAccountDeletionAction"]) {
  test(`direct ${action} rejects a dual account at AAL1 before privileged work`, async () => {
    const f = protectedActions();
    assert.equal((await f.exports[action]()).ok, false);
    assert.deepEqual(f.calls, ["getUser", "policy"]);
  });
}
test("direct export fails closed when its authorization RPC is unavailable", async () => {
  const f = protectedActions(true);
  assert.equal((await f.exports.exportMyDataAction()).ok, false);
  assert.deepEqual(f.calls, ["getUser", "policy"]);
});

