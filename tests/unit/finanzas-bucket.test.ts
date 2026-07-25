import assert from "node:assert/strict";
import test from "node:test";

import { fechaBucketPago } from "../../lib/db/finanzas";

// Review PR #118 · misatribución de ingresos entre meses: el fetcher filtra
// pagos por created_at ∈ rango pero bucketizaba por pagado_ts ?? created_at
// SIN guard — una deuda de mayo saldada en julio se sumaba al día equivocado
// de MAYO y nunca aparecía en julio. Semántica canónica: devengado por
// created_at; pagado_ts solo afina el día DENTRO del período.

// Rango: julio 2026 UTC [2026-07-01, 2026-08-01).
const START = new Date("2026-07-01T00:00:00.000Z").getTime();
const END = new Date("2026-08-01T00:00:00.000Z").getTime();

test("fechaBucketPago: pagado_ts dentro del rango → manda pagado_ts", () => {
  const pagado = "2026-07-15T14:30:00.000Z";
  const created = "2026-07-10T09:00:00.000Z";
  assert.equal(fechaBucketPago(pagado, created, START, END), pagado);
});

test("fechaBucketPago: sin pagado_ts → created_at (comportamiento histórico)", () => {
  const created = "2026-07-10T09:00:00.000Z";
  assert.equal(fechaBucketPago(null, created, START, END), created);
});

test("fechaBucketPago: pagado_ts ANTERIOR al rango → cae a created_at (deuda vieja saldada: no re-atribuir a mayo)", () => {
  // Caso del review: pago creado en julio (filtro created_at) con pagado_ts
  // de mayo — sin guard se sumaba a un día de mayo inexistente en el chart.
  const pagado = "2026-05-20T12:00:00.000Z";
  const created = "2026-07-08T16:00:00.000Z";
  assert.equal(fechaBucketPago(pagado, created, START, END), created);
});

test("fechaBucketPago: pagado_ts POSTERIOR al rango → cae a created_at", () => {
  const pagado = "2026-08-02T10:00:00.000Z";
  const created = "2026-07-30T10:00:00.000Z";
  assert.equal(fechaBucketPago(pagado, created, START, END), created);
});

test("fechaBucketPago: bounds half-open — startUtc incluido, endUtc excluido", () => {
  const created = "2026-07-10T09:00:00.000Z";
  const enStart = "2026-07-01T00:00:00.000Z";
  const enEnd = "2026-08-01T00:00:00.000Z";
  assert.equal(fechaBucketPago(enStart, created, START, END), enStart);
  assert.equal(fechaBucketPago(enEnd, created, START, END), created);
});

test("fechaBucketPago: pagado_ts no parseable → cae a created_at (nunca NaN)", () => {
  const created = "2026-07-10T09:00:00.000Z";
  assert.equal(fechaBucketPago("no-es-fecha", created, START, END), created);
});
