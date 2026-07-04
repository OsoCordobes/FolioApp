import assert from "node:assert/strict";
import test from "node:test";

import { decideServicioParaAceptar } from "../../lib/db/pedidos";
import { decideSlotOcupado } from "../../lib/db/turnos";

// ─── decideServicioParaAceptar (pura) ────────────────────────────────────
//
// "Aceptar con otro horario" (aceptarPedidoConHorario): el servicio a usar es
// el override del picker si vino, sino el del pedido. Duración/precio salen
// de la fila de `servicio` SOLO cuando el elegido no es el del pedido.

const SERV_A = "11111111-1111-4111-8111-111111111111";
const SERV_B = "22222222-2222-4222-8222-222222222222";

test("decideServicioParaAceptar: pedido con servicio, sin override → el del pedido, datos del pedido", () => {
  const d = decideServicioParaAceptar(SERV_A, null);
  assert.equal(d.servicioId, SERV_A);
  assert.equal(d.usarDatosDelServicio, false);
});

test("decideServicioParaAceptar: pedido sin servicio, con override → el elegido, datos del servicio", () => {
  const d = decideServicioParaAceptar(null, SERV_B);
  assert.equal(d.servicioId, SERV_B);
  assert.equal(d.usarDatosDelServicio, true);
});

test("decideServicioParaAceptar: override distinto al del pedido → reasignación con datos del servicio", () => {
  const d = decideServicioParaAceptar(SERV_A, SERV_B);
  assert.equal(d.servicioId, SERV_B);
  assert.equal(d.usarDatosDelServicio, true);
});

test("decideServicioParaAceptar: override IGUAL al del pedido → se preservan duración/precio del pedido", () => {
  const d = decideServicioParaAceptar(SERV_A, SERV_A);
  assert.equal(d.servicioId, SERV_A);
  assert.equal(d.usarDatosDelServicio, false);
});

test("decideServicioParaAceptar: sin servicio en el pedido ni override → null (err de validación en el caller)", () => {
  const d = decideServicioParaAceptar(null, null);
  assert.equal(d.servicioId, null);
  assert.equal(d.usarDatosDelServicio, false);
});

// ─── Solapamiento del horario ELEGIDO (semántica del wrapper) ─────────────
//
// aceptarPedidoConHorario delega el chequeo en promotePedidoToTurno →
// checkSlotOcupado → decideSlotOcupado, pasando la fecha ELEGIDA (no la
// propuesta) y excludePedidoId = el propio pedido. Estos tests fijan esa
// semántica con datos sintéticos: el slot nuevo se valida contra turnos/
// pedidos/bloqueos ajenos, y la fecha_propuesta VIEJA del propio pedido no
// se auto-conflictúa.

const PEDIDO_ID = "33333333-3333-4333-8333-333333333333";
const nuevoInicioMs = new Date("2026-07-10T14:00:00.000Z").getTime();
const nuevoFinMs = nuevoInicioMs + 45 * 60_000;

test("otro horario: slot elegido libre → no ocupado", () => {
  const ocupado = decideSlotOcupado(
    nuevoInicioMs,
    nuevoFinMs,
    { turnos: null, pedidos: null, bloqueos: null },
    PEDIDO_ID,
  );
  assert.equal(ocupado, false);
});

test("otro horario: slot elegido pisa un turno existente → ocupado", () => {
  const ocupado = decideSlotOcupado(
    nuevoInicioMs,
    nuevoFinMs,
    {
      turnos: [
        { id: "t1", inicio: new Date(nuevoInicioMs + 20 * 60_000).toISOString(), duracion_min: 30 },
      ],
      pedidos: null,
      bloqueos: null,
    },
    PEDIDO_ID,
  );
  assert.equal(ocupado, true);
});

test("otro horario: la fecha_propuesta vieja del PROPIO pedido no se auto-conflictúa", () => {
  // El pedido sigue PENDIENTE durante el chequeo; si el horario elegido
  // solapa su propia propuesta vieja, excludePedidoId lo filtra.
  const ocupado = decideSlotOcupado(
    nuevoInicioMs,
    nuevoFinMs,
    {
      turnos: null,
      pedidos: [
        {
          id: PEDIDO_ID,
          fecha_propuesta: new Date(nuevoInicioMs).toISOString(),
          duracion_min: 45,
        },
      ],
      bloqueos: null,
    },
    PEDIDO_ID,
  );
  assert.equal(ocupado, false);
});

test("otro horario: OTRO pedido pendiente en el slot elegido sí conflictúa", () => {
  const ocupado = decideSlotOcupado(
    nuevoInicioMs,
    nuevoFinMs,
    {
      turnos: null,
      pedidos: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          fecha_propuesta: new Date(nuevoInicioMs).toISOString(),
          duracion_min: 45,
        },
      ],
      bloqueos: null,
    },
    PEDIDO_ID,
  );
  assert.equal(ocupado, true);
});

test("otro horario: bloqueo del profesional en el slot elegido → ocupado", () => {
  const ocupado = decideSlotOcupado(
    nuevoInicioMs,
    nuevoFinMs,
    {
      turnos: null,
      pedidos: null,
      bloqueos: [
        { inicio: new Date(nuevoInicioMs - 10 * 60_000).toISOString(), duracion_min: 30 },
      ],
    },
    PEDIDO_ID,
  );
  assert.equal(ocupado, true);
});

test("otro horario: turno adyacente (termina justo al empezar el slot) → libre", () => {
  const ocupado = decideSlotOcupado(
    nuevoInicioMs,
    nuevoFinMs,
    {
      turnos: [
        { id: "t2", inicio: new Date(nuevoInicioMs - 30 * 60_000).toISOString(), duracion_min: 30 },
      ],
      pedidos: null,
      bloqueos: null,
    },
    PEDIDO_ID,
  );
  assert.equal(ocupado, false);
});
