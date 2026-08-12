/**
 * Folio · timeline de modificaciones de la historia clínica.
 *
 * La invariante que más importa acá NO es de formato: es que el timeline
 * muestre **qué campos cambiaron y nunca sus valores**. El payload de
 * `audit_log` trae la fila entera (before/after); mostrar el contenido sería
 * reconstruir la historia clínica en una pantalla que no pasa por la RLS de la
 * ficha.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  aEventoTimeline,
  agruparEventos,
  clasificarEvento,
  diffCamposAudit,
  VENTANA_AGRUPACION_MS,
  type EventoTimeline,
} from "../../lib/ficha/timeline-core";

// ─── Lo que NO se filtra ────────────────────────────────────────────────────

test("diffCamposAudit devuelve LABELS, nunca valores", () => {
  const campos = diffCamposAudit({
    before: { soap_s_cifrado: "\\xAAAA", eva_antes: 7 },
    after: { soap_s_cifrado: "\\xBBBB", eva_antes: 3 },
  });
  assert.deepEqual(campos, ["Subjetivo (S)", "EVA antes"]);
  // Ni el ciphertext ni el valor numérico pueden aparecer en la salida.
  const serializado = JSON.stringify(campos);
  assert.equal(serializado.includes("AAAA"), false);
  assert.equal(serializado.includes("BBBB"), false);
  assert.equal(serializado.includes("7"), false);
  assert.equal(serializado.includes("3"), false);
});

test("un campo desconocido sale como su nombre técnico, nunca como su contenido", () => {
  const campos = diffCamposAudit({
    before: { campo_nuevo_del_futuro: "secreto viejo" },
    after: { campo_nuevo_del_futuro: "secreto nuevo" },
  });
  assert.deepEqual(campos, ["campo_nuevo_del_futuro"]);
  assert.equal(JSON.stringify(campos).includes("secreto"), false);
});

test("el ruido de trigger no ensucia el timeline", () => {
  // updated_at lo mueve un trigger en CADA update; vertebras_json es el espejo
  // legacy de la herramienta y aparecería duplicado junto a tool_data_cifrado.
  const campos = diffCamposAudit({
    before: { updated_at: "2026-08-01", vertebras_json: [], id: "a", created_at: "x" },
    after: { updated_at: "2026-08-02", vertebras_json: [{ id: "C1" }], id: "a", created_at: "x" },
  });
  assert.deepEqual(campos, []);
});

test("payload sin forma de diff → sin campos, en vez de inventar", () => {
  for (const p of [null, undefined, 42, "texto", {}, { after: {} }, { before: {} }]) {
    assert.deepEqual(diffCamposAudit(p), [], JSON.stringify(p));
  }
});

test("un campo que no cambió no figura", () => {
  const campos = diffCamposAudit({
    before: { soap_s_cifrado: "\\xAA", soap_o_cifrado: "\\xBB" },
    after: { soap_s_cifrado: "\\xAA", soap_o_cifrado: "\\xCC" },
  });
  assert.deepEqual(campos, ["Objetivo (O)"]);
});

// ─── Títulos ────────────────────────────────────────────────────────────────

test("las acciones conocidas se traducen a es-AR", () => {
  assert.equal(clasificarEvento("nota_clinica.insert"), "Anotó en la ficha");
  assert.equal(clasificarEvento("sesion.update"), "Editó la nota de la visita");
  assert.equal(clasificarEvento("sesion_enmienda.insert"), "Agregó una enmienda");
});

test("una acción desconocida cae al identificador crudo, sin romper", () => {
  assert.equal(clasificarEvento("tabla_futura.update"), "tabla_futura.update");
});

// ─── Agrupación ─────────────────────────────────────────────────────────────

const ev = (
  id: string,
  ts: string,
  actorId: string,
  titulo: string,
  campos: string[],
  recurso = "sesion-1",
): EventoTimeline & { recurso: string } => ({
  id,
  ts,
  actorId,
  actorNombre: null,
  titulo,
  campos,
  agrupados: 1,
  recurso,
});

const clave = (e: EventoTimeline) => (e as EventoTimeline & { recurso: string }).recurso;

test("una ráfaga de autosave se colapsa en un solo evento", () => {
  // Sin esto el feature nace inusable: el autosave escribe cada pocos segundos,
  // así que una consulta de veinte minutos entierra el evento que importa.
  const out = agruparEventos(
    [
      ev("3", "2026-08-01T12:10:00Z", "prof-a", "Editó la nota de la visita", ["Subjetivo (S)"]),
      ev("2", "2026-08-01T12:05:00Z", "prof-a", "Editó la nota de la visita", ["Subjetivo (S)"]),
      ev("1", "2026-08-01T12:00:00Z", "prof-a", "Editó la nota de la visita", ["Subjetivo (S)"]),
    ],
    clave,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].agrupados, 3);
  // Conserva el MÁS RECIENTE: es el estado en el que quedó.
  assert.equal(out[0].id, "3");
});

test("el grupo suma los campos de toda la ráfaga", () => {
  const out = agruparEventos(
    [
      ev("2", "2026-08-01T12:05:00Z", "prof-a", "Editó la nota de la visita", ["Herramienta de la especialidad"]),
      ev("1", "2026-08-01T12:00:00Z", "prof-a", "Editó la nota de la visita", ["Subjetivo (S)"]),
    ],
    clave,
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].campos.sort(), ["Herramienta de la especialidad", "Subjetivo (S)"]);
});

test("otro actor NO se colapsa, aunque sea el mismo minuto", () => {
  // Este es el evento que el profesional está buscando: alguien más tocó su
  // ficha. Colapsarlo dentro de su propia ráfaga sería esconderlo.
  const out = agruparEventos(
    [
      ev("2", "2026-08-01T12:05:00Z", "prof-b", "Editó la nota de la visita", ["Plan (P)"]),
      ev("1", "2026-08-01T12:04:00Z", "prof-a", "Editó la nota de la visita", ["Subjetivo (S)"]),
    ],
    clave,
  );
  assert.equal(out.length, 2);
});

test("otro recurso o acción distinta tampoco se colapsan", () => {
  const distintoRecurso = agruparEventos(
    [
      ev("2", "2026-08-01T12:05:00Z", "prof-a", "Editó la nota de la visita", [], "sesion-2"),
      ev("1", "2026-08-01T12:04:00Z", "prof-a", "Editó la nota de la visita", [], "sesion-1"),
    ],
    clave,
  );
  assert.equal(distintoRecurso.length, 2);

  const distintaAccion = agruparEventos(
    [
      ev("2", "2026-08-01T12:05:00Z", "prof-a", "Anotó en la ficha", []),
      ev("1", "2026-08-01T12:04:00Z", "prof-a", "Editó la nota de la visita", []),
    ],
    clave,
  );
  assert.equal(distintaAccion.length, 2);
});

test("pasada la ventana, se abre un grupo nuevo", () => {
  // Volver al día siguiente a corregir la ficha es un evento distinto, no la
  // continuación del de ayer.
  const t0 = new Date("2026-08-01T12:00:00Z").getTime();
  const out = agruparEventos(
    [
      ev("2", new Date(t0 + VENTANA_AGRUPACION_MS + 60_000).toISOString(), "prof-a", "Editó la nota de la visita", []),
      ev("1", new Date(t0).toISOString(), "prof-a", "Editó la nota de la visita", []),
    ],
    clave,
  );
  assert.equal(out.length, 2);
});

test("agrupar no muta la lista de campos de la entrada", () => {
  const original = ev("1", "2026-08-01T12:00:00Z", "prof-a", "Editó la nota de la visita", ["Subjetivo (S)"]);
  const segundo = ev("2", "2026-08-01T12:05:00Z", "prof-a", "Editó la nota de la visita", ["Plan (P)"]);
  agruparEventos([segundo, original], clave);
  assert.deepEqual(original.campos, ["Subjetivo (S)"]);
  assert.deepEqual(segundo.campos, ["Plan (P)"]);
});

// ─── Mapeo del evento crudo ─────────────────────────────────────────────────

test("aEventoTimeline no arrastra el payload al resultado", () => {
  const out = aEventoTimeline({
    id: "1",
    ts: "2026-08-01T12:00:00Z",
    action: "sesion.update",
    resourceType: "sesion",
    resourceId: "s1",
    actorId: "prof-a",
    actorNombre: "Dra. López",
    payload: {
      before: { soap_s_cifrado: "\\xSECRETO" },
      after: { soap_s_cifrado: "\\xOTROSECRETO" },
    },
  });
  assert.equal(out.titulo, "Editó la nota de la visita");
  assert.deepEqual(out.campos, ["Subjetivo (S)"]);
  assert.equal(JSON.stringify(out).includes("SECRETO"), false);
  assert.equal("payload" in out, false);
});
