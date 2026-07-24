import assert from "node:assert/strict";
import test from "node:test";

import { validateFranjas, type Franja } from "../../lib/onboarding/franjas";

test("franjas válidas sin solape pasan", () => {
  const franjas: Franja[] = [
    ["09:00", "12:00"],
    ["15:00", "18:00"],
  ];
  const result = validateFranjas(franjas);
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.porFranja, [undefined, undefined]);
});

test("lista vacía es inválida (dejaría al usuario sin disponibilidad)", () => {
  const result = validateFranjas([]);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /al menos una franja/i);
});

test("franja invertida (fin < inicio) es inválida", () => {
  const result = validateFranjas([["12:00", "09:00"]]);
  assert.equal(result.ok, false);
  assert.match(result.porFranja[0] ?? "", /después del inicio/i);
});

test("franja con fin == inicio es inválida", () => {
  const result = validateFranjas([["09:00", "09:00"]]);
  assert.equal(result.ok, false);
  assert.match(result.porFranja[0] ?? "", /después del inicio/i);
});

test("franja incompleta (falta inicio o fin) es inválida", () => {
  const conFinVacio = validateFranjas([["09:00", ""]]);
  assert.equal(conFinVacio.ok, false);
  assert.match(conFinVacio.porFranja[0] ?? "", /inicio y fin/i);

  const conInicioVacio = validateFranjas([["", "12:00"]]);
  assert.equal(conInicioVacio.ok, false);
});

test("formato no HH:MM es inválido (CHECK disp_hora_format)", () => {
  const result = validateFranjas([["9:00", "12:00"]]);
  assert.equal(result.ok, false);
  assert.match(result.porFranja[0] ?? "", /HH:MM/);

  assert.equal(validateFranjas([["25:00", "26:00"]]).ok, false);
});

test("solape parcial entre franjas se detecta", () => {
  const result = validateFranjas([
    ["09:00", "12:00"],
    ["11:00", "14:00"],
  ]);
  assert.equal(result.ok, false);
  // El error se marca en la franja que choca con una anterior.
  assert.equal(result.porFranja[0], undefined);
  assert.match(result.porFranja[1] ?? "", /solapa/i);
});

test("franja contenida dentro de otra se detecta como solape", () => {
  const result = validateFranjas([
    ["08:00", "18:00"],
    ["10:00", "11:00"],
  ]);
  assert.equal(result.ok, false);
  assert.match(result.porFranja[1] ?? "", /solapa/i);
});

test("franjas contiguas (fin == inicio de la siguiente) NO son solape", () => {
  const result = validateFranjas([
    ["09:00", "12:00"],
    ["12:00", "15:00"],
  ]);
  assert.equal(result.ok, true);
});

test("el orden de las franjas no importa para el solape", () => {
  const result = validateFranjas([
    ["15:00", "18:00"],
    ["09:00", "16:00"],
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.porFranja.filter(Boolean).length, 1);
});

test("una franja inválida no participa del chequeo de solape", () => {
  const result = validateFranjas([
    ["12:00", "09:00"], // invertida
    ["09:00", "12:00"], // válida — no debería marcarse como solapada
  ]);
  assert.equal(result.ok, false);
  assert.match(result.porFranja[0] ?? "", /después del inicio/i);
  assert.equal(result.porFranja[1], undefined);
});
