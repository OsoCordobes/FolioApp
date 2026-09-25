import test from "node:test";
import assert from "node:assert/strict";
import { readClinicalArchive } from "../../lib/patient/clinical-archive";
import { ok, err, type Result } from "../../lib/db/errors";
import type { ActiveSession } from "../../lib/db/session";
import type { DirectoryPage } from "../../lib/pacientes/directory";

const actor: ActiveSession = { userId: "owner", memberId: "member", organizationId: "org", role: "OWNER", esColegiado: false,
  email: "owner@example.invalid", emailVerified: true, isInternalAccount: false };
const page: DirectoryPage = { rows: [{ id: "patient", nombre: "Paciente sintético", tel: "PRIVATE_PHONE", email: "PRIVATE_EMAIL",
  tipo: "nuevo", sesiones: 0, ultima: null, proximo: null, tags: ["PRIVATE_TAG"], estado: "activo", cobertura: null, coberturaPlan: null }],
  total: 70, counts: {}, coberturas: [], nextCursor: "signed-next", revision: "r", cutoff: "cutoff" };
function fixture(before: Result<ActiveSession> = ok(actor), after = before) {
  let sessions = 0;
  const calls: unknown[] = [];
  let result: Result<DirectoryPage> = ok(page);
  let failure = false;
  return { calls, setPage(value: Result<DirectoryPage>) { result = value; }, fail() { failure = true; },
    dependencies: { getSession: async () => ++sessions === 1 ? before : after,
      readPage: async (...args: unknown[]) => { calls.push(args); if (failure) throw Error("PRIVATE_PROVIDER_DETAILS"); return result; } } };
}

test("commercially suspended owner can read a scoped page without disclosing unrelated directory fields", async () => {
  // No subscription exemption or service-role dependency is available to this reader.
  const f = fixture();
  const result = await readClinicalArchive({ query: " sintético ", cursor: "signed-next" }, f.dependencies);
  assert.deepEqual(f.calls, [[{ query: "sintético", cursor: "signed-next", status: "todos", coverage: "todas" }, undefined, { organizationId: "org", memberId: "member" }]]);
  assert.deepEqual(result, ok({ patients: [{ id: "patient", name: "Paciente sintético" }],
    total: 70, nextCursor: "signed-next",
    scope: { userId: "owner", organizationId: "org" } }));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});
for (const role of ["ASISTENTE", "COORDINADOR", "PROFESIONAL", "DIRECTOR"] as const) {
  test(`complete archive denies ${role} without full clinical authority before reading any patient`, async () => {
    const f = fixture(ok({ ...actor, role }));
    const result = await readClinicalArchive({}, f.dependencies);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "forbidden");
    assert.equal(f.calls.length, 0);
  });
}
test("licensed clinical director can read the complete archive", async () => {
  const f = fixture(ok({ ...actor, role: "DIRECTOR", esColegiado: true }));
  assert.equal((await readClinicalArchive({}, f.dependencies)).ok, true);
});
for (const code of ["auth_required", "mfa_required", "no_org"] as const) {
  test(`archive cannot bypass ${code} before or after reading`, async () => {
    const denied = err(code, "Access denied");
    const before = fixture(denied);
    assert.deepEqual(await readClinicalArchive({}, before.dependencies), denied);
    assert.equal(before.calls.length, 0);
    const after = fixture(ok(actor), denied);
    assert.deepEqual(await readClinicalArchive({}, after.dependencies), denied);
    assert.equal(after.calls.length, 1);
  });
}
for (const changed of [{ userId: "other" }, { memberId: "other" }, { organizationId: "other" }, { role: "ASISTENTE" as const }]) {
  test(`identity or permissions changed during archive read: ${Object.keys(changed)[0]}`, async () => {
    const f = fixture(ok(actor), ok({ ...actor, ...changed }));
    const result = await readClinicalArchive({}, f.dependencies);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "forbidden");
    assert.doesNotMatch(JSON.stringify(result), /Paciente sintético/);
  });
}
test("forged scope and oversized search/cursor are rejected before authentication or directory access", async () => {
  for (const input of [{ organizationId: "other" }, { query: "x".repeat(201) }, { cursor: "x".repeat(2049) }]) {
    const f = fixture();
    const result = await readClinicalArchive(input, f.dependencies);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, "validation");
    assert.equal(f.calls.length, 0);
  }
});
test("directory errors and interrupted reads cannot become an empty clinical archive", async () => {
  const f = fixture(); f.setPage(err("db_error", "Directory unavailable"));
  const result = await readClinicalArchive({}, f.dependencies);
  assert.equal(result.ok, false);
  f.fail();
  const interrupted = await readClinicalArchive({}, f.dependencies);
  assert.equal(interrupted.ok, false); if (!interrupted.ok) assert.equal(interrupted.error.code, "network");
  assert.doesNotMatch(JSON.stringify(interrupted), /PRIVATE_/);
});
