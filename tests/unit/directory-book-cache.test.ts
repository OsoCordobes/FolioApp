import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const actual = createRequire(import.meta.url);
const source = ts.transpileModule(
  readFileSync("app/(app)/configuracion/directorio-actions.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

for (const listar of [true, false]) {
  test(`directory ${listar ? "opt-in" : "withdrawal"} invalidates the active booking page`, async () => {
    const paths: string[] = [];
    const patches: Array<Record<string, unknown>> = [];
    const filters: Array<[string, unknown]> = [];
    const query = {
      update: (patch: Record<string, unknown>) => { patches.push(patch); return query; },
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      select: (column: string) => { assert.equal(column, "slug"); return query; },
      single: async () => ({ data: { slug: "consultorio-propio" }, error: null }),
    };
    const exported: Record<string, (input: { listar: boolean }) => Promise<{ ok: boolean }>> = {};
    const imports: Record<string, unknown> = {
      "next/cache": { revalidatePath: (path: string) => paths.push(path) },
      zod: actual("zod"),
      "@/lib/db/errors": { err: () => ({ ok: false }), mapSupabaseError: () => ({}), ok: () => ({ ok: true }) },
      "@/lib/db/session": { getActiveSession: async () => ({ ok: true, data: { organizationId: "active-org", role: "OWNER" } }) },
      "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ from: (table: string) => {
        assert.equal(table, "organization");
        return query;
      } }) },
    };
    runInNewContext(source, { exports: exported, Date, require: (name: string) => imports[name] });

    assert.equal((await exported.setListarEnDirectorioAction({ listar })).ok, true);
    assert.deepEqual(filters, [["id", "active-org"]]);
    assert.equal(patches[0].listar_en_directorio, listar);
    assert.deepEqual(paths, ["/configuracion", "/profesionales", "/book/consultorio-propio"]);
  });
}
