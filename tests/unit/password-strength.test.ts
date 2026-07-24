import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSWORD_STRENGTH_LABELS,
  passwordStrength,
} from "../../lib/auth/password-strength";

test("password vacía → 0 (el meter no se muestra)", () => {
  assert.equal(passwordStrength(""), 0);
});

test("scores crecientes según largo y variedad", () => {
  assert.equal(passwordStrength("abc"), 0); // corta, sin variedad
  assert.equal(passwordStrength("abcdefgh"), 1); // 8 chars lowercase
  assert.equal(passwordStrength("Abcdefgh"), 2); // + mayús/minús
  assert.equal(passwordStrength("Abcdefg1"), 3); // + dígito
  assert.equal(passwordStrength("Abcdefg1!"), 4); // + símbolo
});

test("score se capea en 4 (labels tiene 5 entradas, 0-4)", () => {
  assert.equal(passwordStrength("Abcdefghijkl1!"), 4);
  assert.equal(PASSWORD_STRENGTH_LABELS.length, 5);
  assert.equal(PASSWORD_STRENGTH_LABELS[4], "Excelente");
});
