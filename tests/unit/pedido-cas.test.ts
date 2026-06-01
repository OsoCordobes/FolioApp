import assert from "node:assert/strict";
import test from "node:test";

import { decidePedidoCas } from "../../lib/db/pedidos";

// CR-7: compare-and-swap del estado del pedido. `decidePedidoCas` traduce el
// resultado del UPDATE guardado (filas afectadas + flag de error) a la
// decisión de control de flujo.

test("decidePedidoCas: error de DB → db_error", () => {
  assert.equal(decidePedidoCas(0, true), "db_error");
  assert.equal(decidePedidoCas(1, true), "db_error");
});

test("decidePedidoCas: 0 filas afectadas → conflict (otro acepte ganó)", () => {
  assert.equal(decidePedidoCas(0, false), "conflict");
});

test("decidePedidoCas: exactamente 1 fila → ok", () => {
  assert.equal(decidePedidoCas(1, false), "ok");
});

test("decidePedidoCas: más de 1 fila → ok (no debería pasar; id es PK)", () => {
  assert.equal(decidePedidoCas(2, false), "ok");
});

test("decidePedidoCas: error gana sobre filas (no procede aunque haya filas)", () => {
  // Si hubo error, nunca confiamos en rowsAffected.
  assert.notEqual(decidePedidoCas(1, true), "ok");
});
