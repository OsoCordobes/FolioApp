/** Synthetic browser fixture only. Esbuild substitutes this module for the server actions. */
const receiptId = "11111111-1111-4111-8111-111111111111";
const identityId = "22222222-2222-4222-8222-222222222222";
const context = "a".repeat(64);
type Operation = { operationId: string; receiptId: string; identityId: string; selectedKeys: string[] };
export const fixture = {
  scope: "b".repeat(64), context, identityId, revision: "7", omitted: [] as string[], denied: false, action: "applied", status: "not_recorded", delaySnapshot: false, delayAction: false,
  operations: [] as Operation[], statusIds: [] as string[], cancelIds: [] as string[],
  releaseSnapshot: (() => {}) as () => void,
  releaseAction: (() => {}) as () => void,
};
declare global { interface Window { intakeFixture: typeof fixture; reopenFixture: () => void; closeFixture: () => void; changeTurnoFixture: (value: string) => void; } }
window.intakeFixture = fixture;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const denied = () => ({ ok: false as const, error: { code: "forbidden", message: "Acceso revocado para este turno." } });
export async function getPatientIntakeLinkState() {
  return fixture.denied ? denied() : ok({ scope: fixture.scope, generation: "0", contextHash: fixture.context, active: false });
}
export async function reviewPatientIntake() {
  return fixture.denied ? denied() : ok([{ receiptId, receivedAt: "2026-09-30T12:00:00Z", questionnaireVersion: "admin.v1", origin: "aportado por el paciente", answers: { nombre: "Marina Sintética", apellido: "Paciente Demo", tipoDocumento: "PASAPORTE", numeroDocumento: "TEST12345", email: "marina@example.invalid", telefono: "+5493515550101", cobertura: { nombre: "Cobertura Demo", plan: "Plan Sintético", numeroAfiliado: "TEST-0001" } } }]);
}
export async function getPatientIntakeIncorporationSnapshot() {
  const data = { receiptId, identityId: fixture.identityId, adminRevision: fixture.revision, contextHash: fixture.context, fields: [
    { key: "nombre", current: "Marina Demo", proposed: "Marina Sintética" },
    { key: "apellido", current: "Paciente Demo", proposed: "Paciente Demo" },
    { key: "tipoDocumento", current: "DNI", proposed: "PASAPORTE" },
    { key: "numeroDocumento", current: "00000001", proposed: "TEST12345" },
    { key: "email", current: "demo@example.invalid", proposed: "marina@example.invalid" },
    { key: "telefono", current: null, proposed: "+5493515550101" },
    { key: "cobertura.nombre", current: "Cobertura Demo", proposed: "Cobertura Demo" },
    { key: "cobertura.plan", current: "Anterior", proposed: "Plan Sintético" },
    { key: "cobertura.numeroAfiliado", current: "TEST-OLD", proposed: "TEST-0001" },
  ].filter(field => !fixture.omitted.includes(field.key)) };
  if (fixture.delaySnapshot) await new Promise<void>(resolve => { fixture.releaseSnapshot = resolve; });
  return ok(data);
}
function result(operationId: string, status: string) {
  if (status === "not_recorded") return { status, operationId };
  const operation = fixture.operations.find(value => value.operationId === operationId)!;
  return { status, operationId, receiptId: operation?.receiptId ?? receiptId, identityId: operation?.identityId ?? identityId,
    selectedKeys: operation?.selectedKeys ?? [], changedKeys: status === "applied" ? operation?.selectedKeys : [],
    revisionBefore: 7, revisionAfter: status === "applied" ? 8 : 7, reason: null, expiresAt: null };
}
export async function applyPatientIntakeIncorporation(input: Operation) {
  fixture.operations.push(structuredClone(input));
  if (fixture.delayAction) await new Promise<void>(resolve => { fixture.releaseAction = resolve; });
  if (fixture.action === "lost") throw new Error("synthetic_lost_response");
  if (fixture.denied) return denied();
  return ok(result(input.operationId, fixture.action));
}
export async function patientIntakeIncorporationStatus(_turno: string, _scope: string, operationId: string) {
  fixture.statusIds.push(operationId);
  return fixture.denied ? denied() : ok(result(operationId, fixture.status));
}
export async function cancelPatientIntakeIncorporation(_turno: string, _scope: string, operationId: string) {
  fixture.cancelIds.push(operationId);
  return fixture.denied ? denied() : ok(result(operationId, "cancelled"));
}
export async function issuePatientIntakeLink() { throw new Error("not_in_fixture_scope"); }
export async function revokePatientIntakeLink() { throw new Error("not_in_fixture_scope"); }
export async function patientIntakeLinkOperationStatus() { throw new Error("not_in_fixture_scope"); }
