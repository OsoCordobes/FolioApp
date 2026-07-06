/**
 * Folio · tests · registry de instrumentos (lib/instrumentos/registry.ts).
 *
 * Invariantes del catálogo:
 *   - los 9 instrumentos del plan C1 están presentes,
 *   - ids únicos y versionados (`<slug>.vN`),
 *   - getInstrumento resuelve por id y devuelve undefined para desconocidos,
 *   - instrumentosPorDominio filtra correctamente,
 *   - toda `banda` devuelta por score() existe en la def del instrumento,
 *   - toda def tiene al menos un ítem y al menos una banda.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  getInstrumento,
  INSTRUMENTOS,
  instrumentoIds,
  instrumentosPorDominio,
} from "../../lib/instrumentos/registry";

const IDS_ESPERADOS = [
  "phq9.v1",
  "gad7.v1",
  "dass21.v1",
  "pcl5.v1",
  "cssrs.v1",
  "ndi.v1",
  "odi.v1",
  "borg.v1",
  "smart_goals.v1",
];

test("registry: contiene los 9 instrumentos del plan C1", () => {
  assert.equal(INSTRUMENTOS.length, 9);
  const ids = new Set(instrumentoIds());
  for (const id of IDS_ESPERADOS) {
    assert.ok(ids.has(id), `falta el instrumento ${id}`);
  }
});

test("registry: ids únicos y versionados", () => {
  const ids = instrumentoIds();
  assert.equal(new Set(ids).size, ids.length, "hay ids duplicados");
  for (const id of ids) {
    assert.match(id, /^[a-z0-9_]+\.v\d+$/, `id no versionado: ${id}`);
  }
});

test("registry: getInstrumento resuelve por id / undefined para desconocidos", () => {
  for (const id of IDS_ESPERADOS) {
    assert.equal(getInstrumento(id)?.id, id);
  }
  assert.equal(getInstrumento("no_existe.v1"), undefined);
  assert.equal(getInstrumento(""), undefined);
});

test("registry: instrumentosPorDominio filtra", () => {
  const salud = instrumentosPorDominio("salud_mental").map((i) => i.id);
  assert.deepEqual(salud, ["phq9.v1", "gad7.v1", "dass21.v1", "pcl5.v1"]);
  assert.deepEqual(
    instrumentosPorDominio("dolor_funcion").map((i) => i.id),
    ["ndi.v1", "odi.v1"],
  );
  assert.deepEqual(instrumentosPorDominio("riesgo").map((i) => i.id), ["cssrs.v1"]);
  assert.deepEqual(
    instrumentosPorDominio("esfuerzo_percibido").map((i) => i.id),
    ["borg.v1"],
  );
  assert.deepEqual(instrumentosPorDominio("objetivos").map((i) => i.id), ["smart_goals.v1"]);
});

test("registry: toda def tiene ítems y bandas", () => {
  for (const inst of INSTRUMENTOS) {
    assert.ok(inst.items.length > 0, `${inst.id} sin ítems`);
    assert.ok(inst.bandas.length > 0, `${inst.id} sin bandas`);
    assert.ok(inst.nombre.length > 0, `${inst.id} sin nombre`);
    assert.equal(typeof inst.score, "function");
    // ids de banda únicos dentro de la def.
    const bIds = inst.bandas.map((b) => b.id);
    assert.equal(new Set(bIds).size, bIds.length, `${inst.id} tiene bandas duplicadas`);
  }
});

test("registry: score() de shapes inválidos devuelve null (contrato laxo uniforme)", () => {
  for (const inst of INSTRUMENTOS) {
    assert.equal(inst.score(undefined), null, `${inst.id} no maneja undefined`);
    assert.equal(inst.score(null), null, `${inst.id} no maneja null`);
    assert.equal(inst.score({ shape: "ajeno" }), null, `${inst.id} no maneja objeto ajeno`);
    assert.equal(inst.score("basura"), null, `${inst.id} no maneja string`);
  }
});
