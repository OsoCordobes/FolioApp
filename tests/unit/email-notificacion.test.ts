/**
 * M65 · recordEmailOnce — candado claim-before-send de emails de lifecycle.
 *
 * Contrato (lib/db/email-notificacion.ts):
 *   - INSERT ok          → ok({ inserted: true })   → el caller envía.
 *   - 23505 (dedupe)     → ok({ inserted: false })  → skip silencioso.
 *   - otro error de DB   → err(db_error)            → el caller NO envía.
 *
 * El client se inyecta (patrón findUserByEmail) — acá se mockea la superficie
 * mínima `.from().insert()`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { recordEmailOnce } from "../../lib/db/email-notificacion";

type MockError = { code?: string | null; message?: string | null } | null;

function makeMockClient(insertError: MockError) {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        calls.push({ table, row });
        return { error: insertError };
      },
    }),
  } as unknown as Parameters<typeof recordEmailOnce>[1];
  return { client, calls };
}

const INPUT = {
  dedupeKey: "pago-fallido:org-1:payment-99",
  tipo: "pago_fallido",
  organizationId: "org-1",
  destinatario: "owner@consultorio.test",
  meta: { monto_cents: 3_000_000 },
};

test("insert ok → inserted: true y el payload mapea a las columnas de M65", async () => {
  const { client, calls } = makeMockClient(null);
  const res = await recordEmailOnce(INPUT, client);

  assert.ok(res.ok);
  assert.deepEqual(res.data, { inserted: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "email_notificacion");
  assert.deepEqual(calls[0].row, {
    organization_id: "org-1",
    tipo: "pago_fallido",
    dedupe_key: "pago-fallido:org-1:payment-99",
    destinatario: "owner@consultorio.test",
    meta: { monto_cents: 3_000_000 },
  });
});

test("23505 (dedupe_key ya claimeada) → ok con inserted: false, no err", async () => {
  const { client } = makeMockClient({
    code: "23505",
    message: 'duplicate key value violates unique constraint "email_notificacion_dedupe_key_key"',
  });
  const res = await recordEmailOnce(INPUT, client);

  assert.ok(res.ok);
  assert.deepEqual(res.data, { inserted: false });
});

test("detección de duplicado por mensaje cuando el driver no propaga code (fallback M5)", async () => {
  const { client } = makeMockClient({ code: null, message: "duplicate key value violates..." });
  const res = await recordEmailOnce(INPUT, client);

  assert.ok(res.ok);
  assert.deepEqual(res.data, { inserted: false });
});

test("otro error de DB → err(db_error) con detail (el caller NO envía)", async () => {
  const { client } = makeMockClient({ code: "23503", message: "violates foreign key constraint" });
  const res = await recordEmailOnce(INPUT, client);

  assert.ok(!res.ok);
  assert.equal(res.error.code, "db_error");
  assert.equal(res.error.detail, "violates foreign key constraint");
});

test("meta ausente → se persiste null (columna jsonb nullable)", async () => {
  const { client, calls } = makeMockClient(null);
  const { meta: _meta, ...sinMeta } = INPUT;
  const res = await recordEmailOnce(sinMeta, client);

  assert.ok(res.ok);
  assert.equal(calls[0].row.meta, null);
});
