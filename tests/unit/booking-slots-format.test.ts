import assert from "node:assert/strict";
import test from "node:test";

import {
  agruparPorDia,
  diaKey,
  fmtDia,
  fmtHora,
  TZ_AR,
} from "../../lib/booking/slots-format";

/**
 * Folio · helpers de formateo/agrupado de slots (F2 · identidad del portal).
 *
 * Compartidos entre el wizard del booking público y el picker de reagenda del
 * portal del paciente. La premisa central: los ISO llegan en UTC y se agrupan
 * por día calendario ARGENTINO (UTC-3 fijo) — un slot a la 01:00Z pertenece al
 * día AR ANTERIOR (22:00 hora argentina).
 *
 * Runs con el runner nativo de Node:
 *   node --test --import tsx tests/unit/booking-slots-format.test.ts
 */

test("fmtHora presenta el instante UTC en hora argentina (UTC-3)", () => {
  assert.equal(fmtHora("2026-08-10T13:00:00.000Z"), "10:00");
  assert.equal(fmtHora("2026-08-10T13:30:00.000Z"), "10:30");
});

test("fmtHora: 24h explícito, nunca 'a. m.' (Node resuelve es-AR como h12)", () => {
  // Este test corre en Node, donde el default de es-AR es h12: si alguien
  // saca `hourCycle`, acá aparece "10:00 a. m." y todo lo que concatena " hs"
  // (recordatorios, /t/[token], portal) le miente al paciente.
  assert.ok(!fmtHora("2026-08-10T13:00:00.000Z").includes("m."));
  assert.equal(fmtHora("2026-08-10T15:00:00.000Z"), "12:00");
  assert.equal(fmtHora("2026-08-11T01:00:00.000Z"), "22:00");
  assert.equal(fmtHora("2026-08-10T03:00:00.000Z"), "00:00");
});

test("fmtHora: la timezone es parametrizable (TZ configurada de la org)", () => {
  // Mismo instante, dos zonas: AR (UTC-3) y Ushuaia — que también es UTC-3 —
  // vs. UTC, para probar que el parámetro efectivamente se aplica.
  assert.equal(fmtHora("2026-08-10T13:00:00.000Z", "UTC"), "13:00");
  assert.equal(fmtHora("2026-08-10T13:00:00.000Z", "America/Argentina/Ushuaia"), "10:00");
  // Sin parámetro sigue siendo la TZ AR por defecto (no rompe a los callers).
  assert.equal(fmtHora("2026-08-10T13:00:00.000Z"), fmtHora("2026-08-10T13:00:00.000Z", TZ_AR));
});

test("diaKey agrupa por día calendario AR, no por día UTC", () => {
  // 01:00Z del 11-ago = 22:00 AR del 10-ago → pertenece al 10-ago.
  assert.equal(diaKey("2026-08-11T01:00:00.000Z"), "2026-08-10");
  assert.equal(diaKey("2026-08-11T13:00:00.000Z"), "2026-08-11");
});

test("fmtDia capitaliza y usa el calendario AR", () => {
  const label = fmtDia("2026-08-10T13:00:00.000Z"); // lunes 10 de agosto AR
  assert.equal(label.charAt(0), label.charAt(0).toUpperCase());
  assert.ok(label.includes("10"), `esperaba el día 10 en "${label}"`);
  // El cruce de medianoche AR: 01:00Z del 11 sigue siendo el día 10 en AR.
  assert.equal(fmtDia("2026-08-11T01:00:00.000Z"), label);
});

test("agruparPorDia: agrupa por día AR, ordena los grupos y preserva el orden interno", () => {
  const slots = [
    { inicio: "2026-08-10T13:00:00.000Z", fin: "2026-08-10T13:30:00.000Z" }, // 10-ago 10:00 AR
    { inicio: "2026-08-10T14:00:00.000Z", fin: "2026-08-10T14:30:00.000Z" }, // 10-ago 11:00 AR
    { inicio: "2026-08-11T01:00:00.000Z", fin: "2026-08-11T01:30:00.000Z" }, // 10-ago 22:00 AR (¡cruce!)
    { inicio: "2026-08-11T13:00:00.000Z", fin: "2026-08-11T13:30:00.000Z" }, // 11-ago 10:00 AR
  ];

  const grupos = agruparPorDia(slots);

  // Dos días AR, no tres (el slot 01:00Z del 11 cae en el grupo del 10).
  assert.equal(grupos.length, 2);
  assert.equal(grupos[0].items.length, 3);
  assert.equal(grupos[1].items.length, 1);

  // Orden interno preservado (el server ya manda los slots ordenados).
  assert.deepEqual(
    grupos[0].items.map((s) => s.inicio),
    [
      "2026-08-10T13:00:00.000Z",
      "2026-08-10T14:00:00.000Z",
      "2026-08-11T01:00:00.000Z",
    ],
  );

  // El label del grupo sale del primer slot del día.
  assert.equal(grupos[0].dia, fmtDia("2026-08-10T13:00:00.000Z"));
  assert.equal(grupos[1].dia, fmtDia("2026-08-11T13:00:00.000Z"));
});

test("agruparPorDia: entrada desordenada → grupos igualmente ordenados cronológicamente", () => {
  const slots = [
    { inicio: "2026-08-12T13:00:00.000Z", fin: "2026-08-12T13:30:00.000Z" },
    { inicio: "2026-08-10T13:00:00.000Z", fin: "2026-08-10T13:30:00.000Z" },
  ];
  const grupos = agruparPorDia(slots);
  assert.equal(grupos.length, 2);
  assert.equal(grupos[0].items[0].inicio, "2026-08-10T13:00:00.000Z");
  assert.equal(grupos[1].items[0].inicio, "2026-08-12T13:00:00.000Z");
});

test("agruparPorDia: lista vacía → sin grupos", () => {
  assert.deepEqual(agruparPorDia([]), []);
});
