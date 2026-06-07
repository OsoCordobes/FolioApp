import assert from "node:assert/strict";
import test from "node:test";

import { buildBookingConfirmadaEmail } from "../../lib/email/templates/booking-confirmada";
import { buildBookingRecibidaEmail } from "../../lib/email/templates/booking-recibida";

const base = {
  pacienteNombre: "Carlos Vega",
  organizationNombre: "Consultorio Lorenzo",
  servicioNombre: "Consulta inicial",
  fechaHoraLabel: "miércoles, 10 de junio de 2026, 10:00",
  direccion: "Av. Siempreviva 742, Córdoba",
};

test("booking-confirmada: subject y html no vacíos, contienen los datos", () => {
  const { subject, html } = buildBookingConfirmadaEmail(base);
  assert.ok(subject.length > 0);
  assert.ok(html.length > 0);
  assert.ok(html.includes(base.pacienteNombre));
  assert.ok(html.includes(base.servicioNombre));
  assert.ok(html.includes(base.fechaHoraLabel));
  assert.ok(html.includes(base.direccion));
});

test("booking-recibida: subject y html no vacíos, contienen los datos", () => {
  const { subject, html } = buildBookingRecibidaEmail(base);
  assert.ok(subject.length > 0);
  assert.ok(html.length > 0);
  assert.ok(html.includes(base.pacienteNombre));
  assert.ok(html.includes(base.servicioNombre));
  assert.ok(html.includes(base.fechaHoraLabel));
  assert.ok(html.includes(base.direccion));
});

test("booking-confirmada: no lanza con direccion null", () => {
  assert.doesNotThrow(() => {
    const { html } = buildBookingConfirmadaEmail({ ...base, direccion: null });
    assert.ok(html.includes(base.pacienteNombre));
  });
});

test("booking-confirmada: no lanza con direccion undefined", () => {
  assert.doesNotThrow(() => {
    const { html } = buildBookingConfirmadaEmail({ ...base, direccion: undefined });
    assert.ok(html.includes(base.servicioNombre));
  });
});

test("booking-recibida: no lanza con direccion null/undefined", () => {
  assert.doesNotThrow(() => {
    buildBookingRecibidaEmail({ ...base, direccion: null });
    buildBookingRecibidaEmail({ ...base, direccion: undefined });
  });
});
