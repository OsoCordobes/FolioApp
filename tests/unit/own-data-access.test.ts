import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { decideRouteGate } from "../../lib/auth/route-decision";

type Element = { type: string; props: Record<string, unknown> };
function scenario({ errorCode, profileError = false }: { errorCode?: string; profileError?: boolean } = {}) {
  const filters: Array<[string, unknown]> = [];
  let reads = 0;
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const profile = { email: "owner@synthetic.invalid", deletion_requested_at: "2026-09-01T00:00:00Z", deletion_reason: "Synthetic request" };
  const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, maybeSingle: async () => ({ data: profileError ? null : profile, error: profileError ? { message: "private failure" } : null }) };
  const client = { from: (table: string) => { assert.equal(table, "profile"); reads++; return query; } };
  const imports: Record<string, unknown> = {
    "server-only": {}, "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "@/app/(app)/configuracion/datos/datos-client": { DatosClient: "DatosClient" },
    "@/lib/auth/mfa-access": { verifyMfaSession: async (received: unknown) => { assert.equal(received, client); return errorCode ? { ok: false, error: { code: errorCode } } : { ok: true, data: { user: { id: "current-user", email: profile.email } } }; } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client, createSupabaseServiceClient: () => { throw new Error("No privileged profile read"); } },
    "@/lib/support": { supportMailto: () => "mailto:support@synthetic.invalid" },
  };
  const exports: { OwnDataPage?: (props: unknown) => Promise<Element> } = {};
  runInNewContext(ts.transpileModule(readFileSync("components/configuracion/own-data-page.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: (name: string) => { if (name in imports) return imports[name]; throw new Error(`Unexpected dependency ${name}`); } });
  return { page: () => exports.OwnDataPage!({ returnPath: "/mis-datos", standalone: true }), filters, reads: () => reads };
}
test("account-data entry requires authentication but no clinic route or billing allowance", async () => {
  assert.deepEqual(decideRouteGate("/mis-datos", false), { kind: "redirect", to: "/login", keepRedirectParam: true });
  assert.deepEqual(decideRouteGate("/mis-datos", true), { kind: "pass" });
  const entry = readFileSync("app/mis-datos/page.tsx", "utf8");
  assert.match(entry, /returnPath="\/mis-datos"/);
  const s = scenario();
  const rendered = JSON.stringify(await s.page());
  assert.deepEqual(s.filters, [["id", "current-user"]]);
  assert.match(rendered, /Synthetic request/);
  assert.match(rendered, /suscripción de tu consultorio está suspendida/);
  assert.match(rendered, /no incluye las historias clínicas/);
});
for (const [code, destination] of [["auth_required", "/login?redirect=/mis-datos"], ["mfa_required", "/seguridad/mfa?next=/mis-datos"]]) {
  test(`account-data ${code} resumes at the independent entry`, async () => {
    const s = scenario({ errorCode: code });
    await assert.rejects(s.page, { message: `redirect:${destination}` });
    assert.equal(s.reads(), 0);
  });
}
test("unavailable security or profile never becomes an empty account or a login loop", async () => {
  for (const settings of [{ errorCode: "network" }, { profileError: true }]) {
    const s = scenario(settings), rendered = JSON.stringify(await s.page());
    assert.match(rendered, /alert/);
    assert.doesNotMatch(rendered, /DatosClient|private failure|Synthetic request/);
    assert.match(rendered, /\/mis-datos/);
  }
});
test("both blocked staff and owner billing screens link to independent account data", () => {
  for (const file of ["components/billing/billing-page.tsx", "components/billing/billing-locked-member.tsx"]) assert.match(readFileSync(file, "utf8"), /href="\/mis-datos"/);
});
