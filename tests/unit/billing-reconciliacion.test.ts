/**
 * Folio · reconciliación de estado con el proveedor de cobros (C2).
 *
 * MOROSA es un estado **local**, derivado de cargos rechazados: el proveedor no
 * lo conoce. Mientras MercadoPago reintenta el débito su preapproval sigue
 * `authorized`, así que el cron de reconciliación traía "ACTIVA" y **pisaba la
 * morosidad**: el moroso recuperaba el acceso sin haber pagado un peso, y el
 * dunning (emails de suspensión, episodio `morosa_desde`) quedaba roto.
 *
 * La única vía legítima MOROSA→ACTIVA es un cargo APROBADO nuevo, que entra por
 * `recordChargeAttempt`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { decideEstadoFromProvider } from "../../lib/db/suscripcion";

test("MOROSA + el proveedor dice ACTIVA → se conserva MOROSA", () => {
  // El caso del hallazgo: MP sigue `authorized` porque está reintentando.
  const r = decideEstadoFromProvider({ estadoLocal: "MOROSA", estadoProveedor: "ACTIVA" });
  assert.equal(r.estado, "MOROSA");
  assert.equal(r.morosaPreservada, true, "tiene que quedar marcado para no extender proxima_cobro");
});

test("MOROSA + estados que SOLO el proveedor puede informar → el proveedor manda", () => {
  // Que MP haya agotado los reintentos (cancelled) o pausado la suscripción son
  // hechos que sólo él conoce, y ninguno le regala acceso a nadie.
  for (const delProveedor of ["CANCELADA", "PAUSADA"] as const) {
    const r = decideEstadoFromProvider({ estadoLocal: "MOROSA", estadoProveedor: delProveedor });
    assert.equal(r.estado, delProveedor, `MOROSA → ${delProveedor} tiene que escribirse`);
    assert.equal(r.morosaPreservada, false);
  }
});

test("desde cualquier otro estado local, el proveedor es la fuente de verdad", () => {
  const locales = ["ACTIVA", "PENDIENTE_ACTIVACION", "CANCELADA", "PAUSADA"] as const;
  for (const local of locales) {
    const r = decideEstadoFromProvider({ estadoLocal: local, estadoProveedor: "ACTIVA" });
    assert.equal(r.estado, "ACTIVA", `${local} + ACTIVA del proveedor → ACTIVA`);
    assert.equal(r.morosaPreservada, false);
  }
});

test("la decisión es idempotente: MOROSA sobre MOROSA no marca preservación", () => {
  // `morosaPreservada` significa "descarté un ACTIVA del proveedor", no "el
  // estado quedó en MOROSA". Confundirlos haría que un evento inocuo bloquee la
  // actualización de proxima_cobro.
  const r = decideEstadoFromProvider({ estadoLocal: "MOROSA", estadoProveedor: "MOROSA" });
  assert.equal(r.estado, "MOROSA");
  assert.equal(r.morosaPreservada, false);
});

test("aplicar dos veces el mismo evento da el mismo resultado", () => {
  const una = decideEstadoFromProvider({ estadoLocal: "MOROSA", estadoProveedor: "ACTIVA" });
  const dos = decideEstadoFromProvider({ estadoLocal: una.estado, estadoProveedor: "ACTIVA" });
  assert.deepEqual(dos, una, "la reconciliación tiene que converger, no oscilar");
});
