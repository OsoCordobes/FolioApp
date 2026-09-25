import assert from "node:assert/strict";
import test from "node:test";
import { OnboardingServicesDraft, beginServicesFlight, parseStoredServicesCommand, storeServicesCommand } from "../../lib/onboarding/services-draft";

const org = "00000000-0000-4000-8000-000000000010";
const item = { id: "00000000-0000-4000-8000-000000000020", nombre: "Consulta sintética", dur: 30, precioCents: 1000, tipoCanonico: "CONSULTA_INICIAL" as const };
const snapshot = { revision: 4, servicios: [item] };

test("respuesta incierta conserva exactamente operación y catálogo; autosave en cola no reescribe", () => {
  const draft = new OnboardingServicesDraft(org, snapshot);
  assert.equal(draft.edit([{ ...item, precioCents: 1200 }]), true);
  const first = draft.begin("00000000-0000-4000-8000-000000000030");
  assert.ok(first);
  draft.finish({ ok: false, uncertain: true, conflict: false });
  assert.equal(draft.locked, true);
  assert.equal(draft.edit([]), false);
  assert.equal(draft.begin("00000000-0000-4000-8000-000000000031"), null);
  assert.deepEqual(draft.begin("ignored", { retry: true }), first);
  draft.finish({ ok: true, data: { revision: 5, servicios: first!.servicios } });
  assert.equal(draft.locked, false);
  assert.equal(draft.revision, 5);
});

test("reapertura conserva la operación pendiente aunque el otro tab avanzó", () => {
  const pending = { organizationId: org, revision: 4, operacionId: "00000000-0000-4000-8000-000000000030", servicios: [{ ...item, nombre: "Editada" }] };
  const draft = new OnboardingServicesDraft(org, { revision: 6, servicios: [item] }, pending);
  assert.equal(draft.reload({ revision: 6, servicios: [item] }), false);
  assert.deepEqual(draft.begin("new", { retry: true }), pending);
  draft.finish({ ok: true, data: { revision: 5, servicios: pending.servicios } });
  assert.equal(draft.conflict, true);
  assert.equal(draft.begin("newer"), null);
  assert.equal(draft.reload({ revision: 6, servicios: [item] }), true);
  assert.equal(draft.conflict, false);
});

test("conflicto exige lectura nueva antes de un ID de operación nuevo", () => {
  const draft = new OnboardingServicesDraft(org, snapshot);
  draft.edit([]);
  draft.begin("00000000-0000-4000-8000-000000000030");
  draft.finish({ ok: false, uncertain: false, conflict: true });
  assert.equal(draft.begin("00000000-0000-4000-8000-000000000031"), null);
  assert.equal(draft.reload({ revision: 5, servicios: [item] }), true);
  assert.equal(draft.rows[0].id, item.id);
});

test("el reintento restaurado acepta sólo el comando propio e íntegro", () => {
  const command = { organizationId: org, revision: 4, operacionId: "00000000-0000-4000-8000-000000000030", servicios: [item] };
  const own = "00000000-0000-4000-8000-000000000040";
  assert.deepEqual(parseStoredServicesCommand(storeServicesCommand(command, own), org, own), command);
  assert.equal(parseStoredServicesCommand(storeServicesCommand(command, own), org, "00000000-0000-4000-8000-000000000041"), null);
  assert.equal(parseStoredServicesCommand(storeServicesCommand({ ...command, organizationId: "00000000-0000-4000-8000-000000000011" }, own), org, own), null);
  assert.equal(parseStoredServicesCommand(storeServicesCommand({ ...command, servicios: [item, item] }, own), org, own), null);
  assert.equal(parseStoredServicesCommand("{", org, own), null);
});

test("dos guardados sintéticos sucesivos limpian el vuelo tras cada respuesta inmediata", async () => {
  const flight: { current: Promise<number> | null } = { current: null };
  let writes = 0;
  const first = beginServicesFlight(flight, () => ++writes);
  assert.equal(beginServicesFlight(flight, () => ++writes), first);
  assert.equal(await first, 1);
  await Promise.resolve();
  assert.equal(flight.current, null);
  assert.equal(await beginServicesFlight(flight, () => ++writes), 2);
  await Promise.resolve();
  assert.equal(flight.current, null);
});
