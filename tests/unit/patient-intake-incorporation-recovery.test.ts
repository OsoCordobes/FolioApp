import test from "node:test";
import assert from "node:assert/strict";
import { adoptIncorporationScope, beginIncorporation, canonicalSelection, isPendingIncorporation, pendingIncorporation,
  reconcileIncorporation, conflictDraft, recoverDraftSelection, toggleIncorporationSelection, __resetIncorporationMemoryForTest,
  type IncorporationComparison } from "../../lib/patient-intake/incorporation-recovery";
import { StaffAuthorityGate, withActionDeadline } from "../../lib/patient-intake/staff-recovery";
import type { PublicIncorporationResult } from "../../lib/patient-intake/incorporation";

const snapshot: IncorporationComparison = { receiptId: "receipt", identityId: "identity", adminRevision: "9007199254740993",
  contextHash: "context", fields: [
    { key: "nombre", current: "Persona de prueba", proposed: "Nombre sintético" },
    { key: "tipoDocumento", current: "DNI", proposed: "PASAPORTE" },
    { key: "numeroDocumento", current: "12345678", proposed: "AB123456" },
  ] };
const operation = () => beginIncorporation("scope", "turno", snapshot, ["nombre"], "operation");
const receipt = (status: "applied" | "unchanged" | "conflict" | "cancelled" | "pending" | "materialized"): Exclude<PublicIncorporationResult, { status: "not_recorded" }> => ({
  status, operationId: "operation", receiptId: "receipt", identityId: "identity", selectedKeys: ["nombre"],
  changedKeys: status === "applied" ? ["nombre"] : [], revisionBefore: 1, revisionAfter: status === "applied" ? 2 : 1,
  reason: null, expiresAt: null,
});
test.beforeEach(() => __resetIncorporationMemoryForTest());

test("frozen operation survives deadline/reopen without retaining comparison PII", async () => {
  const started = operation();
  await assert.rejects(withActionDeadline(() => new Promise(() => {}), 5), /action_timeout/);
  const reopened = pendingIncorporation("scope", "turno");
  assert.equal(reopened, started);
  assert.equal(reopened?.adminRevision, "9007199254740993");
  assert.deepEqual(reopened?.selectedKeys, ["nombre"]);
  assert.equal(JSON.stringify(reopened).includes("sintético"), false);
  assert.equal("fields" in started, false);
  assert.ok(Object.isFrozen(started) && Object.isFrozen(started.selectedKeys));
  assert.throws(operation, /incorporation_pending/);
});

test("not recorded, pending and materialized never unlock another operation", () => {
  const started = operation();
  for (const result of [{ status: "not_recorded", operationId: "operation" } as const, receipt("pending"), receipt("materialized")]) {
    assert.equal(reconcileIncorporation(started, result), "pending");
    assert.throws(operation, /incorporation_pending/);
  }
});

test("terminal receipts resolve exactly the same operation and reject delayed resurrection", () => {
  for (const status of ["applied", "unchanged", "conflict", "cancelled"] as const) {
    const started = operation();
    assert.equal(reconcileIncorporation(started, receipt(status)), "terminal");
    assert.equal(pendingIncorporation("scope", "turno"), null);
    assert.equal(reconcileIncorporation(started, { status: "not_recorded", operationId: "operation" }), "invalid");
  }
});

test("mismatched identity, receipt, operation or selection cannot release the lock", () => {
  const started = operation();
  for (const field of ["identityId", "receiptId", "operationId", "selectedKeys"] as const) {
    const result = { ...receipt("applied"), [field]: field === "selectedKeys" ? ["apellido"] : "another" } as PublicIncorporationResult;
    assert.equal(reconcileIncorporation(started, result), "invalid");
    assert.ok(isPendingIncorporation(started));
  }
});

test("cancel before prepare tombstone releases only the matching operation", () => {
  const started = operation();
  assert.equal(reconcileIncorporation(started, { ...receipt("cancelled"), receiptId: null, identityId: null, selectedKeys: null }), "terminal");
});

test("scope isolation and A→B→A do not recover previous actor operations", () => {
  const started = operation();
  assert.equal(pendingIncorporation("other", "turno"), null);
  adoptIncorporationScope("other", "turno");
  assert.equal(pendingIncorporation("scope", "turno"), null);
  adoptIncorporationScope("scope", "turno");
  assert.equal(isPendingIncorporation(started), false);
});

test("authority invalidates late status/comparison after revocation or context/session ABA", () => {
  const gate = new StaffAuthorityGate(); gate.setScope("scope");
  const stamp = gate.capture();
  gate.setScope(null); gate.setScope("scope");
  assert.equal(gate.allows(stamp), false);
  gate.setScope("other"); assert.equal(gate.allows(stamp), false);
});

test("document toggles as a group, selection is canonical and rejects partial/missing source", () => {
  assert.deepEqual(toggleIncorporationSelection([], "tipoDocumento", true), ["tipoDocumento", "numeroDocumento"]);
  assert.deepEqual(toggleIncorporationSelection(["nombre", "tipoDocumento", "numeroDocumento"], "numeroDocumento", false), ["nombre"]);
  assert.deepEqual(canonicalSelection(["numeroDocumento", "nombre", "tipoDocumento", "nombre"]), ["nombre", "tipoDocumento", "numeroDocumento"]);
  assert.throws(() => beginIncorporation("scope", "turno", snapshot, ["numeroDocumento"]), /selection_invalid/);
  assert.throws(() => beginIncorporation("scope", "turno", snapshot, ["apellido"]), /selection_invalid/);
  assert.throws(() => beginIncorporation("scope", "turno", snapshot, []), /selection_invalid/);
});
test("conflict draft retains only metadata and filters fresh fields with document pair", () => {
  const started = beginIncorporation("scope", "turno", snapshot, ["nombre", "tipoDocumento", "numeroDocumento"]);
  const draft = conflictDraft(started);
  assert.equal("adminRevision" in draft, false); assert.equal("operationId" in draft, false); assert.equal("fields" in draft, false);
  assert.doesNotMatch(JSON.stringify(draft), /sintético|Persona/);
  assert.deepEqual(recoverDraftSelection(draft, "scope", "turno", { ...snapshot, adminRevision: "9007199254740994" }), ["nombre", "tipoDocumento", "numeroDocumento"]);
  assert.deepEqual(recoverDraftSelection(draft, "scope", "turno", { ...snapshot, fields: snapshot.fields.filter(field => field.key !== "numeroDocumento") }), ["nombre"]);
  for (const property of ["receiptId", "identityId", "contextHash"] as const) assert.equal(recoverDraftSelection(draft, "scope", "turno", { ...snapshot, [property]: "different" }), null);
  assert.equal(recoverDraftSelection(draft, "other", "turno", snapshot), null); assert.equal(recoverDraftSelection(draft, "scope", "other", snapshot), null);
});
