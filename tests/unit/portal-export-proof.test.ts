import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AUDIT_BARRIER_SQL, auditBarrierObserved, assertPortalFixture, PORTAL_EXPORT_MARKERS, PORTAL_EXPORT_SPEC,
  portalExportResult, portalFailure, portalProofReceipt, addPortalFailure, PORTAL_EXPORT_FAILURE_PREFIX,
  proofMode, proofSpecs, type PortalProofFixture } from "../../scripts/testing/caller-proof/portal-export-contract";
import { validateBridgeTarget } from "../../scripts/recovery/ci-loopback-bridge.mjs";

test("mode strictly selects only portal spec or existing caller spec", () => {
  assert.equal(proofMode([]), "caller"); assert.equal(proofMode(["--portal-export"]), "portal-export");
  assert.deepEqual(proofSpecs("portal-export"), [PORTAL_EXPORT_SPEC]);
  assert.deepEqual(proofSpecs("caller"), ["tests/e2e/caller-screen.spec.ts"]);
  for (const args of [["--s1"], ["--portal-export", "--s1"], ["--portal-export", "--portal-export"], ["--unknown"]]) {
    assert.throws(() => proofMode(args));
  }
});
test("PASS requires all emitted markers, exact three passes and no omissions", () => {
  const good = [...PORTAL_EXPORT_MARKERS, "3 passed (2s)"].join("\n");
  assert.equal(portalExportResult(good).passed, true);
  for (const bad of [good.replace(PORTAL_EXPORT_MARKERS[2], ""), good.replace("3 passed", "2 passed"),
    good + "\n1 skipped", good + "\n1 failed", good + "\n1 interrupted",
    PORTAL_EXPORT_MARKERS.map(marker => `> 3 | console.log('${marker}');`).join("\n") + "\n3 passed"]) {
    assert.equal(portalExportResult(bad).passed, false);
  }
});
test("audit barrier requires exactly one foreign waiter blocked by the owned PID", () => {
  assert.equal(auditBarrierObserved([{ pid: 22, blockers: [11] }], 11), true);
  for (const rows of [[], [{ pid: 11, blockers: [11] }], [{ pid: 22, blockers: [33] }],
    [{ pid: 22, blockers: [11] }, { pid: 23, blockers: [11] }]]) assert.equal(auditBarrierObserved(rows, 11), false);
  assert.match(AUDIT_BARRIER_SQL, /public\.audit_log/); assert.match(AUDIT_BARRIER_SQL, /NOT l\.granted/);
  assert.match(AUDIT_BARRIER_SQL, /pg_blocking_pids/); assert.match(AUDIT_BARRIER_SQL, /a\.usename='authenticator'/);
});
function fixture(): PortalProofFixture {
  let n = 1; const id = () => `${String(n++).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  return { mode: "portal-export", userId: id(), cuentaId: id(), databaseUrl: "postgresql://postgres:synthetic@127.0.0.1:55422/postgres",
    links: [1, 2].map(() => ({ patientId: id(), identityId: id(), organizationId: id() })),
    foreign: { patientId: id(), identityId: id(), organizationId: id() },
    browserCookies: [{ name: "sb-local-auth-token", value: "synthetic", domain: "localhost", path: "/" }] };
}
test("fixture rejects host, port, scope and credential-bearing target drift before connection", () => {
  assert.doesNotThrow(() => assertPortalFixture(fixture()));
  for (const mutate of [
    (f: PortalProofFixture) => { f.databaseUrl = f.databaseUrl.replace("127.0.0.1", "example.invalid"); },
    (f: PortalProofFixture) => { f.databaseUrl = f.databaseUrl.replace("55422", "54322"); },
    (f: PortalProofFixture) => { f.databaseUrl += "?sslmode=require"; },
    (f: PortalProofFixture) => { f.links.pop(); },
    (f: PortalProofFixture) => { f.foreign = f.links[0]; },
    (f: PortalProofFixture) => { f.browserCookies[0].domain = "example.invalid"; },
  ]) { const f = fixture(); mutate(f); assert.throws(() => assertPortalFixture(f)); }
});
test("existing bridge allowlist really accepts the reused project and rejects new variants", () => {
  const project = "folio_caller_proof", container = "a".repeat(64), network = "b".repeat(64), name = `${project}_default`;
  const metadata = { project, service: "db", containerId: container, remotePort: 5432,
    labels: { "com.docker.compose.project": project, "com.docker.compose.service": "db" },
    networks: { [name]: { NetworkID: network, IPAddress: "172.30.0.3" } },
    network: { Name: name, Id: network, Internal: true, Driver: "bridge", Options: {},
      Labels: { "com.docker.compose.project": project }, IPAM: { Config: [{ Subnet: "172.30.0.0/16" }] },
      Containers: { [container]: { IPv4Address: "172.30.0.3/16" } } } };
  assert.deepEqual(validateBridgeTarget(metadata), { address: "172.30.0.3", port: 5432 });
  assert.throws(() => validateBridgeTarget({ ...metadata, project: "folio_portal_export_proof" }));
});
test("runner and spec retain exclusive selection, hosted guards and deterministic barrier cleanup", () => {
  const runner = readFileSync("scripts/testing/caller-proof/run.mjs", "utf8");
  assert.match(runner, /proofMode\(process\.argv\.slice\(2\)\)/);
  assert.match(runner, /proofSpecs\(mode\)/);
  assert.match(runner, /RUNNER_ENVIRONMENT,'github-hosted'/);
  assert.match(runner, /state\.fixtureOwned/);
  assert.ok(runner.indexOf("await preservePortalReceipt(state); // Durable") < runner.indexOf("portal_export_missing_pass"));
  const spec = readFileSync(PORTAL_EXPORT_SPEC, "utf8");
  assert.equal((spec.match(/^test\(/gm) ?? []).length, 3);
  assert.match(spec, /LOCK TABLE public\.audit_log IN SHARE MODE/);
  assert.match(spec, /AUDIT_BARRIER_SQL/); assert.match(spec, /ROLLBACK/);
  assert.equal(/waitForTimeout|(?<!\.)\bsetTimeout\(/.test(spec), false);
});

test("finite diagnostics exclude messages, credentials, data assertions and reporter code frames", () => {
  const canary = "private-canary-jwt-cookie-DSN-SQL";
  const failure = portalFailure({ message: canary, code: "ERR_ASSERTION", actual: canary, expected: { token: canary },
    stack: `${canary}\n at portal-export-authenticated.spec.ts:106:7` }, { case: "identity", phase: "response" });
  assert.equal(failure.line, 106); assert.equal(failure.kind, "assertion");
  assert.equal(JSON.stringify(failure).includes(canary), false);
  const marker = PORTAL_EXPORT_FAILURE_PREFIX + JSON.stringify(failure);
  const receipt = portalProofReceipt(`> 9 | console.log('${marker}');\n${marker}\n1 failed`, 1);
  assert.deepEqual(receipt.primary, failure); assert.equal(receipt.secondary.length, 0);
  const poisoned = portalProofReceipt(PORTAL_EXPORT_FAILURE_PREFIX + JSON.stringify({ ...failure, message: canary }), 1);
  assert.equal(poisoned.primary?.case, "runner"); assert.equal(JSON.stringify(poisoned).includes(canary), false);
  const timeout = portalFailure(Error("Timed out waiting for audit barrier"), { case: "revoke", phase: "barrier" });
  assert.equal(timeout.kind, "timeout"); assert.equal(timeout.barrierObserved, false);
});

test("durable primary HTTP failure survives secondary cleanup failure without raw output", () => {
  const failed = portalFailure(new assert.AssertionError({ actual: 200, expected: 409, message: "portal_revocation_status" }),
    { case: "revoke", phase: "response" });
  let receipt = portalProofReceipt(PORTAL_EXPORT_FAILURE_PREFIX + JSON.stringify(failed) + "\n1 failed", 1);
  const folder = mkdtempSync(path.join(tmpdir(), "folio-portal-receipt-unit-"));
  const file = path.join(folder, "receipt.json");
  try {
    writeFileSync(file, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    assert.equal(JSON.parse(readFileSync(file, "utf8")).primary.status, 200); // Exists before destructive cleanup.
    receipt = addPortalFailure(receipt, Error("cleanup-sensitive-canary"), { case: "runner", phase: "cleanup" });
    writeFileSync(file, JSON.stringify(receipt));
    const durable = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(durable.primary, failed); assert.equal(durable.primary.expected, 409);
    assert.equal(durable.secondary[0].phase, "cleanup"); assert.equal(durable.secondary[0].secondary, true);
    assert.equal(durable.passed, false); assert.equal(durable.exitCode, 1);
    assert.equal(readFileSync(file, "utf8").includes("cleanup-sensitive-canary"), false);
    for (let n = 0; n < 20; n++) receipt = addPortalFailure(receipt, Error("more"), { case: "runner", phase: "cleanup" });
    assert.equal(receipt.secondary.length, 12); assert.deepEqual(receipt.primary, failed);
  } finally { unlinkSync(file); rmdirSync(folder); }
});
