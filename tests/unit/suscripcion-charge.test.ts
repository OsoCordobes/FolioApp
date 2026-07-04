/**
 * PR 1.2 · recordChargeAttempt — contrato extendido (ChargeAttemptOutcome).
 *
 * Fija la matriz de transición REAL contra el enum de M19
 * (PENDIENTE_ACTIVACION / ACTIVA / PAUSADA / CANCELADA / MOROSA) y el manejo
 * del episodio de morosidad (M65 · morosa_desde):
 *
 *   - APROBADO nuevo desde PENDIENTE_ACTIVACION o MOROSA → ACTIVA y cierra
 *     el episodio (morosa_desde = null en el MISMO update).
 *   - APROBADO nuevo desde ACTIVA/CANCELADA/PAUSADA → registra el cobro sin
 *     forzar estado (CR-4).
 *   - APROBADO con warning de monto → NO transiciona.
 *   - RECHAZADO nuevo → MOROSA; abre episodio (morosa_desde = now) SOLO si
 *     estaba null — rechazos subsiguientes no lo re-abren.
 *   - Re-entrega del mismo mp_payment_id (23505) → isNewCharge:false, CERO
 *     updates de suscripción, estadoDespues === estadoAntes.
 *   - UPDATE de suscripción que falla → la transición NO se reporta
 *     (estadoDespues === estadoAntes): jamás un email sobre una transición
 *     que no se persistió.
 *
 * El client se inyecta (patrón recordEmailOnce) con la superficie mínima que
 * usa la función.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { recordChargeAttempt, type EstadoSuscripcion } from "../../lib/db/suscripcion";
import type { ChargeAttemptInfo } from "../../lib/payments";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SOLO_CENTS = 3_000_000;
const EPISODIO = "2026-06-20T10:00:00.000Z";

function makeCharge(overrides: {
  status?: "PENDIENTE" | "APROBADO" | "RECHAZADO" | "REFUNDED";
  statusDetail?: string | null;
  amountCents?: number;
  sinPayment?: boolean;
} = {}): ChargeAttemptInfo {
  return {
    providerChargeId: "auth-1",
    providerSubscriptionId: "pre-1",
    amountCents: overrides.amountCents ?? SOLO_CENTS,
    currency: "ARS",
    attemptDate: "2026-07-01T12:00:00.000Z",
    payment: overrides.sinPayment
      ? null
      : {
          paymentId: "pay-1",
          status: overrides.status ?? "APROBADO",
          statusDetail: overrides.statusDetail ?? null,
        },
  };
}

function makeSusRow(overrides: Partial<{
  estado: EstadoSuscripcion;
  morosa_desde: string | null;
  monto_cents: number | null;
}> = {}) {
  return {
    id: "sus-1",
    organization_id: "org-1",
    payer_email: "owner@consultorio.test",
    estado: "PENDIENTE_ACTIVACION" as EstadoSuscripcion,
    monto_cents: SOLO_CENTS,
    morosa_desde: null as string | null,
    ...overrides,
  };
}

const CARGO_ROW = {
  id: "cargo-1",
  mp_payment_id: "pay-1",
  monto_cents: SOLO_CENTS,
  estado: "APROBADO",
  fecha_intento: "2026-07-01T12:00:00.000Z",
  fecha_acreditacion: "2026-07-01T12:00:01.000Z",
};

interface MockConfig {
  sus: Record<string, unknown> | null;
  susError?: { message: string } | null;
  insertError?: { code?: string | null; message?: string | null } | null;
  updateError?: { message: string } | null;
  cargoRow?: Record<string, unknown> | null;
}

/**
 * Mock con la superficie exacta que consume recordChargeAttempt:
 *   suscripcion:       .select().eq().maybeSingle() / .update().eq()
 *   cargo_suscripcion: .insert().select().maybeSingle() / .select().eq().single()
 */
function makeMockClient(cfg: MockConfig) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];

  const client = {
    from(table: string) {
      if (table === "suscripcion") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: cfg.sus, error: cfg.susError ?? null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(patch);
              return { error: cfg.updateError ?? null };
            },
          }),
        };
      }
      // cargo_suscripcion
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: async () => {
              inserts.push(row);
              return cfg.insertError
                ? { data: null, error: cfg.insertError }
                : { data: { id: "cargo-1" }, error: null };
            },
          }),
        }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: cfg.cargoRow ?? CARGO_ROW, error: null }),
          }),
        }),
      };
    },
  } as unknown as NonNullable<Parameters<typeof recordChargeAttempt>[1]>;

  return { client, updates, inserts };
}

async function run(cfg: MockConfig, charge: ChargeAttemptInfo) {
  const { client, updates, inserts } = makeMockClient(cfg);
  const res = await recordChargeAttempt({ charge, rawPayload: { test: true } }, client);
  return { res, updates, inserts };
}

// ─── APROBADO: activación y recuperación ─────────────────────────────────────

test("APROBADO nuevo desde PENDIENTE_ACTIVACION → ACTIVA + morosa_desde limpiado + contexto completo", async () => {
  const { res, updates } = await run({ sus: makeSusRow() }, makeCharge());

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, true);
  assert.equal(res.data.estadoAntes, "PENDIENTE_ACTIVACION");
  assert.equal(res.data.estadoDespues, "ACTIVA");
  assert.equal(res.data.organizationId, "org-1");
  assert.equal(res.data.payerEmail, "owner@consultorio.test");
  assert.equal(res.data.montoMensualCents, SOLO_CENTS);
  assert.equal(res.data.mpPreapprovalId, "pre-1");
  assert.equal(res.data.morosaDesdeAntes, null);
  assert.equal(res.data.cargo?.mpPaymentId, "pay-1");

  assert.equal(updates.length, 1);
  assert.equal(updates[0].estado, "ACTIVA");
  assert.equal(updates[0].ultimo_error, null);
  // El MISMO update que activa cierra el episodio (aunque acá no había).
  assert.ok("morosa_desde" in updates[0]);
  assert.equal(updates[0].morosa_desde, null);
});

test("APROBADO nuevo desde MOROSA → ACTIVA, cierra el episodio y reporta morosaDesdeAntes", async () => {
  const { res, updates } = await run(
    { sus: makeSusRow({ estado: "MOROSA", morosa_desde: EPISODIO }) },
    makeCharge(),
  );

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, true);
  assert.equal(res.data.estadoAntes, "MOROSA");
  assert.equal(res.data.estadoDespues, "ACTIVA");
  // El episodio que se cierra queda expuesto para el dedupe del email de
  // reactivación (notifySuscripcionReactivada).
  assert.equal(res.data.morosaDesdeAntes, EPISODIO);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].estado, "ACTIVA");
  assert.equal(updates[0].morosa_desde, null);
});

test("APROBADO nuevo con la suscripción ya ACTIVA → registra cobro sin transición", async () => {
  const { res, updates } = await run({ sus: makeSusRow({ estado: "ACTIVA" }) }, makeCharge());

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, true);
  assert.equal(res.data.estadoAntes, "ACTIVA");
  assert.equal(res.data.estadoDespues, "ACTIVA");

  assert.equal(updates.length, 1);
  assert.equal("estado" in updates[0], false, "no debe forzar estado");
  assert.equal("morosa_desde" in updates[0], false, "no debe tocar el episodio");
  assert.equal(updates[0].ultimo_error, null);
});

test("APROBADO nuevo desde CANCELADA/PAUSADA → NO resucita la suscripción (CR-4)", async () => {
  for (const estado of ["CANCELADA", "PAUSADA"] as const) {
    const { res, updates } = await run({ sus: makeSusRow({ estado }) }, makeCharge());

    assert.ok(res.ok);
    assert.equal(res.data.estadoAntes, estado);
    assert.equal(res.data.estadoDespues, estado, `${estado} no debe pasar a ACTIVA`);
    assert.equal("estado" in updates[0], false);
  }
});

test("APROBADO con warning de monto → NO transiciona (queda para revisión manual)", async () => {
  const { res, updates } = await run(
    { sus: makeSusRow({ estado: "MOROSA", morosa_desde: EPISODIO }) },
    makeCharge({ amountCents: 1_000_000 }), // debitaron un monto inesperado
  );

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, true);
  assert.equal(res.data.estadoAntes, "MOROSA");
  assert.equal(res.data.estadoDespues, "MOROSA", "el warning bloquea la recuperación");

  assert.equal(updates.length, 1);
  assert.equal("estado" in updates[0], false);
  assert.equal("morosa_desde" in updates[0], false, "el episodio sigue abierto");
  assert.match(String(updates[0].ultimo_error), /Monto inesperado/);
});

// ─── RECHAZADO: episodio de morosidad ────────────────────────────────────────

test("RECHAZADO nuevo con morosa_desde null → MOROSA y abre episodio (morosa_desde = now)", async () => {
  const before = Date.now();
  const { res, updates } = await run(
    { sus: makeSusRow({ estado: "ACTIVA", morosa_desde: null }) },
    makeCharge({ status: "RECHAZADO", statusDetail: "cc_rejected_insufficient_amount" }),
  );
  const after = Date.now();

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, true);
  assert.equal(res.data.estadoAntes, "ACTIVA");
  assert.equal(res.data.estadoDespues, "MOROSA");
  assert.equal(res.data.morosaDesdeAntes, null);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].estado, "MOROSA");
  assert.equal(updates[0].ultimo_error, "cc_rejected_insufficient_amount");
  const morosaDesde = new Date(String(updates[0].morosa_desde)).getTime();
  assert.ok(
    morosaDesde >= before && morosaDesde <= after,
    "morosa_desde debe ser now() del momento de la transición",
  );
});

test("RECHAZADO nuevo con episodio YA abierto → NO re-abre (morosa_desde intacto)", async () => {
  const { res, updates } = await run(
    { sus: makeSusRow({ estado: "MOROSA", morosa_desde: EPISODIO }) },
    makeCharge({ status: "RECHAZADO" }),
  );

  assert.ok(res.ok);
  assert.equal(res.data.estadoAntes, "MOROSA");
  assert.equal(res.data.estadoDespues, "MOROSA");
  assert.equal(res.data.morosaDesdeAntes, EPISODIO);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].estado, "MOROSA");
  assert.equal(
    "morosa_desde" in updates[0],
    false,
    "un rechazo subsiguiente no debe pisar el inicio del episodio (dedupe estable)",
  );
});

test("RECHAZADO sin statusDetail → ultimo_error con fallback humano", async () => {
  const { updates } = await run(
    { sus: makeSusRow({ estado: "ACTIVA" }) },
    makeCharge({ status: "RECHAZADO", statusDetail: null }),
  );
  assert.equal(updates[0].ultimo_error, "Cobro rechazado por Mercado Pago.");
});

// ─── Idempotencia: re-entrega del mismo mp_payment_id ────────────────────────

test("re-entrega (23505) → isNewCharge:false, CERO mutaciones, estado intacto", async () => {
  const { res, updates, inserts } = await run(
    {
      sus: makeSusRow({ estado: "ACTIVA" }),
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    },
    makeCharge({ status: "RECHAZADO" }), // un rejected reenviado NO debe tirar a MOROSA
  );

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, false);
  assert.equal(res.data.estadoAntes, "ACTIVA");
  assert.equal(res.data.estadoDespues, "ACTIVA");
  assert.equal(inserts.length, 1, "el INSERT se intenta (la UNIQUE lo rechaza)");
  assert.equal(updates.length, 0, "una re-entrega jamás muta la suscripción");
  // La fila existente se devuelve igual (para el caller que quiera loguearla).
  assert.equal(res.data.cargo?.mpPaymentId, "pay-1");
});

test("re-entrega detectada por mensaje sin code (fallback M5) → también no-op", async () => {
  const { res, updates } = await run(
    {
      sus: makeSusRow({ estado: "MOROSA", morosa_desde: EPISODIO }),
      insertError: { code: null, message: "duplicate key value violates..." },
    },
    makeCharge(),
  );

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, false);
  assert.equal(res.data.estadoDespues, "MOROSA", "un approved reenviado no recupera");
  assert.equal(updates.length, 0);
});

// ─── Bordes ──────────────────────────────────────────────────────────────────

test("intento sin payment (scheduled) → cargo null, sin INSERT ni updates", async () => {
  const { res, updates, inserts } = await run(
    { sus: makeSusRow({ estado: "ACTIVA" }) },
    makeCharge({ sinPayment: true }),
  );

  assert.ok(res.ok);
  assert.equal(res.data.cargo, null);
  assert.equal(res.data.isNewCharge, false);
  assert.equal(res.data.estadoAntes, "ACTIVA");
  assert.equal(res.data.estadoDespues, "ACTIVA");
  assert.equal(inserts.length, 0);
  assert.equal(updates.length, 0);
});

test("suscripción no linkeada aún → err(not_found) para que el route devuelva 5xx (M-BILL-1)", async () => {
  const { res } = await run({ sus: null }, makeCharge());
  assert.ok(!res.ok);
  assert.equal(res.error.code, "not_found");
});

test("error de DB en el SELECT de suscripción → err(db_error)", async () => {
  const { res } = await run(
    { sus: null, susError: { message: "connection reset" } },
    makeCharge(),
  );
  assert.ok(!res.ok);
  assert.equal(res.error.code, "db_error");
});

test("error de INSERT que NO es 23505 → err(db_error), MP reintenta", async () => {
  const { res, updates } = await run(
    {
      sus: makeSusRow(),
      insertError: { code: "23503", message: "violates foreign key constraint" },
    },
    makeCharge(),
  );
  assert.ok(!res.ok);
  assert.equal(res.error.code, "db_error");
  assert.equal(updates.length, 0, "sin cargo registrado no se muta estado");
});

test("UPDATE de la transición falla → estadoDespues NO reporta la transición", async () => {
  const { res } = await run(
    {
      sus: makeSusRow({ estado: "MOROSA", morosa_desde: EPISODIO }),
      updateError: { message: "connection reset" },
    },
    makeCharge(),
  );

  assert.ok(res.ok);
  assert.equal(res.data.isNewCharge, true, "el cargo quedó registrado");
  assert.equal(res.data.estadoAntes, "MOROSA");
  assert.equal(
    res.data.estadoDespues,
    "MOROSA",
    "una transición que no se persistió no debe disparar email de reactivación",
  );
});
