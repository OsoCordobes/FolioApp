import assert from "node:assert/strict";
import test from "node:test";

import { buildCalendarEventPayload } from "../../lib/google/sync";

const base = {
  organizationNombre: "Consultorio Lorenzo",
  servicioNombre: "Consulta inicial",
  pacienteNombre: "Carlos Vega",
  inicioIso: "2026-06-10T13:00:00.000Z",
  finIso: "2026-06-10T13:45:00.000Z",
  organizationTimezone: "America/Argentina/Buenos_Aires",
  organizationDireccion: "Av. Siempreviva 742, Córdoba",
  pacienteEmail: "carlos@example.com",
};

test("buildCalendarEventPayload: todos los campos presentes", () => {
  const p = buildCalendarEventPayload(base);
  assert.equal(p.summary, "Consulta inicial — Carlos Vega");
  assert.equal(p.timeZone, "America/Argentina/Buenos_Aires");
  assert.equal(p.start, base.inicioIso);
  assert.equal(p.end, base.finIso);
  assert.equal(p.location, base.organizationDireccion);
  assert.equal(p.attendeeEmail, base.pacienteEmail);
  assert.ok(p.description.includes("Consultorio Lorenzo"));
  assert.ok(p.description.includes("Folio"));
});

test("buildCalendarEventPayload: timezone null → fallback Cordoba", () => {
  const p = buildCalendarEventPayload({ ...base, organizationTimezone: null });
  assert.equal(p.timeZone, "America/Argentina/Cordoba");
});

test("buildCalendarEventPayload: email null → sin attendeeEmail", () => {
  const p = buildCalendarEventPayload({ ...base, pacienteEmail: null });
  assert.equal(p.attendeeEmail, undefined);
});

test("buildCalendarEventPayload: direccion null → sin location", () => {
  const p = buildCalendarEventPayload({ ...base, organizationDireccion: null });
  assert.equal(p.location, undefined);
});
