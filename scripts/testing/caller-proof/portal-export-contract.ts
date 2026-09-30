import assert from "node:assert/strict";

export const PORTAL_EXPORT_FIXTURE_NAME = "folio-portal-export-proof-fixture.json";
export const PORTAL_EXPORT_SPEC = "tests/e2e/portal-export-authenticated.spec.ts";
export const PORTAL_EXPORT_RECEIPT_NAME = "portal-export-proof-diagnostic.json";
export const PORTAL_EXPORT_FAILURE_PREFIX = "@@FOLIO_PORTAL_EXPORT_FAILURE@@";
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

const phases = ["auth", "positive", "owned", "barrier", "mutation", "response", "rls", "restore", "browser",
  "pull", "services", "migrations", "schema", "fixture", "complete", "cleanup", "receipt", "preflight"] as const;
export type PortalProofPhase = typeof phases[number];
type FailureContext = { case: "positive" | "revoke" | "identity" | "runner"; phase: PortalProofPhase; secondary?: boolean };
type Failure = FailureContext & { secondary: boolean; kind: "timeout" | "assertion" | "error";
  line?: number; expected?: number | boolean; actual?: number | boolean; status?: number; barrierObserved?: false };
export interface PortalProofReceipt { version: 1; passed: boolean; exitCode: number; markers: string[];
  primary: Failure | null; secondary: Failure[] }
const scalar = (value: unknown): value is number | boolean => typeof value === "boolean" ||
  (typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 100_000);
// Extract only finite fields. Never copy messages, assertion strings, SQL or source snippets.
export function portalFailure(error: unknown, context: FailureContext): Failure {
  const item = error as { message?: unknown; stack?: unknown; code?: unknown; actual?: unknown; expected?: unknown };
  const kind = /timeout|timed out/i.test(typeof item?.message === "string" ? item.message : "") ? "timeout" :
    item?.code === "ERR_ASSERTION" ? "assertion" : "error";
  const match = typeof item?.stack === "string" ? item.stack.match(/portal-export-authenticated\.spec\.ts:(\d+)(?::\d+)?/) : null;
  const line = match ? Number(match[1]) : 0;
  const actual = scalar(item?.actual) ? item.actual : undefined;
  const expected = scalar(item?.expected) ? item.expected : undefined;
  return { case: context.case, phase: context.phase, secondary: context.secondary === true, kind,
    ...(line > 0 && line < 10_000 ? { line } : {}), ...(actual !== undefined ? { actual } : {}),
    ...(expected !== undefined ? { expected } : {}),
    ...(["positive", "response"].includes(context.phase) && typeof actual === "number" && actual >= 100 && actual <= 599 ? { status: actual } : {}),
    ...(context.phase === "barrier" ? { barrierObserved: false as const } : {}) };
}
export function addPortalFailure(receipt: PortalProofReceipt, error: unknown, context: FailureContext): PortalProofReceipt {
  const failure = portalFailure(error, { ...context, secondary: receipt.primary !== null || context.secondary });
  return { ...receipt, passed: false,
    primary: receipt.primary ?? (failure.secondary ? null : failure),
    secondary: failure.secondary ? [...receipt.secondary, failure].slice(0, 12) : receipt.secondary };
}
export function portalProofReceipt(output: string, exitCode: number): PortalProofReceipt {
  const result = portalExportResult(output);
  let receipt: PortalProofReceipt = { version: 1, passed: exitCode === 0 && result.passed,
    exitCode: Number.isSafeInteger(exitCode) ? exitCode : 1, markers: result.markers, primary: null, secondary: [] };
  for (const line of output.split(/\r?\n/).map(value => value.trim())) {
    if (!line.startsWith(PORTAL_EXPORT_FAILURE_PREFIX)) continue;
    try {
      const item = JSON.parse(line.slice(PORTAL_EXPORT_FAILURE_PREFIX.length)) as Failure;
      if (!["positive", "revoke", "identity", "runner"].includes(item.case) || !phases.includes(item.phase) ||
          !["timeout", "assertion", "error"].includes(item.kind) || typeof item.secondary !== "boolean" ||
          Object.keys(item).some(key => !["case", "phase", "secondary", "kind", "line", "actual", "expected", "status", "barrierObserved"].includes(key)) ||
          (item.actual !== undefined && !scalar(item.actual)) || (item.expected !== undefined && !scalar(item.expected)) ||
          (item.line !== undefined && (!Number.isSafeInteger(item.line) || item.line <= 0 || item.line >= 10_000)) ||
          (item.status !== undefined && (!Number.isSafeInteger(item.status) || item.status < 100 || item.status > 599)) ||
          (item.barrierObserved !== undefined && item.barrierObserved !== false)) continue;
      const safe = { ...item, secondary: receipt.primary !== null || item.secondary };
      receipt = { ...receipt, passed: false, primary: receipt.primary ?? (safe.secondary ? null : safe),
        secondary: safe.secondary ? [...receipt.secondary, safe].slice(0, 12) : receipt.secondary };
    } catch { /* Invalid output or reporter code frames are not diagnostics. */ }
  }
  if (!receipt.passed && !receipt.primary) receipt = addPortalFailure(receipt, Error("browser_failed"), { case: "runner", phase: "browser" });
  return receipt;
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
