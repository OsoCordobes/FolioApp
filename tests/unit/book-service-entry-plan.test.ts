import assert from "node:assert/strict";
import test from "node:test";

import { planServiceEntry } from "../../components/book-landing/service-entry-plan";

test("reselecting the active service keeps an already loaded calendar", () => {
  const loadedSlots = [{ inicio: "2026-10-01T12:00:00Z", fin: "2026-10-01T13:00:00Z" }];
  const current = { serviceId: "consulta", vista: "slot" as const, slots: loadedSlots };

  assert.equal(planServiceEntry(current, "consulta", false), null);
  assert.equal(current.slots, loadedSlots);

  const changed = planServiceEntry(current, "control", false);
  assert.deepEqual(changed, { serviceId: "control", vista: "slot", slots: [] });
  assert.equal(planServiceEntry({ ...current, vista: "servicio" }, "consulta", false)?.vista, "slot");
});
