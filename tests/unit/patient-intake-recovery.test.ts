import test from "node:test";
import assert from "node:assert/strict";
import { postIntakeJson } from "../../lib/patient-intake/browser-http";
import { beginLinkOperation, fenceConflictedOperation, mayApplyLinkStatus, newLinkOperation, pendingLinkOperation, rememberedFence, rememberedLink, resolveLinkOperation, scopedResult, StaffAuthorityGate, withActionDeadline, __resetLinkMemoryForTest } from "../../lib/patient-intake/staff-recovery";
import { mergeAttemptForOperation, newSubmissionAttempt, reconcileAttempt } from "../../lib/patient-intake/submission-attempt";
import { createHash } from "node:crypto";
import { intakeAssuranceDecision, runAssuredIntakeRpc } from "../../lib/patient-intake/staff-assurance";

test("browser deadline includes a fetch that never returns", async () => {
  let signal: AbortSignal | undefined;
  const neverFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  await assert.rejects(postIntakeJson("submit", { answers: { nombre: "Ana" } }, { fetchImpl: neverFetch, timeoutMs: 20 }), /request_timeout/);
  assert.equal(signal?.aborted, true);
});

test("browser deadline includes a response body that never finishes", async () => {
  let signal: AbortSignal | undefined;
  const hangingJson = ((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response);
  }) as typeof fetch;
  await assert.rejects(postIntakeJson("status", {}, { fetchImpl: hangingJson, timeoutMs: 20 }), /request_timeout/);
  assert.equal(signal?.aborted, true);
});

test("AAL1 receives the verification path while AAL2 still requires current factor and session", () => {
  assert.equal(intakeAssuranceDecision(null), "unknown");
  assert.equal(intakeAssuranceDecision("aal1"), "needs_mfa");
  assert.equal(intakeAssuranceDecision("aal2", { hasVerifiedFactor: false, sessionValid: true }), "needs_mfa");
  assert.equal(intakeAssuranceDecision("aal2", { hasVerifiedFactor: true, sessionValid: false }), "needs_mfa");
  assert.equal(intakeAssuranceDecision("aal2", { hasVerifiedFactor: true, sessionValid: true }), "verified");
});

test("valid AAL2 reaches the intake RPC after factor/session check; AAL1 never calls it", async () => {
  const calls: string[] = [];
  const valid = await runAssuredIntakeRpc(
    async () => { calls.push("assurance"); return { data: { currentLevel: "aal2" }, error: null }; },
    async () => { calls.push("factors"); return { ok: true as const, data: { required: false, allowed: true, isStaff: true, hasVerifiedFactor: true, sessionValid: true } }; },
    async () => { calls.push("patient_intake_link_state"); return { data: { active: false }, error: null }; },
  );
  assert.deepEqual(calls, ["assurance", "factors", "patient_intake_link_state"]);
  assert.deepEqual(valid, { kind: "verified", result: { data: { active: false }, error: null } });

  const denied = await runAssuredIntakeRpc(
    async () => ({ data: { currentLevel: "aal1" }, error: null }),
    async () => { throw new Error("factors_must_not_run"); },
    async () => { throw new Error("rpc_must_not_run"); },
  );
  assert.deepEqual(denied, { kind: "needs_mfa" });
});

test("uncertain staff operation survives modal close and its frozen token hashes bytes", async () => {
  __resetLinkMemoryForTest();
  const turno = "11111111-1111-4111-8111-111111111111";
  const scope = "staff-session-one";
  const state = { generation: "2", contextHash: "a".repeat(64), active: false };
  const operation = await newLinkOperation(scope, turno, state, "issue");
  assert.equal(operation.token?.length, 64);
  assert.equal(operation.tokenHash, createHash("sha256").update(Buffer.from(operation.token!, "hex")).digest("hex"));
  beginLinkOperation(operation);
  let resolveAction: ((value: string) => void) | undefined;
  const action = withActionDeadline(() => new Promise<string>(resolve => { resolveAction = resolve; }), 20);
  await assert.rejects(action, /action_timeout/);
  assert.deepEqual(pendingLinkOperation(scope, turno), operation);
  assert.equal(pendingLinkOperation("another-staff-session", turno), null);
  resolveAction?.("committed_after_modal_closed");
  assert.deepEqual(pendingLinkOperation(scope, turno), operation);
  assert.throws(() => beginLinkOperation(operation), /staff_mutation_pending/);
  resolveLinkOperation(operation, "issued", { generation: "3", invitationId: turno, expiresAt: "2026-09-27T00:00:00Z" });
  assert.equal(pendingLinkOperation(scope, turno), null);
  assert.equal(rememberedLink(scope, turno, { ...state, generation: "3", active: true, invitationId: turno })?.token, operation.token);
  assert.equal(rememberedLink("another-staff-session", turno, { ...state, generation: "3", active: true, invitationId: turno }), null);
  __resetLinkMemoryForTest();
});

test("transport rejection and not_recorded retain one operation; changed CAS fences it", async () => {
  __resetLinkMemoryForTest();
  const turno = "33333333-3333-4333-8333-333333333333";
  const scope = "staff-session-one";
  const state = { generation: "0", contextHash: "b".repeat(64), active: false };
  const operation = await newLinkOperation(scope, turno, state, "issue");
  beginLinkOperation(operation);
  await assert.rejects(withActionDeadline(async () => { throw new Error("response_lost_after_commit"); }, 50), /response_lost_after_commit/);
  assert.deepEqual(pendingLinkOperation(scope, turno), operation);
  assert.equal(fenceConflictedOperation(operation, state), false);
  assert.equal(fenceConflictedOperation(operation, { ...state, generation: "1" }), true);
  assert.equal(pendingLinkOperation(scope, turno), null);
  __resetLinkMemoryForTest();
});

test("fresh page needs a confirmed revoke fence before issue, scoped to staff and generation", async () => {
  __resetLinkMemoryForTest();
  const turno = "55555555-5555-4555-8555-555555555555";
  const state = { generation: "0", contextHash: "c".repeat(64), active: false };
  assert.equal(rememberedFence("staff-a", turno, state), false);
  const revoke = await newLinkOperation("staff-a", turno, state, "revoke");
  beginLinkOperation(revoke);
  resolveLinkOperation(revoke, "revoked", { generation: "1" });
  assert.equal(rememberedFence("staff-a", turno, { ...state, generation: "1" }), true);
  assert.equal(rememberedFence("staff-b", turno, { ...state, generation: "1" }), false);
  assert.equal(rememberedFence("staff-a", turno, { ...state, generation: "2" }), false);
  __resetLinkMemoryForTest();
});

test("a retained staff review from A cannot restore proposals after B or denied access", async () => {
  const gate = new StaffAuthorityGate();
  gate.setScope("staff-A");
  let proposals = ["A: dato previo"];
  let releaseA!: (value: string[]) => void;
  const reviewA = new Promise<string[]>(resolve => { releaseA = resolve; });
  const stampA = gate.capture();
  assert.equal(gate.setScope("staff-B"), true);
  proposals = [];
  releaseA(["A: respuesta retenida"]);
  const stale = scopedResult(gate, stampA, await reviewA);
  if (stale) proposals = stale;
  assert.deepEqual(proposals, []);

  let releaseB!: (value: string[]) => void;
  const reviewB = new Promise<string[]>(resolve => { releaseB = resolve; });
  const stampB = gate.capture();
  proposals = ["B: dato previo"];
  assert.equal(gate.setScope(null), true);
  proposals = [];
  releaseB(["B: respuesta retenida"]);
  const denied = scopedResult(gate, stampB, await reviewB);
  if (denied) proposals = denied;
  assert.deepEqual(proposals, []);
  gate.setScope("staff-A");
  assert.equal(gate.allows(stampA), false, "A→B→denied→A must not revive an old callback");
});

test("late not_recorded cannot resurrect pending after confirmed issued", async () => {
  __resetLinkMemoryForTest();
  const gate = new StaffAuthorityGate();
  const turno = "66666666-6666-4666-8666-666666666666";
  gate.setScope("staff-A");
  const operation = await newLinkOperation("staff-A", turno, { generation: "0", contextHash: "d".repeat(64), active: false }, "issue");
  beginLinkOperation(operation);
  const stamp = gate.capture();
  let releaseOld!: (value: "not_recorded") => void;
  const oldStatus = new Promise<"not_recorded">(resolve => { releaseOld = resolve; });
  resolveLinkOperation(operation, "issued", { generation: "1", invitationId: turno, expiresAt: "2026-09-27T00:00:00Z" });
  releaseOld("not_recorded");
  const late = await oldStatus;
  let visiblePending = false;
  if (late === "not_recorded" && mayApplyLinkStatus(gate, stamp, operation)) visiblePending = true;
  assert.equal(visiblePending, false);
  assert.equal(pendingLinkOperation("staff-A", turno), null);
  __resetLinkMemoryForTest();
});

test("not_received keeps one operation and frozen answers; received never downgrades", () => {
  const attempt = newSubmissionAttempt({ nombre: "Ana" }, "22222222-2222-4222-8222-222222222222");
  const absent = reconcileAttempt(attempt, { status: "not_received" });
  assert.equal(absent.operationId, attempt.operationId);
  assert.deepEqual(absent.answers, attempt.answers);
  const received = reconcileAttempt(absent, { status: "received", receiptId: "receipt" });
  assert.equal(reconcileAttempt(received, { status: "not_received" }).phase, "received");
  assert.equal(mergeAttemptForOperation(received, attempt.operationId, { status: "not_received" })?.phase, "received");
  assert.equal(mergeAttemptForOperation(received, "other-operation", { status: "uncertain" })?.phase, "received");
});

test("out-of-order status and timeout cannot replace a received receipt", () => {
  const operationId = "44444444-4444-4444-8444-444444444444";
  let current = newSubmissionAttempt({ nombre: "Ana" }, operationId);
  const olderStatus = { status: "not_received" };
  current = mergeAttemptForOperation(current, operationId, { status: "received", receiptId: "receipt-1" })!;
  current = mergeAttemptForOperation(current, operationId, olderStatus)!;
  current = mergeAttemptForOperation(current, operationId, { status: "uncertain" })!;
  assert.equal(current.phase, "received");
  assert.equal(current.receiptId, "receipt-1");
});
