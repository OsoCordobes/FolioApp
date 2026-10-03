import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

import { countClinicProfessionals, isBillableClinicProfessional } from "../../lib/db/billing-professionals";
import { computeClinicBreakdownCents, computeMonthlyPriceCents } from "../../lib/billing/pricing";
import { decideUpgradeTipo } from "../../lib/billing/upgrade";
import { err, ok } from "../../lib/db/errors";

const org = "synthetic-clinic";
const members = [
  { role: "OWNER", es_colegiado: false, profile_id: "admin-owner" },
  { role: "DIRECTOR", es_colegiado: false },
  { role: "OWNER", es_colegiado: true },
  { role: "DIRECTOR", es_colegiado: true },
  { role: "PROFESIONAL", es_colegiado: true },
  { role: "ASISTENTE", es_colegiado: false },
  { role: "COORDINADOR", es_colegiado: false },
  { role: "PROFESIONAL", es_colegiado: true, deleted_at: "2026-09-01" },
].map((m, i) => ({ id: `synthetic-${i}`, organization_id: org, profile_id: `profile-${i}`, deleted_at: null, ...m }));

/** Executes the actual consumer modules; framework, external integrations and
 * provider mutations are replaced. No hosted client, emails or payment API. */
function load(file: string, mocks: Record<string, unknown>, expose = "") {
  type RuntimeResult = { ok: boolean; data: Record<string, number>; props: {
    clinicPricing: { seats: number; extraSeats: number; totalArs: number };
    membersActivos: number; montoClinicaCents: number;
  } };
  const exports: Record<string, (...args: unknown[]) => Promise<RuntimeResult>> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8") + expose, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, Date, Math, Map, Set, Error, Promise, process: { env: {} },
    require(name: string) {
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
      if (name === "./errors") return { err, ok };
      return mocks[name] ?? {};
    },
  });
  return exports;
}

function fixture(options: { rows?: typeof members; countError?: boolean; missingCount?: boolean; truncated?: boolean } = {}) {
  const queries: Array<{ table: string; filters: Record<string, unknown>; head: boolean }> = [];
  const writes: string[] = [];
  const team = [...(options.rows ?? members), { ...members[4], id: "foreign", organization_id: "other-tenant" }];
  const client = { from(table: string) {
    const query = { table, filters: {} as Record<string, unknown>, head: false };
    queries.push(query);
    let writing = false;
    const builder = {
      select(_columns: string, settings?: { head?: boolean }) { query.head = settings?.head === true; return builder; },
      eq(key: string, value: unknown) { query.filters[key] = value; return builder; },
      is(key: string, value: unknown) { query.filters[key] = value; return builder; },
      in(key: string, value: unknown[]) { query.filters[key] = value; return builder; },
      gte() { return builder; }, order() { return builder; }, limit() { return builder; },
      update() { writing = true; writes.push(table); return builder; },
      insert() { writes.push(table); return Promise.resolve({ error: null }); },
      maybeSingle() {
        if (table === "organization") return Promise.resolve({ data: { id: org, tipo: "INDEPENDIENTE" }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (value: unknown) => unknown) {
        if (table === "organization") return Promise.resolve(resolve({ data: writing ? [{ id: org }] : [{ id: org, tipo: "CLINICA", created_at: "2026-09-06" }], error: null }));
        if (table === "suscripcion") return Promise.resolve(resolve({ data: [], error: null }));
        if (table === "profile") return Promise.resolve(resolve({ data: [{ id: "admin-owner", email: "admin@example.test" }], error: null }));
        assert.equal(table, "member", "pending invitations must never be counted");
        const rows = team.filter(m => Object.entries(query.filters).every(([k, v]) => Array.isArray(v) ? v.includes(m[k as keyof typeof m]) : m[k as keyof typeof m] === v));
        return Promise.resolve(resolve({ data: query.head ? null : options.truncated ? rows.slice(0, 1) : rows,
          count: options.missingCount ? null : rows.length, error: options.countError ? { message: "synthetic failed query" } : null }));
      },
    };
    return builder;
  } };
  return { client, queries, writes };
}

test("mixed clinic counts treating OWNER/DIRECTOR/PROFESIONAL, excludes admin/reception/deleted and foreign tenant", async () => {
  const f = fixture();
  const result = await countClinicProfessionals(f.client as never, org);
  assert.deepEqual(result, ok(3));
  assert.equal(members.filter(isBillableClinicProfessional).length, 3);
  assert.deepEqual(f.queries.map(q => q.table), ["member"]);
  assert.equal(computeMonthlyPriceCents("CLINICA", result.ok ? result.data : -1), 17_500_000);
  assert.equal(f.writes.length, 0);
});

test("installed Supabase client serializes an exact HEAD count scoped to treating professionals, never invitations", async () => {
  const requests: string[] = [];
  const client = createClient("http://127.0.0.1:54321", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      assert.equal(options?.method, "HEAD");
      assert.equal(url.pathname, "/rest/v1/member");
      assert.equal(url.searchParams.get("organization_id"), `eq.${org}`);
      assert.equal(url.searchParams.get("es_colegiado"), "eq.true");
      assert.equal(url.searchParams.get("deleted_at"), "is.null");
      assert.equal(new Headers(options?.headers).get("prefer"), "count=exact");
      return new Response(null, { status: 200, headers: { "content-range": "*/3" } });
    } },
  });
  assert.deepEqual(await countClinicProfessionals(client, org), ok(3));
  assert.deepEqual(requests, ["/rest/v1/member"]);
});

for (const n of [0, 1, 4]) test(`${n} treating professionals: fixed + N prices, never an included seat`, async () => {
  const rows = [members[0], members[5], ...Array.from({ length: n }, (_, i) => ({ ...members[4], id: `clinician-${i}` }))];
  const f = fixture({ rows });
  const count = await countClinicProfessionals(f.client as never, org);
  assert.deepEqual(count, ok(n));
  const expected = 10_000_000 + n * 2_500_000;
  assert.equal(computeMonthlyPriceCents("CLINICA", n), expected);
  assert.equal(computeClinicBreakdownCents(n).totalCents, expected);
  assert.equal(computeClinicBreakdownCents(n).extraSeats, n);
  assert.equal(decideUpgradeTipo({ tipoActual: "INDEPENDIENTE", rol: "OWNER", membersActivos: n, estadoSuscripcion: null }).montoDespues, expected);
});

for (const options of [{ countError: true }, { missingCount: true }]) test(`failed/unconfirmed count has no fabricated base (${JSON.stringify(options)})`, async () => {
  const result = await countClinicProfessionals(fixture(options).client as never, org);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "db_error");
});

function consumerMocks(f: ReturnType<typeof fixture>) {
  const session = { role: "OWNER", esColegiado: false, organizationId: org, memberId: "member", userId: "user" };
  const context = { session, organization: { id: org, tipo: "CLINICA", slug: "fixture", isInternalAccount: false },
    accessGate: { allowed: true }, subscription: { estado: "SIN_SUSCRIPCION" }, profile: { email: "owner@example.test" } };
  return {
    "@/lib/db/billing-professionals": { countClinicProfessionals, isBillableClinicProfessional },
    "@/lib/billing/pricing": { computeMonthlyPriceCents, computeClinicBreakdownCents },
    "@/lib/billing/upgrade": { decideUpgradeTipo },
    "@/lib/db/errors": { err, ok },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => f.client, createSupabaseServiceClient: () => f.client },
    "@/lib/db/active-context": { getActiveContext: async () => ok(context) },
    "@/lib/db/session": { getActiveSession: async () => ok(session) },
    "@/lib/auth/capabilities": { capabilitiesFor: () => ({ canManageTeam: false }) },
    "@/lib/db/configuracion": { getConfiguracionData: async () => ok({ tipo: "CLINICA" }) },
    "@/lib/db/directorio": { isOrgListedInDirectory: async () => false },
    "@/lib/db/paciente-claims": { puedeResolverClaims: () => false },
    "@/lib/google/oauth-error": { mensajeErrorOauthGoogle: () => null },
    "@/lib/db/suscripcion": { GRACE_PERIOD_DAYS: 30, loadSubscriptionForOrg: async () => ok(null), decideSubscriptionAmountSync: () => ({ action: "skip" }),
      syncSubscriptionAmountInBackground: () => {} },
    "next/cache": { revalidatePath: () => {} },
  };
}

test("activation/sync resolver, configuration, billing and upgrade use same exact professional count", async () => {
  const f = fixture(), mocks = consumerMocks(f);
  const sub = load("lib/db/suscripcion.ts", mocks, "\nexport { resolveExpectedAmountForOrg };\n");
  // Organization resolver reads CLINICA, not the upgrade fixture's INDEPENDIENTE.
  const orgClient = { ...f.client, from(table: string) {
    if (table !== "organization") return f.client.from(table);
    const builder = { select() { return builder; }, eq() { return builder; }, is() { return builder; },
      maybeSingle: async () => ({ data: { tipo: "CLINICA" }, error: null }) };
    return builder;
  } };
  const expected = await sub.resolveExpectedAmountForOrg(orgClient, org);
  assert.equal(expected.data.expectedCents, 17_500_000);
  const billing = await load("app/(app)/configuracion/billing/page.tsx", mocks).default({ searchParams: Promise.resolve({}) });
  assert.equal(billing.props.clinicPricing.seats, 3);
  assert.equal(billing.props.clinicPricing.extraSeats, 3);
  assert.equal(billing.props.clinicPricing.totalArs, 175_000);
  const config = await load("app/(app)/configuracion/page.tsx", mocks).default({ searchParams: Promise.resolve({}) });
  assert.equal(config.props.membersActivos, 3);
  assert.equal(config.props.montoClinicaCents, 17_500_000);
  const upgrade = await load("app/(app)/configuracion/actions.ts", mocks).upgradeOrgTipoAction();
  assert.equal(upgrade.ok, true);
  assert.equal(upgrade.data.montoDespuesCents, 17_500_000);
  assert.deepEqual(f.queries.filter(q => q.table === "member").map(q => q.filters), Array(4).fill({ organization_id: org, es_colegiado: true, deleted_at: null }));
});

test("trial pricing uses professionals and retains administrative OWNER as recipient", async () => {
  const f = fixture(), sent: Array<Record<string, unknown>> = [];
  const mocks = { ...consumerMocks(f),
    "@/lib/db/suscripcion": { GRACE_PERIOD_DAYS: 30, computeAccessGate: () => ({ graceDaysLeft: 3 }) },
    "@/lib/billing/lifecycle": { decideLifecycleEmails: () => [{ tipo: "trial_por_vencer", diasRestantes: 3 }] },
    "@/lib/email/notify": { notifyTrialPorVencer: async (input: Record<string, unknown>) => { sent.push(input); return { ok: true, status: "sent" }; } },
  };
  const cron = load("app/api/cron/reconcile-suscripciones/route.ts", mocks, "\nexport { runTrialAvisos };\n");
  await cron.runTrialAvisos(f.client, new Date("2026-10-03"), {});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].montoMensualCents, 17_500_000);
  assert.equal(sent[0].destinatario, "admin@example.test");
  assert.equal(f.writes.length, 0);
});

test("incomplete batch of trial members stops before sending an incorrect price", async () => {
  const f = fixture({ truncated: true });
  const cron = load("app/api/cron/reconcile-suscripciones/route.ts", consumerMocks(f), "\nexport { runTrialAvisos };\n");
  await assert.rejects(() => cron.runTrialAvisos(f.client, new Date("2026-10-03"), {}), /equipo completo/);
});

test("count error prevents activation amount, billing display and upgrade writes", async () => {
  const f = fixture({ countError: true }), mocks = consumerMocks(f);
  const billing = load("app/(app)/configuracion/billing/page.tsx", mocks);
  await assert.rejects(() => billing.default({ searchParams: Promise.resolve({}) }), /contando profesionales/);
  const config = load("app/(app)/configuracion/page.tsx", mocks);
  await assert.rejects(() => config.default({ searchParams: Promise.resolve({}) }), /contando profesionales/);
  const upgrade = await load("app/(app)/configuracion/actions.ts", mocks).upgradeOrgTipoAction();
  assert.equal(upgrade.ok, false);
  assert.equal(f.writes.length, 0);
});
