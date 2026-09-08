import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { collectDirectoryExport, directoryFilterSchema, DIRECTORY_EXPORT_MAX_BYTES, type DirectoryPage } from "../../lib/pacientes/directory";
import { csvEscapeTexto } from "../../lib/format/csv";
import { formatCobertura } from "../../lib/pacientes/cobertura";

function route({ failAt = -1, unauthorized = false, oversized = false } = {}) {
  const session = { organizationId: "synthetic-org", memberId: "synthetic-member" };
  let calls = 0;
  const filters: Record<string, string | null>[] = [];
  const exports: { POST?: (req: Request) => Promise<Response> } = {};
  const imports: Record<string, unknown> = {
    "@/lib/db/session": { getActiveSession: async () => unauthorized ? { ok: false } : { ok: true, data: session } },
    "@/lib/db/pacientes-dir": { getPacientesDirectorio: async (input: Record<string, string | null>, cutoff: string | undefined, expected: unknown) => {
      calls++; filters.push(input);
      assert.deepEqual(JSON.parse(JSON.stringify(expected)), session);
      if (calls === failAt) return { ok: false };
      const offset = Number(input.cursor ?? 0);
      const rows = Array.from({ length: Math.min(50, 1205-offset) }, (_,i) => ({ id: String(offset+i), nombre: oversized ? "x".repeat(100000) : "=SYNTHETIC()", tel: "3515550100", email: "", tipo: "nuevo" as const, sesiones: 0, ultima: null, proximo: null, tags: [], estado: "activo" as const, cobertura: null, coberturaPlan: null }));
      const page: DirectoryPage = { rows, total: 1205, nextCursor: offset+50<1205 ? String(offset+50) : null, cutoff: "synthetic-cutoff", revision: "a".repeat(32), counts: {}, coberturas: [] };
      return { ok: true, data: page };
    } },
    "@/lib/pacientes/directory": { collectDirectoryExport, directoryFilterSchema, DIRECTORY_EXPORT_MAX_BYTES },
    "@/lib/format/csv": { csvEscapeTexto }, "@/lib/pacientes/cobertura": { formatCobertura },
  };
  runInNewContext(ts.transpileModule(readFileSync("app/(app)/pacientes/export/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, URLSearchParams, TextEncoder, require: (name: string) => { if (!(name in imports)) throw new Error(name); return imports[name]; } });
  return { post: exports.POST!, filters, calls: () => calls };
}
const request = (origin = "http://127.0.0.1", body = "query=Paciente+Exacto&status=alta&coverage=PLAN") => new Request("http://127.0.0.1/pacientes/export", { method: "POST", headers: { origin }, body });
test("directory POST exports all filtered pages as one complete safe CSV", async () => {
  const f = route(); const response = await f.post(request());
  assert.equal(response.status, 200); assert.equal(f.calls(), 26);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const csv = await response.text(); assert.equal(csv.split("\r\n").length, 1206);
  assert.equal(csv.includes("'=SYNTHETIC()"), true);
  for (const filter of f.filters) { assert.equal(filter.query, "Paciente Exacto"); assert.equal(filter.status, "alta"); assert.equal(filter.coverage, "PLAN"); }
});
for (const failure of ["late-page", "final-recheck", "oversized", "unauthorized", "cross-origin", "invalid-query"] as const) {
  test(`directory POST returns no CSV attachment on ${failure}`, async () => {
    const f = route({ failAt: failure === "late-page" ? 23 : failure === "final-recheck" ? 26 : -1, unauthorized: failure === "unauthorized", oversized: failure === "oversized" });
    const response = await f.post(request(failure === "cross-origin" ? "https://outside.invalid" : undefined, failure === "invalid-query" ? "status=invalid" : undefined));
    assert.notEqual(response.status, 200);
    assert.equal(response.headers.get("Content-Disposition"), null);
    assert.equal((await response.text()).includes("SYNTHETIC()"), false);
  });
}
