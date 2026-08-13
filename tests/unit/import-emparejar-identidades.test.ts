/**
 * Folio · unit tests del emparejamiento fila ↔ identidad del importador CSV
 * (lib/import/emparejar-identidades.ts).
 *
 * El caso que motiva el módulo: el RETURNING de un INSERT batch puede volver
 * en cualquier orden. Emparejando por posición, el `paciente` de una fila
 * terminaba colgado de la identidad cifrada de otra persona.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  emparejarIdentidades,
  type FilaEmparejable,
  type IdentidadInsertada,
} from "../../lib/import/emparejar-identidades";

/** Hash de juguete con la misma forma que un blind index (hex, 64 chars). */
const h = (semilla: string): string => semilla.padEnd(64, "0");

const fila = (dni: string | null, tel: string | null): FilaEmparejable => ({
  dniHash: dni === null ? null : h(dni),
  telHash: tel === null ? null : h(tel),
});

const identidad = (id: string, dni: string | null, tel: string | null): IdentidadInsertada => ({
  id,
  dni_hash: dni === null ? null : h(dni),
  telefono_hash: tel === null ? null : h(tel),
});

const idsEmparejados = (filas: FilaEmparejable[], insertadas: IdentidadInsertada[]) =>
  emparejarIdentidades(filas, insertadas).porFila.map((r) =>
    r.estado === "emparejada" ? r.identidadId : `sin_identidad:${r.motivo}`,
  );

// ─── El bug: RETURNING fuera de orden ───────────────────────────────────────

test("empareja por hash aunque el RETURNING venga en otro orden", () => {
  const filas = [fila("dniA", "telA"), fila("dniB", "telB"), fila("dniC", "telC")];
  // Postgres devuelve C, A, B — orden perfectamente legal.
  const insertadas = [
    identidad("id-C", "dniC", "telC"),
    identidad("id-A", "dniA", "telA"),
    identidad("id-B", "dniB", "telB"),
  ];

  assert.deepEqual(idsEmparejados(filas, insertadas), ["id-A", "id-B", "id-C"]);
  assert.deepEqual(emparejarIdentidades(filas, insertadas).identidadesSinFila, []);
});

test("emparejar por posición habría dado la identidad de otra persona", () => {
  const filas = [fila("dniA", "telA"), fila("dniB", "telB")];
  const insertadas = [identidad("id-B", "dniB", "telB"), identidad("id-A", "dniA", "telA")];

  const porPosicion = filas.map((_, i) => insertadas[i].id);
  assert.deepEqual(porPosicion, ["id-B", "id-A"]); // lo que hacía el código viejo
  assert.deepEqual(idsEmparejados(filas, insertadas), ["id-A", "id-B"]);
});

test("orden coincidente: mismo resultado, sin huérfanas", () => {
  const filas = [fila("dniA", "telA"), fila("dniB", "telB")];
  const insertadas = [identidad("id-A", "dniA", "telA"), identidad("id-B", "dniB", "telB")];

  const r = emparejarIdentidades(filas, insertadas);
  assert.deepEqual(idsEmparejados(filas, insertadas), ["id-A", "id-B"]);
  assert.deepEqual(r.identidadesSinFila, []);
});

// ─── Filas sin DNI (walk-ins de planilla) ───────────────────────────────────

test("filas sin DNI se emparejan por teléfono", () => {
  const filas = [fila(null, "telA"), fila(null, "telB"), fila("dniC", "telC")];
  const insertadas = [
    identidad("id-B", null, "telB"),
    identidad("id-C", "dniC", "telC"),
    identidad("id-A", null, "telA"),
  ];

  assert.deepEqual(idsEmparejados(filas, insertadas), ["id-A", "id-B", "id-C"]);
});

test("un DNI y un teléfono con el mismo hash no se confunden entre sí", () => {
  // Clave compuesta: (X, null) y (null, X) tienen que quedar separadas.
  const filas = [fila("X", null), fila(null, "X")];
  const insertadas = [identidad("id-tel", null, "X"), identidad("id-dni", "X", null)];

  assert.deepEqual(idsEmparejados(filas, insertadas), ["id-dni", "id-tel"]);
});

// ─── Claves repetidas: nunca mezclar en silencio ────────────────────────────

test("dos filas con la misma clave quedan sin identidad y las identidades se marcan para borrar", () => {
  const filas = [fila("dniA", "telA"), fila("dniA", "telA"), fila("dniB", "telB")];
  const insertadas = [
    identidad("id-1", "dniA", "telA"),
    identidad("id-2", "dniA", "telA"),
    identidad("id-B", "dniB", "telB"),
  ];

  const r = emparejarIdentidades(filas, insertadas);
  assert.deepEqual(idsEmparejados(filas, insertadas), [
    "sin_identidad:clave_ambigua",
    "sin_identidad:clave_ambigua",
    "id-B",
  ]);
  // Las dos ambiguas se borran; la buena no.
  assert.deepEqual(r.identidadesSinFila.sort(), ["id-1", "id-2"]);
});

test("dos identidades devueltas con la misma clave que una sola fila: nada se adivina", () => {
  const filas = [fila("dniA", "telA")];
  const insertadas = [identidad("id-1", "dniA", "telA"), identidad("id-2", "dniA", "telA")];

  const r = emparejarIdentidades(filas, insertadas);
  assert.deepEqual(idsEmparejados(filas, insertadas), ["sin_identidad:clave_ambigua"]);
  assert.deepEqual(r.identidadesSinFila.sort(), ["id-1", "id-2"]);
});

// ─── Filas o identidades sueltas ────────────────────────────────────────────

test("una fila que no volvió en el RETURNING se reporta, no desaparece", () => {
  const filas = [fila("dniA", "telA"), fila("dniB", "telB")];
  const insertadas = [identidad("id-B", "dniB", "telB")];

  const r = emparejarIdentidades(filas, insertadas);
  assert.equal(r.porFila.length, filas.length);
  assert.deepEqual(idsEmparejados(filas, insertadas), ["sin_identidad:sin_returning", "id-B"]);
  assert.deepEqual(r.identidadesSinFila, []);
});

test("una identidad que no corresponde a ninguna fila queda para borrar", () => {
  const filas = [fila("dniA", "telA")];
  const insertadas = [identidad("id-A", "dniA", "telA"), identidad("id-X", "dniX", "telX")];

  const r = emparejarIdentidades(filas, insertadas);
  assert.deepEqual(idsEmparejados(filas, insertadas), ["id-A"]);
  assert.deepEqual(r.identidadesSinFila, ["id-X"]);
});

test("sin identidades devueltas: todas las filas quedan sin identidad", () => {
  const filas = [fila("dniA", "telA"), fila(null, "telB")];

  const r = emparejarIdentidades(filas, []);
  assert.deepEqual(idsEmparejados(filas, []), [
    "sin_identidad:sin_returning",
    "sin_identidad:sin_returning",
  ]);
  assert.deepEqual(r.identidadesSinFila, []);
});

test("chunk vacío", () => {
  const r = emparejarIdentidades([], []);
  assert.deepEqual(r.porFila, []);
  assert.deepEqual(r.identidadesSinFila, []);
});
