import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { createServerClient } from "@supabase/ssr";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/local-test";
import { privateRobotsDirectives, S1_FIXTURE_NAME, S1_MARKERS } from "../../scripts/testing/caller-proof/s1-contract";

type Fixture = {
  mode: "s1";
  browserCookies: { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None" }[];
  userId: string;
  memberId: string;
  organizationId: string;
  portalAccountId: string;
  databaseUrl: string;
};

async function expectPrivateHtml(page: Page, route: string) {
  const response = await page.goto(route);
  assert.equal(response?.status(), 200, "s1_html_status");
  assert.equal(new URL(page.url()).pathname, route, "s1_html_final_route");
  assert.equal(new URL(response!.url()).pathname, route, "s1_html_response_route");
  assert.match(response!.headers()["content-type"] ?? "", /^text\/html\b/i, "s1_html_content_type");
  const directives = privateRobotsDirectives(await response!.text());
  expect(directives).toEqual(expect.arrayContaining(["noindex", "nofollow"]));
}

test("authenticated server HTML keeps private robots metadata on staff and patient routes", async ({ page }) => {
  test.setTimeout(180_000);
  assert.equal(process.env.CI, "true", "s1_requires_ci");
  assert.equal(process.env.FOLIO_TEST_REAL_SUPABASE, "1", "s1_requires_real_auth");
  assert.equal(process.env.E2E_BASE_URL, "http://localhost:4430", "s1_app_isolation");
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:55421", "s1_auth_isolation");
  const fixture = JSON.parse(await readFile(path.join(tmpdir(), S1_FIXTURE_NAME), "utf8")) as Fixture;
  assert.equal(fixture.mode, "s1", "s1_fixture_mode");
  for (const id of [fixture.userId, fixture.memberId, fixture.organizationId, fixture.portalAccountId])
    assert.match(id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/, "s1_fixture_identity");
  const target = new URL(fixture.databaseUrl);
  assert.equal(target.protocol, "postgresql:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55422");
  assert.equal(target.pathname, "/postgres");
  assert.equal(target.username, "postgres");
  assert.equal(target.search + target.hash, "");
  assert.ok(fixture.browserCookies.length > 0, "s1_cookie_missing");
  await page.context().addCookies(fixture.browserCookies);
  const actor = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => fixture.browserCookies, setAll: () => {} },
  });
  const identity = await actor.auth.getUser();
  assert.equal(identity.error, null, "s1_real_identity_failed");
  assert.equal(identity.data.user?.id, fixture.userId, "s1_identity_mismatch");
  const session = await actor.auth.getSession();
  assert.equal(session.error, null, "s1_session_failed");
  assert.ok(session.data.session, "s1_session_missing");
  const claims = JSON.parse(Buffer.from(session.data.session.access_token.split(".")[1], "base64url").toString());
  assert.equal(claims.sub, fixture.userId, "s1_session_identity");
  assert.equal(claims.aal, "aal2", "s1_session_aal");
  assert.match(claims.session_id, /^[0-9a-f-]{36}$/, "s1_session_id");
  const gate = await actor.rpc("mfa_access_status");
  assert.equal(gate.error, null, "s1_mfa_gate_failed");
  assert.deepEqual(gate.data, { required: true, allowed: true, isStaff: true, hasVerifiedFactor: true, sessionValid: true });
  const db = new Client({ connectionString: fixture.databaseUrl, connectionTimeoutMillis: 10_000, query_timeout: 10_000, statement_timeout: 10_000 });
  await db.connect();
  const owned = [fixture.memberId, fixture.userId, fixture.organizationId];
  try {
    const active = await db.query("SELECT id FROM public.member WHERE id=$1 AND profile_id=$2 AND organization_id=$3 AND role='OWNER' AND deleted_at IS NULL", owned);
    assert.equal(active.rowCount, 1, "s1_owned_member_missing");
    const liveSession = await db.query("SELECT id FROM auth.sessions WHERE id=$1 AND user_id=$2", [claims.session_id, fixture.userId]);
    assert.equal(liveSession.rowCount, 1, "s1_live_auth_session_missing");
    await expectPrivateHtml(page, "/hoy");
    console.log(S1_MARKERS[0]);
    // finally covers the write itself as well: do not assume a failed response means no write.
    try {
      const retired = await db.query("UPDATE public.member SET deleted_at=now() WHERE id=$1 AND profile_id=$2 AND organization_id=$3 AND role='OWNER' AND deleted_at IS NULL RETURNING id", owned);
      assert.equal(retired.rowCount, 1, "s1_member_retire_failed");
      const remaining = await db.query("SELECT id FROM public.member WHERE profile_id=$1 AND deleted_at IS NULL", [fixture.userId]);
      assert.equal(remaining.rowCount, 0, "s1_staff_audience_remaining");
      const portal = await actor.rpc("paciente_cuenta_actual");
      assert.equal(portal.error, null, "s1_portal_identity_failed");
      assert.equal(portal.data, fixture.portalAccountId, "s1_portal_identity_mismatch");
      await expectPrivateHtml(page, "/portal");
      console.log(S1_MARKERS[1]);
    } finally {
      await db.query("UPDATE public.member SET deleted_at=NULL WHERE id=$1 AND profile_id=$2 AND organization_id=$3 AND role='OWNER' AND deleted_at IS NOT NULL", owned);
      const restored = await db.query("SELECT id FROM public.member WHERE id=$1 AND profile_id=$2 AND organization_id=$3 AND role='OWNER' AND deleted_at IS NULL", owned);
      assert.equal(restored.rowCount, 1, "s1_member_restore_failed");
      console.log(S1_MARKERS[2]);
    }
  } finally { await db.end(); }
});
