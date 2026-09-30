import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { createServerClient } from "@supabase/ssr";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/local-test";
import { AUDIT_BARRIER_SQL, auditBarrierObserved, assertPortalFixture, PORTAL_EXPORT_FIXTURE_NAME,
  PORTAL_EXPORT_MARKERS, PORTAL_EXPORT_FAILURE_PREFIX, portalFailure,
  type PortalProofPhase, type PortalProofFixture } from "../../scripts/testing/caller-proof/portal-export-contract";

const APP = "http://localhost:4430";
const HIDDEN_AT = "2026-09-30T00:00:00Z";
function diagnose(error: unknown, context: Parameters<typeof portalFailure>[1]) {
  console.log(PORTAL_EXPORT_FAILURE_PREFIX + JSON.stringify(portalFailure(error, context)));
}

async function authenticated(page: Page) {
  assert.equal(process.env.CI, "true"); assert.equal(process.env.FOLIO_TEST_REAL_SUPABASE, "1");
  assert.equal(process.env.E2E_BASE_URL, APP);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:55421");
  assert.equal(JSON.parse(process.env.FOLIO_TEST_APP_CONFIG!).clinical, false);
  const fixture = JSON.parse(await readFile(path.join(tmpdir(), PORTAL_EXPORT_FIXTURE_NAME), "utf8")) as PortalProofFixture;
  assertPortalFixture(fixture);
  await page.context().addCookies(fixture.browserCookies);
  const actor = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => fixture.browserCookies, setAll: () => {} },
  });
  const user = await actor.auth.getUser(); assert.equal(user.error, null); assert.equal(user.data.user?.id, fixture.userId);
  const gate = await actor.rpc("mfa_access_status"); assert.equal(gate.error, null);
  assert.deepEqual(gate.data, { required: true, allowed: true, isStaff: false, hasVerifiedFactor: true, sessionValid: true });
  const account = await actor.rpc("paciente_cuenta_actual"); assert.equal(account.error, null); assert.equal(account.data, fixture.cuentaId);
  const memberships = await actor.from("member").select("id"); assert.equal(memberships.error, null); assert.deepEqual(memberships.data, []);
  const ids = [...fixture.links, fixture.foreign].map(link => link.patientId);
  const patients = await actor.from("paciente").select("id").in("id", ids); assert.equal(patients.error, null);
  assert.deepEqual(patients.data!.map(row => row.id).sort(), fixture.links.map(link => link.patientId).sort());
  const identities = await actor.from("paciente_identidad").select("id").in("id", [...fixture.links, fixture.foreign].map(link => link.identityId));
  assert.equal(identities.error, null);
  assert.deepEqual(identities.data!.map(row => row.id).sort(), fixture.links.map(link => link.identityId).sort());
  console.log(PORTAL_EXPORT_MARKERS[0]);
  return { fixture, actor };
}

async function positive(page: Page, fixture: PortalProofFixture) {
  const response = await page.request.get(`${APP}/api/portal/export`, { maxRedirects: 0, timeout: 90_000 });
  assert.equal(response.status(), 200, "portal_positive_status");
  assert.match(response.headers()["content-type"], /^application\/json/);
  assert.match(response.headers()["content-disposition"], /^attachment;/);
  assert.equal(response.headers()["cache-control"], "no-store");
  const data = await response.json(); assert.equal(data.canal, "portal"); assert.equal(data.titular.cuenta_id, fixture.cuentaId);
  assert.equal(data.organizaciones.length, 2);
  assert.deepEqual(data.organizaciones.map((org: { paciente: { id: string } }) => org.paciente.id).sort(), fixture.links.map(link => link.patientId).sort());
  for (const org of data.organizaciones) {
    const link = fixture.links.find(value => value.patientId === org.paciente.id); assert.ok(link);
    assert.equal(org.organizacion.id, link.organizationId); assert.equal(org.paciente.identidad.nombre, "Paciente sintético");
    assert.equal("historia_clinica" in org, false);
  }
  const text = JSON.stringify(data);
  for (const id of Object.values(fixture.foreign)) assert.equal(text.includes(id), false);
  assert.equal(/"(?:SOAP|soap|tool_data|sesiones|enmiendas)"\s*:/.test(text), false);
}

async function ownedState(db: Client, fixture: PortalProofFixture) {
  const { rows } = await db.query(`SELECT p.id, p.organization_id, p.identidad_id, p.cuenta_id, i.deleted_at
    FROM public.paciente p JOIN public.paciente_identidad i ON i.id=p.identidad_id AND i.organization_id=p.organization_id
    JOIN public.organization o ON o.id=p.organization_id AND o.is_synthetic AND o.is_internal_account
    JOIN public.paciente_cuenta a ON a.id=p.cuenta_id AND a.auth_user_id=$1 AND a.deleted_at IS NULL
    WHERE p.id=ANY($2::uuid[]) AND p.cuenta_id=$3 AND p.pseudonimizado_en IS NULL`,
  [fixture.userId, fixture.links.map(link => link.patientId), fixture.cuentaId]);
  assert.equal(rows.length, 2, "portal_owned_rows_missing");
  for (const link of fixture.links) {
    const row = rows.find(value => value.id === link.patientId); assert.ok(row);
    assert.equal(row.organization_id, link.organizationId); assert.equal(row.identidad_id, link.identityId); assert.equal(row.deleted_at, null);
  }
}

async function barrierCase(page: Page, kind: "revoke" | "identity") {
  const { fixture, actor } = await authenticated(page);
  try { await positive(page, fixture); } // Warm the real route before taking the audit lock.
  catch (error) { diagnose(error, { case: kind, phase: "positive" }); throw error; }
  const target = fixture.links[0];
  const db = new Client({ connectionString: fixture.databaseUrl, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
  await db.connect();
  let request: ReturnType<Page["request"]["get"]> | undefined;
  let primaryFailed = false;
  let phase: PortalProofPhase = "owned";
  try {
    await ownedState(db, fixture);
    try {
      await db.query("BEGIN"); await db.query("SET LOCAL lock_timeout='5s'"); await db.query("SET LOCAL statement_timeout='15s'");
      await db.query("LOCK TABLE public.audit_log IN SHARE MODE");
      const lockerPid = Number((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      let settled = false;
      request = page.request.get(`${APP}/api/portal/export`, { maxRedirects: 0, timeout: 20_000 });
      void request.then(() => { settled = true; }, () => { settled = true; });
      phase = "barrier";
      await expect.poll(async () => {
        assert.equal(settled, false, "portal_request_completed_before_audit_barrier");
        const result = await db.query(AUDIT_BARRIER_SQL, [lockerPid]);
        return auditBarrierObserved(result.rows, lockerPid);
      }, { timeout: 10_000, intervals: [20, 50, 100], message: "real audit INSERT must be blocked by the owned PID" }).toBe(true);
      phase = "mutation";
      if (kind === "revoke") {
        const changed = await db.query(`UPDATE public.paciente SET cuenta_id=NULL
          WHERE id=$1 AND organization_id=$2 AND identidad_id=$3 AND cuenta_id=$4 AND pseudonimizado_en IS NULL RETURNING id`,
        [target.patientId, target.organizationId, target.identityId, fixture.cuentaId]);
        assert.equal(changed.rowCount, 1, "portal_owned_revoke_missing");
      } else {
        const changed = await db.query(`UPDATE public.paciente_identidad SET deleted_at=$3
          WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING id`, [target.identityId, target.organizationId, HIDDEN_AT]);
        assert.equal(changed.rowCount, 1, "portal_owned_identity_missing");
      }
      await db.query("COMMIT"); // The change and barrier release become visible together.
      phase = "response";
      const response = await request;
      assert.equal(response.status(), 409, "portal_revocation_status");
      assert.equal(response.headers()["content-disposition"], undefined); assert.equal(response.headers()["cache-control"], "no-store");
      const text = await response.text(); assert.ok(text.length > 0 && text.length < 1000);
      for (const value of ["Paciente sintético", "organizaciones", "historia_clinica", fixture.userId, fixture.cuentaId,
        ...fixture.links.flatMap(link => Object.values(link))]) assert.equal(text.includes(value), false);
      assert.equal(JSON.parse(text).error.code, "conflict");
      phase = "rls";
      const visiblePatient = await actor.from("paciente").select("id,identidad_id").eq("id", target.patientId);
      assert.equal(visiblePatient.error, null);
      if (kind === "identity") {
        assert.deepEqual(visiblePatient.data, [{ id: target.patientId, identidad_id: target.identityId }]);
        const hidden = await actor.from("paciente_identidad").select("id").eq("id", target.identityId);
        assert.equal(hidden.error, null); assert.deepEqual(hidden.data, []);
      } else assert.deepEqual(visiblePatient.data, []);
      console.log(PORTAL_EXPORT_MARKERS[kind === "revoke" ? 2 : 4]);
    } catch (error) {
      primaryFailed = true; diagnose(error, { case: kind, phase }); throw error;
    } finally {
      try {
      // On timeout/error, release the lock before awaiting any still-pending GET.
      await db.query("ROLLBACK");
      if (request) await request.catch(() => undefined);
      const restoredIdentity = await db.query(`UPDATE public.paciente_identidad SET deleted_at=NULL
        WHERE id=$1 AND organization_id=$2 AND (deleted_at IS NULL OR deleted_at=$3) RETURNING id`,
      [target.identityId, target.organizationId, HIDDEN_AT]);
      assert.equal(restoredIdentity.rowCount, 1, "portal_identity_restore_missing");
      const restoredLink = await db.query(`UPDATE public.paciente SET cuenta_id=$4
        WHERE id=$1 AND organization_id=$2 AND identidad_id=$3 AND (cuenta_id IS NULL OR cuenta_id=$4) RETURNING id`,
      [target.patientId, target.organizationId, target.identityId, fixture.cuentaId]);
      assert.equal(restoredLink.rowCount, 1, "portal_link_restore_missing");
      await ownedState(db, fixture);
      } catch (error) {
        diagnose(error, { case: kind, phase: "restore", secondary: primaryFailed });
        if (!primaryFailed) { primaryFailed = true; throw error; }
      }
    }
  } catch (error) {
    if (!primaryFailed) { primaryFailed = true; diagnose(error, { case: kind, phase }); }
    throw error;
  } finally {
    try { await db.end(); } catch (error) {
      diagnose(error, { case: kind, phase: "cleanup", secondary: primaryFailed });
      if (!primaryFailed) throw error;
    }
  }
  try { await positive(page, fixture); }
  catch (error) { diagnose(error, { case: kind, phase: "positive" }); throw error; }
  console.log(PORTAL_EXPORT_MARKERS[kind === "revoke" ? 3 : 5]);
}

test("portal real Auth and RLS deliver only the linked multi-org JSON", async ({ page }) => {
  test.setTimeout(120_000);
  try {
    const { fixture } = await authenticated(page); await positive(page, fixture);
    console.log(PORTAL_EXPORT_MARKERS[1]);
  } catch (error) { diagnose(error, { case: "positive", phase: "positive" }); throw error; }
});
test("portal link revocation at the real audit barrier rejects the prepared JSON", async ({ page }) => {
  test.setTimeout(120_000);
  try { await barrierCase(page, "revoke"); } catch (error) { diagnose(error, { case: "revoke", phase: "auth" }); throw error; }
});
test("portal identity hidden by RLS at the real audit barrier rejects unchanged IDs", async ({ page }) => {
  test.setTimeout(120_000);
  try { await barrierCase(page, "identity"); } catch (error) { diagnose(error, { case: "identity", phase: "auth" }); throw error; }
});
