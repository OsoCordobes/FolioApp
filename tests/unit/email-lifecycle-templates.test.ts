/**
 * M65 · templates puros de emails de lifecycle de suscripción.
 *
 * Fija el contrato de los 6 builders: subject con lo esperado, html con el
 * monto formateado ARS y el CTA a billing, y escape de HTML en inputs. También
 * fija `formatArs` (formato determinístico hecho a mano, sin Intl) y
 * `humanizarErrorPago` (el crudo de MP jamás llega al usuario).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { formatArs } from "../../lib/email/templates/billing-common";
import { buildPagoFallidoEmail, humanizarErrorPago } from "../../lib/email/templates/pago-fallido";
import { buildSuscripcionActivadaEmail } from "../../lib/email/templates/suscripcion-activada";
import { buildSuscripcionCanceladaMorosidadEmail } from "../../lib/email/templates/suscripcion-cancelada-morosidad";
import { buildSuscripcionReactivadaEmail } from "../../lib/email/templates/suscripcion-reactivada";
import { buildSuscripcionSuspendidaEmail } from "../../lib/email/templates/suscripcion-suspendida";
import { buildTrialPorVencerEmail } from "../../lib/email/templates/trial-por-vencer";

const ORG = "Consultorio Lorenzo";
const BILLING_URL = "https://folio.app/configuracion/billing";
const SOLO_CENTS = 3_000_000; // ARS 30.000
const SOLO_ARS = "$ 30.000";

// ─── formatArs ───────────────────────────────────────────────────────────────

test("formatArs: montos de plan y bordes", () => {
  assert.equal(formatArs(3_000_000), "$ 30.000");
  assert.equal(formatArs(10_000_000), "$ 100.000");
  assert.equal(formatArs(15_000_000), "$ 150.000");
  assert.equal(formatArs(0), "$ 0");
  assert.equal(formatArs(123_456), "$ 1.234,56");
  assert.equal(formatArs(100), "$ 1");
  assert.equal(formatArs(-3_000_000), "-$ 30.000");
});

// ─── trial-por-vencer ────────────────────────────────────────────────────────

test("trial-por-vencer (3 días): subject con umbral, html con monto + CTA", () => {
  const { subject, html } = buildTrialPorVencerEmail({
    organizationNombre: ORG,
    diasRestantes: 3,
    montoMensualCents: SOLO_CENTS,
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("en 3 días"));
  assert.ok(html.includes(SOLO_ARS));
  assert.ok(html.includes(BILLING_URL));
  assert.ok(html.includes(ORG));
  assert.ok(html.includes("Activar suscripción"));
});

test("trial-por-vencer (7 días): primer aviso del grace de 30 — subject con umbral", () => {
  const { subject, html } = buildTrialPorVencerEmail({
    organizationNombre: ORG,
    diasRestantes: 7,
    montoMensualCents: SOLO_CENTS,
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("en 7 días"));
  assert.ok(html.includes(SOLO_ARS));
  assert.ok(html.includes(BILLING_URL));
  assert.ok(html.includes(ORG));
});

test("trial-por-vencer (1 día): subject dice 'mañana'", () => {
  const { subject, html } = buildTrialPorVencerEmail({
    organizationNombre: ORG,
    diasRestantes: 1,
    montoMensualCents: SOLO_CENTS,
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("mañana"));
  assert.ok(!subject.includes("días"));
  assert.ok(html.includes("mañana"));
});

// ─── pago-fallido ────────────────────────────────────────────────────────────

test("pago-fallido: subject de cobro fallido, html con monto + motivo humanizado + reintento MP + CTA", () => {
  const { subject, html } = buildPagoFallidoEmail({
    organizationNombre: ORG,
    montoCents: SOLO_CENTS,
    ultimoError: "cc_rejected_insufficient_amount",
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("No pudimos procesar el cobro"));
  assert.ok(html.includes(SOLO_ARS));
  assert.ok(html.includes("fondos suficientes"));
  // El crudo de MP nunca llega al usuario.
  assert.ok(!html.includes("cc_rejected_insufficient_amount"));
  // Aclaración de que MP reintenta solo.
  assert.ok(html.includes("reintentar el cobro automáticamente"));
  assert.ok(html.includes(BILLING_URL));
});

test("humanizarErrorPago: mapea los rechazos conocidos de MP", () => {
  assert.equal(
    humanizarErrorPago("cc_rejected_insufficient_amount"),
    "La tarjeta no tenía fondos suficientes.",
  );
  assert.ok(humanizarErrorPago("cc_rejected_bad_filled_security_code").includes("código de seguridad"));
  assert.ok(humanizarErrorPago("cc_rejected_call_for_authorize").includes("banco"));
  assert.ok(humanizarErrorPago("cc_rejected_high_risk").includes("seguridad"));
  // Matching por substring (prefijos/sufijos del provider).
  assert.ok(humanizarErrorPago("rejected: CC_REJECTED_CARD_DISABLED (mp)").includes("deshabilitada"));
});

test("humanizarErrorPago: null o desconocido → fallback genérico, nunca el crudo", () => {
  const generico = "El medio de pago rechazó el cobro.";
  assert.equal(humanizarErrorPago(null), generico);
  assert.equal(humanizarErrorPago("status_detail_nuevo_de_mp_2027"), generico);
});

// ─── suscripcion-suspendida ──────────────────────────────────────────────────

test("suscripcion-suspendida: subject, qué implica, cómo reactivar, monto + CTA", () => {
  const { subject, html } = buildSuscripcionSuspendidaEmail({
    organizationNombre: ORG,
    montoMensualCents: SOLO_CENTS,
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("suspendida"));
  assert.ok(html.includes("no se borra")); // los datos quedan
  assert.ok(html.includes("Reactivar suscripción"));
  assert.ok(html.includes(SOLO_ARS));
  assert.ok(html.includes(BILLING_URL));
});

// ─── suscripcion-reactivada ──────────────────────────────────────────────────

test("suscripcion-reactivada: subject positivo, html con monto + CTA", () => {
  const { subject, html } = buildSuscripcionReactivadaEmail({
    organizationNombre: ORG,
    montoMensualCents: SOLO_CENTS,
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("activa de nuevo"));
  assert.ok(html.includes(SOLO_ARS));
  assert.ok(html.includes(BILLING_URL));
  assert.ok(html.includes(ORG));
});

// ─── suscripcion-cancelada-morosidad ─────────────────────────────────────────

test("suscripcion-cancelada-morosidad: subject, datos a salvo, cómo volver, monto + CTA", () => {
  const { subject, html } = buildSuscripcionCanceladaMorosidadEmail({
    organizationNombre: ORG,
    montoMensualCents: SOLO_CENTS,
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("cancelada por falta de pago"));
  assert.ok(html.includes("no se borran"));
  assert.ok(html.includes("nueva suscripción"));
  assert.ok(html.includes(SOLO_ARS));
  assert.ok(html.includes(BILLING_URL));
});

// ─── suscripcion-activada ────────────────────────────────────────────────────

test("suscripcion-activada: bienvenida con monto + CTA", () => {
  const { subject, html } = buildSuscripcionActivadaEmail({
    organizationNombre: ORG,
    montoMensualCents: SOLO_CENTS,
    billingUrl: BILLING_URL,
  });
  assert.ok(subject.includes("activa"));
  assert.ok(html.includes(SOLO_ARS));
  assert.ok(html.includes(BILLING_URL));
  assert.ok(html.includes(ORG));
  assert.ok(html.includes("cancelar cuando quieras"));
});

// ─── Clínica: monto variable por seats ───────────────────────────────────────

test("templates muestran el monto Clínica (base + seats) tal como llega", () => {
  const { html } = buildSuscripcionActivadaEmail({
    organizationNombre: "Clínica Brass",
    montoMensualCents: 15_000_000, // base 100K + 2 seats × 25K
    billingUrl: BILLING_URL,
  });
  assert.ok(html.includes("$ 150.000"));
});

// ─── Escape de HTML ──────────────────────────────────────────────────────────

test("los templates escapan HTML en el nombre de la organización", () => {
  const evil = 'Clínica <script>alert("x")</script>';
  for (const html of [
    buildTrialPorVencerEmail({
      organizationNombre: evil,
      diasRestantes: 3,
      montoMensualCents: SOLO_CENTS,
      billingUrl: BILLING_URL,
    }).html,
    buildPagoFallidoEmail({
      organizationNombre: evil,
      montoCents: SOLO_CENTS,
      ultimoError: null,
      billingUrl: BILLING_URL,
    }).html,
    buildSuscripcionSuspendidaEmail({
      organizationNombre: evil,
      montoMensualCents: SOLO_CENTS,
      billingUrl: BILLING_URL,
    }).html,
    buildSuscripcionReactivadaEmail({
      organizationNombre: evil,
      montoMensualCents: SOLO_CENTS,
      billingUrl: BILLING_URL,
    }).html,
    buildSuscripcionCanceladaMorosidadEmail({
      organizationNombre: evil,
      montoMensualCents: SOLO_CENTS,
      billingUrl: BILLING_URL,
    }).html,
    buildSuscripcionActivadaEmail({
      organizationNombre: evil,
      montoMensualCents: SOLO_CENTS,
      billingUrl: BILLING_URL,
    }).html,
  ]) {
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  }
});
