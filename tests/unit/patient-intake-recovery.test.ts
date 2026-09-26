import test from "node:test";
import assert from "node:assert/strict";
import { postIntakeJson } from "../../lib/patient-intake/browser-http";
import { beginStaffMutation, finishStaffMutation, pendingStaffMutation, withActionDeadline, __resetStaffMutationForTest } from "../../lib/patient-intake/staff-recovery";
import { newSubmissionAttempt, reconcileAttempt } from "../../lib/patient-intake/submission-attempt";

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

test("uncertain staff Action survives modal close in memory and cannot be cleared by an undelivered result", async () => {
  __resetStaffMutationForTest();
  const turno = "11111111-1111-4111-8111-111111111111";
  beginStaffMutation(turno, "issue");
  let resolveAction: ((value: string) => void) | undefined;
  const action = withActionDeadline(() => new Promise<string>(resolve => { resolveAction = resolve; }), 20);
  await assert.rejects(action, /action_timeout/);
  assert.equal(pendingStaffMutation(turno), "issue");
  resolveAction?.("committed_after_modal_closed");
  finishStaffMutation(turno, "issue", false);
  assert.equal(pendingStaffMutation(turno), "issue");
  assert.throws(() => beginStaffMutation(turno, "issue"), /staff_mutation_pending/);
  __resetStaffMutationForTest();
});

test("transport rejection after a possible commit leaves staff emission blocked", async () => {
  __resetStaffMutationForTest();
  const turno = "33333333-3333-4333-8333-333333333333";
  beginStaffMutation(turno, "issue");
  await assert.rejects(withActionDeadline(async () => { throw new Error("response_lost_after_commit"); }, 50), /response_lost_after_commit/);
  assert.equal(pendingStaffMutation(turno), "issue");
  finishStaffMutation(turno, "issue", false);
  assert.equal(pendingStaffMutation(turno), "issue");
  __resetStaffMutationForTest();
});

test("not_received keeps one operation and frozen answers; received never downgrades", () => {
  const attempt = newSubmissionAttempt({ nombre: "Ana" }, "22222222-2222-4222-8222-222222222222");
  const absent = reconcileAttempt(attempt, { status: "not_received" });
  assert.equal(absent.operationId, attempt.operationId);
  assert.deepEqual(absent.answers, attempt.answers);
  const received = reconcileAttempt(absent, { status: "received", receiptId: "receipt" });
  assert.equal(reconcileAttempt(received, { status: "not_received" }).phase, "received");
});
