import assert from "node:assert/strict";

export const PORTAL_EXPORT_FIXTURE_NAME = "folio-portal-export-proof-fixture.json";
export const PORTAL_EXPORT_SPEC = "tests/e2e/portal-export-authenticated.spec.ts";
export const PORTAL_EXPORT_MARKERS = Object.freeze([
  "portal_export_auth_rls_pass", "portal_export_positive_200", "portal_export_revoke_barrier_409",
  "portal_export_revoke_restored_200", "portal_export_identity_rls_barrier_409", "portal_export_identity_restored_200",
]);
export function proofMode(args: string[]): "caller" | "portal-export" {
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--portal-export"), "proof_mode_invalid");
  return args.length ? "portal-export" : "caller";
}
export function proofSpecs(mode: "caller" | "portal-export"): readonly string[] {
  return mode === "portal-export" ? [PORTAL_EXPORT_SPEC] : ["tests/e2e/caller-screen.spec.ts"];
}
export function portalExportResult(output: string) {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map(line => line.trim());
  const markers = [...new Set(lines.filter(line => PORTAL_EXPORT_MARKERS.includes(line)))];
  return { markers, passed: PORTAL_EXPORT_MARKERS.every(marker => markers.includes(marker)) &&
    lines.some(line => /^3 passed(?:\s|$)/.test(line)) &&
    !lines.some(line => /^\d+ (?:failed|skipped|interrupted|timed out)(?:\s|$)/.test(line)) };
}

export interface PortalProofFixture {
  mode: "portal-export";
  userId: string;
  cuentaId: string;
  databaseUrl: string;
  links: { patientId: string; identityId: string; organizationId: string }[];
  foreign: { patientId: string; identityId: string; organizationId: string };
  browserCookies: { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None" }[];
}
export function assertPortalFixture(value: PortalProofFixture): void {
  assert.equal(value?.mode, "portal-export", "portal_fixture_mode");
  assert.equal(value.links?.length, 2, "portal_fixture_scope");
  const ids = [value.userId, value.cuentaId, ...[...value.links, value.foreign].flatMap(link =>
    [link.patientId, link.identityId, link.organizationId])];
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/, "portal_fixture_id");
  assert.equal(new Set(ids).size, ids.length, "portal_fixture_distinct_ids");
  const target = new URL(value.databaseUrl);
  assert.equal(target.protocol, "postgresql:"); assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55422"); assert.equal(target.pathname, "/postgres");
  assert.equal(target.username, "postgres"); assert.equal(target.search + target.hash, "");
  assert.ok(target.password, "portal_fixture_password_missing");
  assert.ok(value.browserCookies?.length > 0, "portal_fixture_cookies");
  for (const cookie of value.browserCookies) {
    assert.equal(cookie.domain, "localhost"); assert.equal(cookie.path, "/");
    assert.ok(cookie.name.startsWith("sb-") && cookie.value.length > 0, "portal_fixture_cookie_scope");
  }
}

// One request only; identify the real PostgREST INSERT blocked by our own PID.
// Do not log query text, cookies or SQL parameters.
export const AUDIT_BARRIER_SQL = `SELECT l.pid, pg_blocking_pids(l.pid) AS blockers
FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
WHERE l.locktype='relation' AND l.relation='public.audit_log'::regclass
AND l.mode='RowExclusiveLock' AND NOT l.granted AND l.pid<>$1
AND $1=ANY(pg_blocking_pids(l.pid)) AND a.datname=current_database()
AND a.usename='authenticator' LIMIT 2`;
export function auditBarrierObserved(rows: { pid: number; blockers: number[] }[], lockerPid: number): boolean {
  return Number.isSafeInteger(lockerPid) && lockerPid > 0 && rows.length === 1 &&
    Number.isSafeInteger(rows[0].pid) && rows[0].pid > 0 && rows[0].pid !== lockerPid &&
    Array.isArray(rows[0].blockers) && rows[0].blockers.includes(lockerPid);
}
