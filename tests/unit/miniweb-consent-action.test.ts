import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const file = "app/(app)/configuracion/perfil-publico-actions.ts";
const memberId = "13000000-0000-4000-8000-000000000012";
const organizationId = "13000000-0000-4000-8000-000000000010";

function consentAction(readbacks: boolean[], failConfirm = false) {
  const revalidated: string[] = [];
  let writes = 0;
  let reads = 0;
  const query = {
    select() { return query; }, eq() { return query; },
    maybeSingle: async () => {
      reads++;
      return failConfirm && reads === 2
        ? { data: null, error: { message: "transport uncertain" } }
        : { data: { enabled: readbacks.shift() }, error: null };
    },
    update() { writes++; return query; },
    insert: async () => { writes++; return { error: null }; },
  };
  // PostgREST can report error:null for an UPDATE that touched zero rows.
  const client = { from: () => query };
  const mocks: Record<string, unknown> = {
    "next/cache": { revalidatePath: (path: string) => revalidated.push(path) },
    "@/lib/db/active-context": { getActiveContext: async () => ({ ok: true, data: {
      organization: { id: organizationId, slug: "example", tipo: "CLINICA", optOutPublicListing: false },
      session: { userId: "user-1", memberId, esColegiado: true },
    } }) },
    "@/lib/auth/mfa-access": { verifyMfaSession: async () => ({ ok: true, data: { user: { id: "user-1" } } }) },
    "@/lib/db/audit": { writeAuditEntry: async () => {} },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client, createSupabaseServiceClient: () => client },
    "@/lib/storage/professional-photos": {},
  };
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: (name: string) => mocks[name] });
  return { call: exports.setOwnMiniwebConsent, writes: () => writes, revalidated };
}

test("consent action does not report success when UPDATE silently affects zero rows", async () => {
  const action = consentAction([true, true]);
  const result = await action.call(false) as { ok: boolean; error?: string };
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Recargá/);
  assert.equal(action.writes(), 1);
  assert.deepEqual(action.revalidated, []);
});

test("consent action confirms revocation with readback and avoids duplicate writes", async () => {
  const action = consentAction([true, false]);
  const result = await action.call(false) as { ok: boolean };
  assert.equal(result.ok, true);
  assert.equal(action.writes(), 1);
  assert.equal(action.revalidated.length, 3);
  const alreadyRevoked = consentAction([false]);
  assert.equal((await alreadyRevoked.call(false) as { ok: boolean }).ok, true);
  assert.equal(alreadyRevoked.writes(), 0);
});

test("consent action marks a failed readback uncertain without retrying the write", async () => {
  const action = consentAction([true], true);
  const result = await action.call(false) as { ok: boolean; uncertain?: boolean };
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, true);
  assert.equal(action.writes(), 1);
  assert.deepEqual(action.revalidated, []);
});
