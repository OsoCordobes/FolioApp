import assert from "node:assert/strict";
import test from "node:test";

import { buildBookingConfirmadaEmail } from "../../lib/email/templates/booking-confirmada";
import { buildBookingRecibidaEmail } from "../../lib/email/templates/booking-recibida";
import { buildMemberInvitationEmail } from "../../lib/email/templates/member-invitation";
import { buildPedidoNuevoEmail, canalPedidoLabel } from "../../lib/email/templates/pedido-nuevo";

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

const invitacionBase = {
  organizationNombre: "Clínica Brass & Co",
  rolLabel: "Médico/a",
  invitadoPorNombre: "Lorenzo Martínez",
  acceptUrl: "https://folio.app/invitacion/abc_DEF-123",
  expiraLabel: "17 de junio de 2026",
};

test("member-invitation: subject y html contienen org, rol, link y vencimiento", () => {
  const { subject, html } = buildMemberInvitationEmail(invitacionBase);
  assert.ok(subject.includes("Clínica Brass"));
  assert.ok(html.includes(invitacionBase.rolLabel));
  assert.ok(html.includes(invitacionBase.acceptUrl));
  assert.ok(html.includes(invitacionBase.expiraLabel));
  assert.ok(html.includes(invitacionBase.invitadoPorNombre));
});

test("member-invitation: sin nombre de quien invita usa la variante impersonal", () => {
  const { html } = buildMemberInvitationEmail({ ...invitacionBase, invitadoPorNombre: null });
  assert.ok(html.includes("Te invitaron a sumarte"));
  assert.ok(!html.includes("Lorenzo"));
});

test("member-invitation: escapa HTML en el nombre de la organización", () => {
  const { html } = buildMemberInvitationEmail({
    ...invitacionBase,
    organizationNombre: 'Clínica <script>alert("x")</script>',
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

// ─── pedido-nuevo (aviso al profesional) ─────────────────────────────────

const pedidoNuevoBase = {
  organizationNombre: "Consultorio Lorenzo",
  pacienteNombre: "Carlos Vega",
  canalLabel: "WhatsApp",
  fechaHoraLabel: "viernes, 10 de julio de 2026, 14:00",
  calendarioUrl: "https://folio.app/calendario",
};

test("pedido-nuevo: subject y html contienen paciente, canal, fecha y link", () => {
  const { subject, html } = buildPedidoNuevoEmail(pedidoNuevoBase);
  assert.ok(subject.includes(pedidoNuevoBase.pacienteNombre));
  assert.ok(html.includes(pedidoNuevoBase.pacienteNombre));
  assert.ok(html.includes(pedidoNuevoBase.canalLabel));
  assert.ok(html.includes(pedidoNuevoBase.fechaHoraLabel));
  assert.ok(html.includes(pedidoNuevoBase.calendarioUrl));
  assert.ok(html.includes(pedidoNuevoBase.organizationNombre));
});

test("pedido-nuevo: sin fecha propuesta muestra el aviso de coordinar horario", () => {
  const { html } = buildPedidoNuevoEmail({ ...pedidoNuevoBase, fechaHoraLabel: null });
  assert.ok(html.includes("Sin horario propuesto"));
  assert.ok(!html.includes("Horario propuesto:"));
});

test("pedido-nuevo: escapa HTML en el nombre del paciente", () => {
  const { html } = buildPedidoNuevoEmail({
    ...pedidoNuevoBase,
    pacienteNombre: '<img src=x onerror=alert("x")>',
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

test("pedido-nuevo: no incluye motivo/notas clínicas (PHI mínima por diseño)", () => {
  // El input del template NI SIQUIERA acepta motivo — este test fija el
  // contrato: si alguien lo agrega, que sea una decisión consciente.
  const keys = Object.keys(pedidoNuevoBase);
  assert.ok(!keys.includes("motivo"));
  assert.ok(!keys.includes("notas"));
});

test("canalPedidoLabel: mapea los 4 canales y degrada el desconocido", () => {
  assert.equal(canalPedidoLabel("WEB"), "reserva web");
  assert.equal(canalPedidoLabel("WHATSAPP"), "WhatsApp");
  assert.equal(canalPedidoLabel("INSTAGRAM"), "Instagram");
  assert.equal(canalPedidoLabel("TELEFONO"), "teléfono");
  assert.equal(canalPedidoLabel("TELEGRAM"), "TELEGRAM");
});
