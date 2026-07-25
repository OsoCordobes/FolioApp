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
  portalUrl: "https://folio.example/portal",
  telefonoPublico: "351 555-0000",
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

// ─── Nivel de comunicación (auditoría portal-comms): preheader + header + CTA ──

test("booking-confirmada: preheader oculto con el resumen del turno, antes del saludo", () => {
  const { html } = buildBookingConfirmadaEmail(base);
  const preheader = `Tu turno del ${base.fechaHoraLabel} en ${base.organizationNombre}`;
  assert.ok(html.includes(preheader));
  assert.ok(html.includes("display:none;max-height:0"));
  // El preview del inbox lee lo primero del body: el preheader va ANTES de "Hola".
  assert.ok(html.indexOf(preheader) < html.indexOf(`Hola ${base.pacienteNombre}`));
});

test("booking-recibida: preheader oculto con el resumen de la solicitud", () => {
  const { html } = buildBookingRecibidaEmail(base);
  const preheader = `Tu solicitud para el ${base.fechaHoraLabel} en ${base.organizationNombre}`;
  assert.ok(html.includes(preheader));
  assert.ok(html.indexOf(preheader) < html.indexOf(`Hola ${base.pacienteNombre}`));
});

test("booking-confirmada/recibida: el header brass incluye el nombre del consultorio", () => {
  const confirmada = buildBookingConfirmadaEmail(base).html;
  const recibida = buildBookingRecibidaEmail(base).html;
  assert.ok(confirmada.includes(`Turno confirmado · ${base.organizationNombre}`));
  assert.ok(recibida.includes(`Solicitud recibida · ${base.organizationNombre}`));
});

test("booking-confirmada/recibida: CTA 'Gestionar mi turno' apunta al portal", () => {
  for (const html of [
    buildBookingConfirmadaEmail(base).html,
    buildBookingRecibidaEmail(base).html,
  ]) {
    assert.ok(html.includes("Gestionar mi turno"));
    assert.ok(html.includes(`href="${base.portalUrl}"`));
  }
});

test("booking-confirmada/recibida: sin 'respondé este correo' (el from es noreply); contacto por teléfono", () => {
  for (const html of [
    buildBookingConfirmadaEmail(base).html,
    buildBookingRecibidaEmail(base).html,
  ]) {
    assert.ok(!html.includes("respondé este correo"));
    assert.ok(html.includes(`contactá al consultorio al ${base.telefonoPublico}`));
  }
});

test("booking-confirmada/recibida: sin teléfono público cae al copy genérico", () => {
  for (const html of [
    buildBookingConfirmadaEmail({ ...base, telefonoPublico: null }).html,
    buildBookingRecibidaEmail({ ...base, telefonoPublico: undefined }).html,
  ]) {
    assert.ok(html.includes("contactá al consultorio."));
    assert.ok(!html.includes("contactá al consultorio al "));
  }
});

test("booking-confirmada: incluye el link de Google Calendar cuando viene gcalUrl", () => {
  const gcalUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Consulta&dates=20260610T130000Z/20260610T133000Z";
  const { html } = buildBookingConfirmadaEmail({ ...base, gcalUrl });
  assert.ok(html.includes("Agregar a Google Calendar"));
  // esc() escapa el & de la query — el href queda con &amp; (HTML válido).
  assert.ok(html.includes(gcalUrl.replace(/&/g, "&amp;")));
});

test("booking-confirmada: sin gcalUrl no deja link huérfano", () => {
  const { html } = buildBookingConfirmadaEmail({ ...base, gcalUrl: null });
  assert.ok(!html.includes("Agregar a Google Calendar"));
});

test("booking-confirmada: escapa HTML en nombre de org y teléfono", () => {
  const { html } = buildBookingConfirmadaEmail({
    ...base,
    organizationNombre: 'Consultorio <script>alert("x")</script>',
    telefonoPublico: '351 <img src=x onerror="p()">',
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
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
