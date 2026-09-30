import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { link, rename, unlink, writeFile } from "node:fs/promises";

export const SPEC = "tests/e2e/patient-intake-incorporation-live.spec.ts";
export const FIXTURE = "folio-patient-incorporation-proof-fixture.json";
export const RECEIPT = "patient-intake-incorporation-receipt.json";
export const FAILURE_PREFIX = "@@FOLIO_INCORPORATION_FAILURE@@";
export const MARKERS = ["intake_incorporation_selected_applied", "intake_incorporation_selection_preserved",
  "intake_incorporation_lost_response_committed", "intake_incorporation_lost_response_reconciled",
  "intake_incorporation_editor_conflict", "intake_incorporation_editor_draft_preserved"] as const;
export function proofMode(args: string[]): "legacy" | "incorporation" {
  assert.ok(args.length === 0 || args.length === 1 && args[0] === "--incorporation", "proof_mode_invalid");
  return args.length ? "incorporation" : "legacy";
}
export function proofSpec(mode: "legacy" | "incorporation") {
  return mode === "incorporation" ? SPEC : "tests/e2e/patient-intake-live.spec.ts";
}
export function isApplyPayload(value: unknown, turnoId: string): value is [{ turnoId: string; operationId: string; selectedKeys: string[] }] {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") return false;
  const item = value[0] as Record<string, unknown>;
  return item.turnoId === turnoId && typeof item.operationId === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(item.operationId)
    && Array.isArray(item.selectedKeys) && item.selectedKeys.length === 1 && item.selectedKeys[0] === "nombre";
}
export function assertHosted(env: NodeJS.ProcessEnv, sha: string, mode: "legacy" | "incorporation", platform = process.platform) {
  assert.equal(platform, "linux"); assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted"); assert.equal(env.RUNNER_OS, "Linux");
  if (mode === "legacy") assert.equal(env.GITHUB_EVENT_NAME, "pull_request");
  else {
    assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
    assert.ok(env.GITHUB_REF?.startsWith("refs/tags/m148-ui-cas-"));
    assert.match(sha, /^[a-f0-9]{40}$/); assert.equal(env.GITHUB_SHA, sha);
    assert.equal(env.FOLIO_INTAKE_EXPECTED_SHA, sha);
  }
}

const cipherColumns = ["nombre_cifrado", "apellido_cifrado", "telefono_cifrado", "email_cifrado", "ocupacion_cifrado"] as const;
const hashColumns = ["nombre_hash", "telefono_hash", "email_hash"] as const;
export const RESTORE_COLUMNS = [...cipherColumns, ...hashColumns];
export type RestoreSnapshot = Record<typeof RESTORE_COLUMNS[number], string | null>;
export interface OwnedCase { kind: "selection" | "lost" | "conflict"; patientId: string; identityId: string;
  turnoId: string; label: string; baseline: RestoreSnapshot }
export interface IntegrationFixture { mode: "incorporation"; organizationId: string; memberId: string; userId: string;
  cases: OwnedCase[]; databaseUrl: string;
  browserCookies: { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None" }[] }
export function assertFixture(f: IntegrationFixture) {
  assert.equal(f.mode, "incorporation"); assert.deepEqual(f.cases.map(item => item.kind), ["selection", "lost", "conflict"]);
  const ids = [f.organizationId, f.memberId, f.userId, ...f.cases.flatMap(item => [item.patientId, item.identityId, item.turnoId])];
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of f.cases) {
    assert.match(item.label, /^Paciente sintético integración [123]$/);
    assert.deepEqual(Object.keys(item.baseline).toSorted(), RESTORE_COLUMNS.toSorted());
    for (const column of RESTORE_COLUMNS) assert.ok(item.baseline[column] === null || /^[a-f0-9]+$/.test(item.baseline[column]!));
  }
  const target = new URL(f.databaseUrl);
  assert.equal(target.protocol, "postgresql:"); assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55422"); assert.equal(target.pathname, "/postgres");
  assert.equal(target.username, "postgres"); assert.ok(target.password); assert.equal(target.search + target.hash, "");
  assert.ok(f.browserCookies.length);
  for (const cookie of f.browserCookies) {
    assert.equal(cookie.domain, "localhost"); assert.equal(cookie.path, "/");
    assert.ok(cookie.name.startsWith("sb-") && cookie.value.length);
  }
}
type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
export async function ownedIdentity(db: Db, f: Pick<IntegrationFixture, "organizationId" | "memberId" | "userId">, item: Pick<OwnedCase, "patientId" | "identityId" | "turnoId">) {
  const result = await db.query(`SELECT ${cipherColumns.map(column => `encode(i.${column},'hex') AS ${column}`).join(",")},
    ${hashColumns.map(column => `i.${column}`).join(",")},i.admin_revision::text AS admin_revision,p.identity_link_revision::text AS link_revision
    FROM public.paciente p JOIN public.paciente_identidad i ON i.id=p.identidad_id AND i.organization_id=p.organization_id AND i.deleted_at IS NULL
    JOIN public.organization o ON o.id=p.organization_id AND o.is_synthetic AND o.is_internal_account
    JOIN public.member m ON m.organization_id=o.id AND m.id=$5 AND m.profile_id=$6 AND m.deleted_at IS NULL
    JOIN public.turno t ON t.paciente_id=p.id AND t.organization_id=o.id AND t.id=$4 AND t.deleted_at IS NULL
    WHERE p.id=$1 AND p.organization_id=$2 AND p.identidad_id=$3 AND p.deleted_at IS NULL AND p.pseudonimizado_en IS NULL`,
  [item.patientId, f.organizationId, item.identityId, item.turnoId, f.memberId, f.userId]);
  assert.equal(result.rowCount, 1, "owned_identity_missing"); return result.rows[0];
}
export async function restoreOwned(db: Db, f: Pick<IntegrationFixture, "organizationId" | "memberId" | "userId">, item: OwnedCase) {
  await ownedIdentity(db, f, item);
  const assignments = RESTORE_COLUMNS.map((column, index) => `${column}=${cipherColumns.includes(column as typeof cipherColumns[number])
    ? `decode($${index + 3}::text,'hex')` : `$${index + 3}::text`}`).join(",");
  const changed = await db.query(`UPDATE public.paciente_identidad SET ${assignments} WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING id`,
    [item.identityId, f.organizationId, ...RESTORE_COLUMNS.map(column => item.baseline[column])]);
  assert.equal(changed.rowCount, 1, "owned_restore_missing");
  const actual = await ownedIdentity(db, f, item);
  for (const column of RESTORE_COLUMNS) assert.equal(actual[column], item.baseline[column], "owned_restore_readback");
  // Preserve database-managed revisions and durable operation/provenance rows.
}

const phases = ["guard", "services", "migrations", "auth", "fixture", "roles", "browser", "setup", "compare", "confirm", "readback", "lost_response", "editor", "restore", "cleanup", "receipt"] as const;
type Phase = typeof phases[number];
type Context = { case: "selection" | "lost" | "conflict" | "runner"; phase: Phase; secondary?: boolean };
type Failure = Context & { secondary: boolean; kind: "assertion" | "timeout" | "other"; line?: number; actual?: number | boolean; expected?: number | boolean };
export interface Receipt { version: 1; passed: boolean; exitCode: number; markers: string[]; primary: Failure | null; secondary: Failure[] }
const scalar = (value: unknown): value is number | boolean => typeof value === "boolean" ||
  typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 100_000;
export function finiteFailure(error: unknown, context: Context): Failure {
  const item = error as { message?: unknown; code?: unknown; stack?: unknown; actual?: unknown; expected?: unknown };
  const line = typeof item?.stack === "string" ? Number(item.stack.match(/patient-intake-incorporation-live\.spec\.ts:(\d+)/)?.[1]) : 0;
  return { ...context, secondary: context.secondary === true,
    kind: /timeout|timed out/i.test(typeof item?.message === "string" ? item.message : "") ? "timeout" : item?.code === "ERR_ASSERTION" ? "assertion" : "other",
    ...(line > 0 && line < 10000 ? { line } : {}), ...(scalar(item?.actual) ? { actual: item.actual } : {}),
    ...(scalar(item?.expected) ? { expected: item.expected } : {}) };
}
export function addFailure(receipt: Receipt, error: unknown, context: Context): Receipt {
  const failure = finiteFailure(error, { ...context, secondary: Boolean(receipt.primary) || context.secondary });
  return { ...receipt, passed: false, exitCode: 1, primary: receipt.primary ?? (failure.secondary ? null : failure),
    secondary: failure.secondary ? [...receipt.secondary, failure].slice(0, 12) : receipt.secondary };
}
export function browserReceipt(output: string, exitCode: number): Receipt {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map(value => value.trim());
  const markers = [...new Set(lines.filter(value => (MARKERS as readonly string[]).includes(value)))];
  let receipt: Receipt = { version: 1, passed: exitCode === 0 && markers.length === MARKERS.length &&
    lines.some(value => /^3 passed(?:\s|$)/.test(value)) && !lines.some(value => /^\d+ (?:failed|skipped|interrupted|timed out)(?:\s|$)/.test(value)),
    exitCode: Number.isSafeInteger(exitCode) ? exitCode : 1, markers, primary: null, secondary: [] };
  for (const line of lines.filter(value => value.startsWith(FAILURE_PREFIX))) {
    try {
      const item = JSON.parse(line.slice(FAILURE_PREFIX.length)) as Failure;
      if (!["selection", "lost", "conflict", "runner"].includes(item.case) || !phases.includes(item.phase) ||
          !["assertion", "timeout", "other"].includes(item.kind) || typeof item.secondary !== "boolean" ||
          Object.keys(item).some(key => !["case", "phase", "secondary", "kind", "line", "actual", "expected"].includes(key)) ||
          (item.line !== undefined && (!Number.isSafeInteger(item.line) || item.line <= 0 || item.line >= 10000)) ||
          (item.actual !== undefined && !scalar(item.actual)) || (item.expected !== undefined && !scalar(item.expected))) continue;
      const safe = { ...item, secondary: Boolean(receipt.primary) || item.secondary };
      receipt = { ...receipt, passed: false, exitCode: 1, primary: receipt.primary ?? (safe.secondary ? null : safe),
        secondary: safe.secondary ? [...receipt.secondary, safe].slice(0, 12) : receipt.secondary };
    } catch { /* Source snippets and unsafe output are not receipts. */ }
  }
  if (!receipt.passed && !receipt.primary) receipt = addFailure(receipt, Error("browser_failed"), { case: "runner", phase: "browser" });
  return receipt;
}
export async function publishReceipt(file: string, receipt: Receipt, owned: boolean,
  io: Pick<typeof import("node:fs/promises"), "writeFile" | "rename" | "link" | "unlink"> = { writeFile, rename, link, unlink }) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await io.writeFile(temporary, JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
    if (owned) await io.rename(temporary, file); else await io.link(temporary, file);
  } finally { await io.unlink(temporary).catch(() => undefined); }
}
