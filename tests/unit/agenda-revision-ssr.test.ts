import { isAgendaRevisionToken } from "../../lib/agenda/revision-token";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file: string, imports: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, require(name: string) {
    if (name === "@/lib/agenda/revision-token") return { isAgendaRevisionToken };
    if (name in imports) return imports[name];
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }), Fragment: "Fragment" };
    return new Proxy({}, { get: (_target, key) => String(key) });
  } });
  return exports;
}

for (const page of ["hoy", "calendario"]) {
  for (const marker of ["9223372036854775807:2026-09-08", null]) {
    test(`${page}: awaits one trusted revision before view queries, propagating ${marker === null ? "failure" : "exact bigint"}`, async () => {
      const calls: string[] = [];
      let release!: (value: string | null) => void;
      const waiting = new Promise<string | null>(resolve => { release = resolve; });
      const session = { organizationId: "trusted-org", memberId: "trusted-member", esColegiado: false, role: "PROFESIONAL" };
      const data = { ok: true, data: { turnos: [], pacientes: {}, grid: [] } };
      const query = (name: string) => async () => { calls.push(name); return data; };
      const loaded = load(`app/(app)/${page}/page.tsx`, {
        "@/lib/db/session": { getActiveSession: async () => { calls.push("session"); return { ok: true, data: session }; } },
        "@/lib/db/active-context": { getActiveContext: async () => { calls.push("context"); return { ok: true, data: { session, organization: { id: "trusted-org", timezone: "America/Argentina/Cordoba" }, subscription: {} } }; } },
        "@/lib/db/agenda-revision": { readAgendaRevision: async (actual: unknown) => { assert.equal(actual, session); calls.push("revision"); return waiting; } },
        "@/lib/db/members": { listProfesionalesLite: async () => { calls.push("professionals"); return { ok: true, data: [] }; } },
        "@/lib/auth/capabilities": { capabilitiesFor: () => ({ actsAcrossProfessionals: false, canManageTeam: false }) },
        "@/lib/agenda/profesional": { resolveAgendaProfesional: () => ({ selectorVisible: false, profesionalIdEfectivo: "trusted-member" }) },
        "@/lib/db/hoy": { fechaHoyEnTz: () => "2026-09-08", getDashboardHoy: query("dashboard") },
        "@/lib/config/app-url": { getAppUrl: () => "http://127.0.0.1" },
        "@/lib/db/calendario": { getCalendarioSemana: query("week"), getCalendarioMes: query("month"), getMondayOfWeekInTz: () => "2026-09-07", monthAnchorInTz: () => "2026-09-01", shiftMonth: () => "2026-08-01", shiftWeek: () => "2026-08-31", formatMonthLabel: () => "Mes" },
      });
      const rendering = loaded.default({ searchParams: Promise.resolve({ organizationId: "browser-org", agendaRevision: "999:2026-09-08" }) });
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls, ["session", "revision"], "no view query may start while marker is pending");
      release(marker);
      const tree = await rendering as { props: { agendaRevision?: unknown; children?: Array<{ props?: { agendaRevision?: unknown } }> } };
      const props = page === "hoy" ? tree.props.children?.find(child => child && typeof child === "object" && child.props && "agendaRevision" in child.props)?.props : tree.props;
      assert.equal(props?.agendaRevision, marker);
      assert.deepEqual(calls, ["session", "revision", "context", "professionals", ...(page === "hoy" ? ["dashboard"] : ["week", "month"])]);
    });
  }
  test(`${page}: no revision or view read before a valid session`, async () => {
    let queried = false;
    const loaded = load(`app/(app)/${page}/page.tsx`, {
      "@/lib/db/session": { getActiveSession: async () => ({ ok: false, error: { message: "Unavailable" } }) },
      "@/lib/db/agenda-revision": { readAgendaRevision: async () => { queried = true; return "1:2026-09-08"; } },
    });
    await assert.rejects(loaded.default({ searchParams: Promise.resolve({}) }));
    assert.equal(queried, false);
  });
}

test("SSR revision helper preserves bigint text and hides SDK failures/malformed results", async () => {
  for (const result of [{ data: "9223372036854775807:2026-09-08", error: null }, { data: "9:2026-09-08", error: { message: "private SDK detail" } }, { data: 42 }, { data: "42" }, { data: "1:2026-02-29" }, { data: "NaN" }, { data: "1e3" }, { data: "1".repeat(20)+":2026-09-08" }, null]) {
    const calls: unknown[] = [];
    const loaded = load("lib/db/agenda-revision.ts", {
      "server-only": {},
      "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ rpc: async (...args: unknown[]) => { calls.push(args); if (result === null) throw new Error("private provider detail"); return result; } }) },
    });
    const value = await loaded.readAgendaRevision({ organizationId: "trusted-org" });
    assert.equal(value, result?.data === "9223372036854775807:2026-09-08" ? result.data : null);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["read_agenda_revision", { p_org: "trusted-org" }]]);
  }
});

