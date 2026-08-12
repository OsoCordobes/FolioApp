/**
 * Folio · orden de la Historia de la ficha (sesiones + notas).
 *
 * El orden cronológico de una historia clínica es exactamente el tipo de regla
 * que merece un test y no una revisión visual: un ítem fuera de lugar —o peor,
 * uno que desaparece— cambia lo que el profesional entiende que pasó.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { mergeHistoria } from "../../lib/ficha/historia";

const S = (id: string, fecha: string) => ({ id, fecha, dato: { id, kind: "s" as const } });
const N = (id: string, fecha: string) => ({ id, fecha, dato: { id, kind: "n" as const } });

test("intercala sesiones y notas de la más reciente a la más vieja", () => {
  const out = mergeHistoria(
    [S("s1", "2026-07-01T10:00:00Z"), S("s2", "2026-07-10T10:00:00Z")],
    [N("n1", "2026-07-05T10:00:00Z"), N("n2", "2026-07-12T10:00:00Z")],
  );
  assert.deepEqual(
    out.map((i) => i.id),
    ["n2", "s2", "n1", "s1"],
  );
  assert.deepEqual(
    out.map((i) => i.tipo),
    ["nota", "sesion", "nota", "sesion"],
  );
});

test("empate exacto de instante: la sesión va primero", () => {
  // Convención estable: la nota escrita junto a una visita casi siempre la
  // complementa, así que se lee debajo. Lo que importa es que NO cambie entre
  // renders.
  const t = "2026-07-08T09:00:00Z";
  const out = mergeHistoria([S("s1", t)], [N("n1", t)]);
  assert.deepEqual(out.map((i) => i.id), ["s1", "n1"]);
});

test("el orden es determinista con varios ítems del mismo instante y tipo", () => {
  const t = "2026-07-08T09:00:00Z";
  const a = mergeHistoria([], [N("nb", t), N("na", t)]).map((i) => i.id);
  const b = mergeHistoria([], [N("na", t), N("nb", t)]).map((i) => i.id);
  assert.deepEqual(a, b, "el mismo conjunto tiene que rendir el mismo orden");
});

test("una fecha ilegible NO desaparece: va al final", () => {
  // Un ítem de la historia clínica que se pierde porque su timestamp no parseó
  // es peor que un ítem fuera de orden.
  const out = mergeHistoria(
    [S("s1", "2026-07-01T10:00:00Z")],
    [N("rota", "no soy una fecha")],
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((i) => i.id), ["s1", "rota"]);
});

test("listas vacías → historia vacía, sin romper", () => {
  assert.deepEqual(mergeHistoria([], []), []);
  assert.equal(mergeHistoria([S("s1", "2026-07-01T10:00:00Z")], []).length, 1);
  assert.equal(mergeHistoria([], [N("n1", "2026-07-01T10:00:00Z")]).length, 1);
});

test("max recorta después de ordenar, no antes", () => {
  // Recortar antes de ordenar dejaría afuera lo más reciente, que es justo lo
  // que el profesional necesita ver primero.
  const out = mergeHistoria(
    [S("viejo", "2026-01-01T10:00:00Z"), S("nuevo", "2026-12-01T10:00:00Z")],
    [N("medio", "2026-06-01T10:00:00Z")],
    2,
  );
  assert.deepEqual(out.map((i) => i.id), ["nuevo", "medio"]);
});

test("el dato original viaja intacto en cada ítem", () => {
  const out = mergeHistoria(
    [S("s1", "2026-07-01T10:00:00Z")],
    [N("n1", "2026-07-02T10:00:00Z")],
  );
  const nota = out.find((i) => i.tipo === "nota");
  const sesion = out.find((i) => i.tipo === "sesion");
  assert.deepEqual(nota?.dato, { id: "n1", kind: "n" });
  assert.deepEqual(sesion?.dato, { id: "s1", kind: "s" });
});
