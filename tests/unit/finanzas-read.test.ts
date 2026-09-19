import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as money from "../../lib/format/financial-money";

function reader(reply: unknown) {
  const observed: Array<Record<string, unknown>> = [];
  const exports: Record<string, (...input: unknown[]) => Promise<{ ok: boolean }>> = {};
  const js = ts.transpileModule(readFileSync("lib/db/finanzas-read.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, require(name: string) {
    if (name === "@/lib/crypto") return { blindIndexCandidatos: (_query: string, org?: string) => [org ? "salted" : "legacy"], decryptColumn: () => "Synthetic" };
    if (name === "@/lib/format/financial-money") return money;
    if (name === "./errors") return { ok: (data: unknown) => ({ ok: true, data }), err: () => ({ ok: false }) };
    if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => ({ rpc: async (_name: string, args: Record<string, unknown>) => {
      observed.push(args); return { data: reply, error: null };
    } }) };
    return {};
  } });
  return { observed, read: () => exports.readFinanceMovements({ organizationId: "trusted", startUtc: "2026-09-01", endUtc: "2026-10-01" },
    { query: "1.234,56", status: "pendientes" }) };
}
test("movement reader binds complete filters and caps the requested page", async () => {
  const scenario = reader({ rows: [], total_count: 0, has_more: false, revision: null });
  assert.equal((await scenario.read()).ok, true);
  assert.equal(scenario.observed[0].p_amount_cents, "123456");
  assert.equal(scenario.observed[0].p_limit, 50);
  assert.equal(scenario.observed[0].p_status, "pendientes");
  assert.deepEqual(Array.from(scenario.observed[0].p_hashes as string[]), ["salted", "legacy"]);
});
test("missing page metadata or an empty page with more results is an error, never fake completion", async () => {
  for (const reply of [null, {}, { rows: [], total_count: 1, has_more: true }, { rows: [], total_count: 0 },
    { rows: [], total_count: -1, has_more: false }]) {
    assert.equal((await reader(reply).read()).ok, false);
  }
});
