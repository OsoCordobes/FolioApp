import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as submit } from "../../app/api/patient-intake/submit/route";
import { POST as status } from "../../app/api/patient-intake/status/route";
import { sessionMarker } from "../../lib/patient-intake/http";

const raw = "a".repeat(64);
const other = "b".repeat(64);
const operationId = "11111111-1111-4111-8111-111111111111";

function request(path: string, body: unknown, origin = "http://127.0.0.1:4410") {
  return new NextRequest(`http://127.0.0.1:4410/api/patient-intake/${path}`, {
    method: "POST", headers: { host: "127.0.0.1:4410", origin, "content-type": "application/json", cookie: `folio.intake.session=${other}` },
    body: JSON.stringify(body),
  });
}

test("two-tab cookie replacement rejects submission and status before a service RPC", async () => {
  const body = { marker: sessionMarker(raw), operationId, answers: { nombre: "Ana" } };
  assert.equal((await submit(request("submit", body))).status, 403);
  assert.equal((await status(request("status", body))).status, 403);
});

test("same-origin CSRF and body shape fail closed before service RPC", async () => {
  assert.equal((await submit(request("submit", { marker: sessionMarker(other), operationId, answers: { nombre: "Ana" } }, "http://other.test"))).status, 403);
  assert.equal((await submit(request("submit", { marker: sessionMarker(other), operationId, answers: { motivo: "clinical" } }))).status, 400);
  assert.equal((await submit(request("submit", { marker: sessionMarker(other), operationId, answers: { nombre: "x".repeat(21 * 1024) } }))).status, 400);
});
