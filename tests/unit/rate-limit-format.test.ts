import assert from "node:assert/strict";
import test from "node:test";

import { formatResetMessage } from "../../lib/security/rate-limit";

test("formatResetMessage: 0 segundos → mensaje genérico", () => {
  assert.equal(formatResetMessage(0), "Esperá un momento e intentá de nuevo.");
});

test("formatResetMessage: negativo o no-finito → mensaje genérico", () => {
  assert.equal(formatResetMessage(-1), "Esperá un momento e intentá de nuevo.");
  assert.equal(formatResetMessage(Number.NaN), "Esperá un momento e intentá de nuevo.");
  assert.equal(formatResetMessage(Number.POSITIVE_INFINITY), "Esperá un momento e intentá de nuevo.");
});

test("formatResetMessage: 1-60 segundos redondea a 1 minuto (singular)", () => {
  assert.equal(formatResetMessage(1), "Esperá 1 minuto e intentá de nuevo.");
  assert.equal(formatResetMessage(30), "Esperá 1 minuto e intentá de nuevo.");
  assert.equal(formatResetMessage(60), "Esperá 1 minuto e intentá de nuevo.");
});

test("formatResetMessage: 61+ segundos usa plural", () => {
  assert.equal(formatResetMessage(61), "Esperá 2 minutos e intentá de nuevo.");
  assert.equal(formatResetMessage(120), "Esperá 2 minutos e intentá de nuevo.");
  assert.equal(formatResetMessage(180), "Esperá 3 minutos e intentá de nuevo.");
});

test("formatResetMessage: 1 hora (3600s) → 60 minutos plural", () => {
  assert.equal(formatResetMessage(3600), "Esperá 60 minutos e intentá de nuevo.");
});
