import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as money from "../../lib/format/financial-money";
import type { FinanzasData } from "../../lib/db/finanzas";

test("dashboard uses database summary and one bounded page; future buckets and large cent totals reconcile", async () => {
  const exports: Record<string, (input: unknown) => Promise<{ ok: boolean; data: FinanzasData }>> = {};
  const calls: string[] = [];
  const cents = "900719925474099301";
  const js = ts.transpileModule(readFileSync("lib/db/finanzas.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, require(name: string) {
    if (name === "@/lib/format/financial-money") return money;
    if (name === "./errors") return { ok: (data: unknown) => ({ ok: true, data }) };
    if (name === "./finanzas-read") return {
      readFinanceSummary: async () => { calls.push("summary"); return { ok: true, data: {
        paid_cents: cents, pending_cents: "29", previous_cents: "0", pending_count: 1, sessions: 3,
        days: [{ bucket: "2099-09-28", cents }], services: [{ id: "service", nombre: "Servicio", cents, count: 1501 }], professionals: [],
      } }; },
      readFinanceMovements: async () => { calls.push("page"); return { ok: true, data: { rows: [], totalCount: 1502, nextCursor: null } }; },
    };
    if (name === "@/lib/finanzas/movements") return {};
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const result = await exports.getFinanzasDelMes({ organizationId: "synthetic", timezone: "America/Argentina/Cordoba", monthAnchor: "2099-09-01" });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["summary", "page"]);
  assert.equal(result.data.exact.ingresos, cents);
  assert.equal(result.data.ingresosPorDia.reduce((sum, d) => sum + BigInt(d.montoCents!), BigInt(0)).toString(), cents);
  assert.equal(result.data.ingresosPorDia.at(-1)?.fecha, "2099-09-28");
  assert.equal(result.data.datosParciales, false);
});
