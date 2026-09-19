import { isAgendaRevisionToken } from "../../lib/agenda/revision-token";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function fixture(session: unknown, result: unknown = { data: "42:2026-09-08", error: null }, reject = false) {
  const calls: unknown[] = [];
  const exports: { GET?: () => Promise<Response> } = {};
  const code = ts.transpileModule(readFileSync("app/api/agenda/revision/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, Response, require(name: string) {
    if (name === "@/lib/agenda/revision-token") return { isAgendaRevisionToken };
    if (name === "@/lib/db/active-context") return { getActiveContext: async () => session };
    if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => ({
      rpc: async (rpc: string, args: unknown) => { calls.push([rpc, args]); if (reject) throw new Error("private provider content"); return result; },
    }) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { read: exports.GET!, calls };
}
const active = { ok: true, data: { session: { organizationId: "trusted-active-org" }, accessGate: { allowed: true }, organization: { isInternalAccount: false } } };

test("agenda marker uses only authenticated active organization and prohibits shared caching", async () => {
  const f = fixture(active);
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { organizationId: "trusted-active-org", revision: "42:2026-09-08" });
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [["read_agenda_revision", { p_org: "trusted-active-org" }]]);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
});
test("agenda marker denies no session, revocation, and MFA before querying the DB", async () => {
  for (const [code, status] of [["auth_required", 401], ["forbidden", 403], ["mfa_required", 403], ["no_org", 403], ["db", 503]] as const) {
    const f = fixture({ ok: false, error: { code, message: "private message" } });
    const r = await f.read();
    assert.equal(r.status, status); assert.equal(f.calls.length, 0);
    assert.deepEqual(await r.json(), { error: "agenda_revision_unavailable" });
  }
});
test("agenda marker cannot turn RPC failure or malformed revision into an unchanged agenda", async () => {
  for (const result of [{ data: null }, { data: 42 }, { data: "42" }, { data: "NaN" }, { data: "1:2026-02-29" }, { data: "42:2026-09-08", error: { code: "42501", message: "private content" } }]) {
    const r = await fixture(active, result).read();
    assert.equal(r.status, "error" in result ? 403 : 503);
    assert.deepEqual(await r.json(), { error: "agenda_revision_unavailable" });
  }
  assert.equal((await fixture(active, {}, true).read()).status, 503);
});

