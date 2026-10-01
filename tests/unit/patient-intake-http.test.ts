import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { boundSession, readJsonBounded, sessionMarker, validPublicPost } from "../../lib/patient-intake/http";
import { isPatientIntakePath, decideRouteGate } from "../../lib/auth/route-decision";
import { newSubmissionAttempt, reconcileAttempt } from "../../lib/patient-intake/submission-attempt";

const a = "a".repeat(64);
const b = "b".repeat(64);
const url = "http://127.0.0.1:4410/api/patient-intake/submit";

test("anonymous contribution routes bypass staff audience and require their own credential", () => {
  for (const path of ["/aporte", "/api/patient-intake/exchange", "/api/patient-intake/submit", "/api/patient-intake/status"]) {
    assert.equal(isPatientIntakePath(path), true);
    assert.deepEqual(decideRouteGate(path, false), { kind: "pass" });
  }
  assert.equal(isPatientIntakePath("/api/patient-intake/staff"), false);
});

test("draft marker is bound to the exact exchanged cookie, including after another tab exchanges", () => {
  const marker = sessionMarker(a);
  assert.equal(boundSession(a, marker), true);
  assert.equal(boundSession(b, marker), false);
  assert.equal(boundSession(undefined, marker), false);
  assert.equal(boundSession(a, "a"), false);
  assert.notEqual(marker, sessionMarker(b));
});

test("public mutations reject missing, foreign, null, and non-JSON Origin", () => {
  function request(origin?: string, type = "application/json") {
    return new NextRequest(url, { method: "POST", headers: { host: "127.0.0.1:4410", ...(origin ? { origin } : {}), "content-type": type }, body: "{}" });
  }
  assert.equal(validPublicPost(request("http://127.0.0.1:4410")), true);
  assert.equal(validPublicPost(request()), false);
  assert.equal(validPublicPost(request("null")), false);
  assert.equal(validPublicPost(request("http://evil.test")), false);
  assert.equal(validPublicPost(request("http://127.0.0.1:4410", "text/plain")), false);
});

test("body limit is enforced while streaming even without Content-Length", async () => {
  const tooLarge = new NextRequest(url, { method: "POST", body: "x".repeat(300), headers: { "content-type": "application/json" } });
  await assert.rejects(readJsonBounded(tooLarge, 256), /body_too_large/);
  const valid = new NextRequest(url, { method: "POST", body: '{"marker":"ok"}', headers: { "content-type": "application/json" } });
  assert.deepEqual(await readJsonBounded(valid, 256), { marker: "ok" });
});

test("lost response retains operation and answers until same operation is reconciled", () => {
  const attempt = newSubmissionAttempt({ nombre: "Ana" }, "11111111-1111-4111-8111-111111111111");
  const uncertain = reconcileAttempt(attempt, { status: "uncertain" });
  assert.equal(uncertain.phase, "uncertain");
  assert.deepEqual(uncertain.answers, { nombre: "Ana" });
  assert.equal(uncertain.operationId, attempt.operationId);
  assert.equal(reconcileAttempt(uncertain, { status: "not_received" }).phase, "not_received");
  const received = reconcileAttempt(uncertain, { status: "received", receiptId: "receipt" });
  assert.equal(received.phase, "received");
  assert.equal(received.receiptId, "receipt");
});
