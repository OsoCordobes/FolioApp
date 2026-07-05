/**
 * PR 4.1 · Idempotencia de los emails de lifecycle del webhook de MP.
 *
 * Escenario: MP reenvía el webhook `subscription_authorized_payment` del MISMO
 * cargo RECHAZADO (mismo mp_payment_id). Hay DOS candados encadenados que
 * garantizan que el email de "pago fallido" salga UNA sola vez:
 *
 *   1. recordChargeAttempt (lib/db/suscripcion.ts): la re-entrega choca la
 *      UNIQUE(mp_payment_id) → isNewCharge:false → el route ni siquiera arma el
 *      email (scheduleChargeLifecycleEmails corta en `!outcome.isNewCharge`).
 *      Ese candado ya está cubierto en tests/unit/suscripcion-charge.test.ts.
 *
 *   2. recordEmailOnce (lib/db/email-notificacion.ts): candado claim-before-send
 *      por `dedupe_key` (UNIQUE de M65). Es la RED DE SEGURIDAD del #1: aunque
 *      dos entregas se colaran como "nuevas" (carrera, o un camino que no mira
 *      isNewCharge), el 2do claim del MISMO `dedupe_key` devuelve inserted:false
 *      y `sendBillingLifecycleEmail` (notify.ts) NO envía.
 *
 * Este archivo cubre el candado #2 para el caso pago_fallido, que es donde vive
 * la garantía real de "un mp_payment_id rechazado = a lo sumo un email". Testeamos
 * `recordEmailOnce` con:
 *   - la MISMA `dedupe_key` que construye `notifyPagoFallido`
 *     (`pago-fallido:{orgId}:{mpPaymentId}`), para quedar acoplados a la clave real, y
 *   - un mock STATEFUL de `email_notificacion` que respeta la UNIQUE(dedupe_key):
 *     el 1er insert entra, el 2do tira 23505.
 *
 * `notifyPagoFallido` en sí llama a `createSupabaseServiceClient()` internamente
 * (no inyectable) y depende de sendEmail/organization — por eso no lo ejercemos
 * de punta a punta; validamos la clave que produce + el candado que consume.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { recordEmailOnce } from "../../lib/db/email-notificacion";

// ── Clave de dedupe: DEBE espejar la de notifyPagoFallido (lib/email/notify.ts).
// Si esa fórmula cambia, este helper (y el test) tienen que cambiar a propósito.
function pagoFallidoDedupeKey(organizationId: string, mpPaymentId: string): string {
  return `pago-fallido:${organizationId}:${mpPaymentId}`;
}

/**
 * Mock stateful de `email_notificacion` con la UNIQUE(dedupe_key) de M65:
 * cada dedupe_key entra una sola vez; el 2do insert de la misma clave devuelve
 * un error 23505 (lo que haría Postgres). Es exactamente el contrato que
 * recordEmailOnce traduce a inserted:true/false.
 */
function makeEmailNotificacionClient() {
  const claimed = new Set<string>();
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from: (_table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        const key = String(row.dedupe_key);
        if (claimed.has(key)) {
          return {
            error: {
              code: "23505",
              message: `duplicate key value violates unique constraint "email_notificacion_dedupe_key_key"`,
            },
          };
        }
        claimed.add(key);
        return { error: null };
      },
    }),
  } as unknown as Parameters<typeof recordEmailOnce>[1];
  return { client, inserts, claimed };
}

const ORG_ID = "org-1";
const MP_PAYMENT_ID = "mp-payment-rechazado-777";

function pagoFallidoInput() {
  return {
    dedupeKey: pagoFallidoDedupeKey(ORG_ID, MP_PAYMENT_ID),
    tipo: "pago_fallido",
    organizationId: ORG_ID,
    destinatario: "owner@consultorio.test",
    meta: { mp_payment_id: MP_PAYMENT_ID, monto_cents: 3_000_000 },
  };
}

// ── Núcleo del PR: re-entrega del mismo mp_payment_id rechazado ──────────────

test("re-entrega del mismo mp_payment_id rechazado → 2do claim inserted:false → NO se dispara segundo email", async () => {
  const { client, inserts } = makeEmailNotificacionClient();

  // 1ra entrega del webhook: claim gana → el caller ENVÍA el email.
  const first = await recordEmailOnce(pagoFallidoInput(), client);
  assert.ok(first.ok);
  assert.equal(first.data.inserted, true, "1er claim gana → notify* envía el email");

  // 2da entrega (MISMO mp_payment_id, misma dedupe_key): choca la UNIQUE.
  const second = await recordEmailOnce(pagoFallidoInput(), client);
  assert.ok(second.ok);
  assert.equal(
    second.data.inserted,
    false,
    "2do claim de la misma dedupe_key → inserted:false → sendBillingLifecycleEmail hace return sin enviar",
  );

  // Se INTENTARON dos claims (el candado corre en cada entrega), pero el estado
  // real quedó con un solo email reservado.
  assert.equal(inserts.length, 2, "el claim se intenta en cada re-entrega");
  assert.equal(
    inserts.filter((r) => r.dedupe_key === pagoFallidoDedupeKey(ORG_ID, MP_PAYMENT_ID)).length,
    2,
    "ambos intentos usan la MISMA dedupe_key derivada del mp_payment_id",
  );
});

test("la dedupe_key de pago_fallido depende del mp_payment_id: un cargo rechazado DISTINTO sí avisa", async () => {
  const { client } = makeEmailNotificacionClient();

  const primero = await recordEmailOnce(pagoFallidoInput(), client);
  assert.ok(primero.ok && primero.data.inserted, "primer rechazo avisa");

  // Otro intento de cobro fallido distinto (mp_payment_id nuevo) = episodio
  // distinto → dedupe_key distinta → SÍ debe poder avisar.
  const otroPayment = {
    ...pagoFallidoInput(),
    dedupeKey: pagoFallidoDedupeKey(ORG_ID, "mp-payment-rechazado-888"),
    meta: { mp_payment_id: "mp-payment-rechazado-888", monto_cents: 3_000_000 },
  };
  const segundo = await recordEmailOnce(otroPayment, client);
  assert.ok(segundo.ok);
  assert.equal(segundo.data.inserted, true, "un rechazo con OTRO mp_payment_id no comparte candado → avisa");
});

test("aislamiento por org: el mismo mp_payment_id en dos orgs no se pisa (org en la dedupe_key)", async () => {
  const { client } = makeEmailNotificacionClient();

  const orgA = await recordEmailOnce(pagoFallidoInput(), client);
  const orgB = await recordEmailOnce(
    { ...pagoFallidoInput(), organizationId: "org-2", dedupeKey: pagoFallidoDedupeKey("org-2", MP_PAYMENT_ID) },
    client,
  );

  assert.ok(orgA.ok && orgA.data.inserted);
  assert.ok(orgB.ok && orgB.data.inserted, "otra org con el mismo payment id no debe quedar bloqueada");
});

test("tercera y cuarta re-entrega del mismo cargo → siguen cortadas (idempotencia estable)", async () => {
  const { client } = makeEmailNotificacionClient();

  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(await recordEmailOnce(pagoFallidoInput(), client));
  }
  assert.ok(results.every((r) => r.ok));
  assert.equal((results[0] as { data: { inserted: boolean } }).data.inserted, true);
  assert.deepEqual(
    results.slice(1).map((r) => (r as { data: { inserted: boolean } }).data.inserted),
    [false, false, false],
    "todas las re-entregas posteriores a la 1ra quedan cortadas",
  );
});
