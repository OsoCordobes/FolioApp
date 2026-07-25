/**
 * Tests · canOfferReactivate (review PR #117 · CTA del paywall dead-end).
 *
 * El hero del paywall promete "Reactivar por $X/mes" y su CTA enfoca el botón
 * primario de SubscriptionCard. Esta decisión pura define en qué estados la
 * card ofrece "Volver a activar" (mismo onActivate → preapproval nuevo):
 * PAUSADA siempre; MOROSA solo con el gate bloqueado (mientras el gate permite
 * acceso, MP sigue reintentando el preapproval vigente — un segundo preapproval
 * arriesga doble débito).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { canOfferReactivate } from "../../lib/billing/reactivate";

test("PAUSADA → reactivable siempre (el gate la bloquea siempre y el preapproval pausado no debita)", () => {
  assert.equal(canOfferReactivate({ estado: "PAUSADA", gateAllowed: false }), true);
  // gateAllowed=true no ocurre hoy para PAUSADA (computeAccessGate caso 3),
  // pero la decisión no depende del gate: reactivar una pausa es seguro.
  assert.equal(canOfferReactivate({ estado: "PAUSADA", gateAllowed: true }), true);
});

test("MOROSA con gate bloqueado (período pagado vencido) → reactivable", () => {
  assert.equal(canOfferReactivate({ estado: "MOROSA", gateAllowed: false }), true);
});

test("MOROSA con gate permitido (MP sigue reintentando el cobro) → NO ofrecer segundo preapproval", () => {
  assert.equal(canOfferReactivate({ estado: "MOROSA", gateAllowed: true }), false);
});

test("ACTIVA nunca ofrece reactivar (el server lo rechaza con conflict)", () => {
  assert.equal(canOfferReactivate({ estado: "ACTIVA", gateAllowed: true }), false);
  assert.equal(canOfferReactivate({ estado: "ACTIVA", gateAllowed: false }), false);
});

test("PENDIENTE_ACTIVACION y CANCELADA → false (sus ramas de la card ya tienen botón propio)", () => {
  for (const estado of ["PENDIENTE_ACTIVACION", "CANCELADA"] as const) {
    assert.equal(canOfferReactivate({ estado, gateAllowed: false }), false);
    assert.equal(canOfferReactivate({ estado, gateAllowed: true }), false);
  }
});
