import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { movementRequestSchema } from "../../lib/finanzas/filter-schema";

const valid = { periodo: "mes", status: "pendientes", query: "123,45", startUtc: "2026-09-01T03:00:00Z", endUtc: "2026-10-01T03:00:00Z" };
function action(allowed: boolean, active = true) {
  const observed: unknown[][] = [];
  const exports: Record<string, (input: unknown) => Promise<{ ok: boolean }>> = {};
  const js = ts.transpileModule(readFileSync("app/(app)/finanzas/actions.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, require(name: string) {
    if (name === "zod") return { z };
    if (name === "@/lib/finanzas/filter-schema") return { movementRequestSchema };
    if (name === "@/lib/db/active-context") return { getActiveContext: async () => active
      ? { ok: true, data: { session: { organizationId: "trusted-org", memberId: "trusted-member" } } }
      : { ok: false, error: { code: "mfa_required", message: "Verification required" } } };
    if (name === "@/lib/auth/guard") return { capabilitiesForSession: () => ({ canSeeFinanzas: allowed }) };
    if (name === "@/lib/db/finanzas-read") return { readFinanceMovements: async (...args: unknown[]) => {
      observed.push(args); return { ok: true, data: { rows: [], totalCount: 0, nextCursor: null } };
    } };
    if (name === "@/lib/db/errors") return { err: () => ({ ok: false }) };
    return {};
  } });
  return { execute: exports.listFinanceMovementsAction, observed };
}
test("direct movement action derives organization from active session, never the caller", async () => {
  const scenario = action(true);
  assert.equal((await scenario.execute({ ...valid, organizationId: "foreign", profesionalMemberId: null })).ok, true);
  assert.equal((scenario.observed[0][0] as { organizationId: string }).organizationId, "trusted-org");
  assert.equal((scenario.observed[0][1] as { query: string }).query, "123,45");
});
test("direct movement action rejects no-finance roles, MFA failures and invalid ranges before DB access", async () => {
  for (const scenario of [action(false), action(true, false)]) {
    assert.equal((await scenario.execute(valid)).ok, false);
    assert.equal(scenario.observed.length, 0);
  }
  const scenario = action(true);
  for (const input of [{ ...valid, endUtc: valid.startUtc }, { ...valid, startUtc: "2020-01-01T03:00:00Z" }, { ...valid, query: "x".repeat(121) }]) {
    assert.equal((await scenario.execute(input)).ok, false);
  }
  assert.equal(scenario.observed.length, 0);
});
