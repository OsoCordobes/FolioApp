import assert from "node:assert/strict";
import test from "node:test";

import { computeAccessGate, type SuscripcionRow } from "../../lib/db/suscripcion";

const NOW = new Date("2026-06-01T12:00:00.000Z");

// Org creada hace mucho → grace period (7d) ya vencido salvo que la suscripción
// diga otra cosa.
const ORG_OLD = "2026-01-01T00:00:00.000Z";

function sub(partial: Partial<SuscripcionRow>): SuscripcionRow {
  return {
    id: "sus-1",
    organizationId: "org-1",
    mpPreapprovalId: "pre-1",
    payerEmail: "a@b.com",
    montoCents: 3000000,
    moneda: "ARS",
    estado: "ACTIVA",
    fechaAlta: ORG_OLD,
    fechaActivacion: ORG_OLD,
    proximaCobro: null,
    ultimoCobroTs: null,
    ultimoError: null,
    fechaCancelacion: null,
    createdAt: ORG_OLD,
    updatedAt: ORG_OLD,
    ...partial,
  };
}

test("computeAccessGate: PAUSADA → blocked with subscription_paused (not morosa copy)", () => {
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "PAUSADA" }), NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "subscription_paused");
  assert.equal(gate.graceDaysLeft, null);
});

test("computeAccessGate: MOROSA with proxima_cobro in future → allowed (paid period)", () => {
  const future = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "MOROSA", proximaCobro: future }), NOW);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, null);
});

test("computeAccessGate: MOROSA past proxima_cobro + grace expired → morosa_expired", () => {
  const past = new Date(NOW.getTime() - 1000).toISOString();
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "MOROSA", proximaCobro: past }), NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "subscription_morosa_expired");
  assert.equal(gate.graceDaysLeft, 0);
});

test("computeAccessGate: ACTIVA → always allowed", () => {
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "ACTIVA" }), NOW);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, null);
});

test("computeAccessGate: CANCELADA + grace expired → subscription_cancelled", () => {
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "CANCELADA", proximaCobro: null }), NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "subscription_cancelled");
});

test("computeAccessGate: no subscription within grace → allowed with days left", () => {
  const recentOrg = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const gate = computeAccessGate(recentOrg, null, NOW);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, null);
  assert.equal(gate.graceDaysLeft, 5);
});
