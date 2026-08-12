import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_RECOVERY_PATH,
  computeAccessGate,
  GRACE_PERIOD_DAYS,
  isBillingRecoveryPath,
  shouldGateToBilling,
  type SuscripcionRow,
} from "../../lib/db/suscripcion";

const NOW = new Date("2026-06-01T12:00:00.000Z");

// Org creada hace mucho → grace period (GRACE_PERIOD_DAYS) ya vencido salvo que
// la suscripción diga otra cosa.
const ORG_OLD = "2026-01-01T00:00:00.000Z";

function sub(partial: Partial<SuscripcionRow>): SuscripcionRow {
  return {
    id: "sus-1",
    organizationId: "org-1",
    mpPreapprovalId: "pre-1",
    payerEmail: "a@b.com",
    montoCents: 3000000,
    moneda: "ARS",
    estado: "ACTIVA",
    fechaAlta: ORG_OLD,
    fechaActivacion: ORG_OLD,
    proximaCobro: null,
    ultimoCobroTs: null,
    ultimoError: null,
    fechaCancelacion: null,
    createdAt: ORG_OLD,
    updatedAt: ORG_OLD,
    ...partial,
  };
}

test("computeAccessGate: PAUSADA → blocked with subscription_paused (not morosa copy)", () => {
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "PAUSADA" }), NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "subscription_paused");
  assert.equal(gate.graceDaysLeft, null);
});

test("computeAccessGate: MOROSA with proxima_cobro in future → allowed (paid period)", () => {
  const future = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "MOROSA", proximaCobro: future }), NOW);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, null);
});

test("computeAccessGate: MOROSA past proxima_cobro + grace expired → morosa_expired", () => {
  const past = new Date(NOW.getTime() - 1000).toISOString();
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "MOROSA", proximaCobro: past }), NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "subscription_morosa_expired");
  assert.equal(gate.graceDaysLeft, 0);
});

test("computeAccessGate: ACTIVA → always allowed", () => {
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "ACTIVA" }), NOW);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, null);
});

test("computeAccessGate: CANCELADA + grace expired → subscription_cancelled", () => {
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "CANCELADA", proximaCobro: null }), NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "subscription_cancelled");
});

test("computeAccessGate: no subscription within grace → allowed with days left", () => {
  const recentOrg = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const gate = computeAccessGate(recentOrg, null, NOW);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, null);
  assert.equal(gate.graceDaysLeft, GRACE_PERIOD_DAYS - 2);
});

// ─── H-BILLING-1 · billing es la pantalla de recuperación ───────────────────
//
// El caso que motiva el fix: una org MOROSA con grace vencido queda con el gate
// BLOQUEADO. Si el layout la redirigiera a billing incluso estando YA en
// billing, sería un dead-end: el OWNER no podría refrescar/repagar/cancelar.
// `shouldGateToBilling` debe garantizar que billing siempre es alcanzable.

const BLOCKED_MOROSA: Pick<ReturnType<typeof computeAccessGate>, "allowed"> = { allowed: false };

test("shouldGateToBilling: MOROSA+vencido fuera de billing → redirige a billing", () => {
  // Sanity: el gate de una MOROSA con proxima_cobro pasada + grace vencido bloquea.
  const past = new Date(NOW.getTime() - 1000).toISOString();
  const gate = computeAccessGate(ORG_OLD, sub({ estado: "MOROSA", proximaCobro: past }), NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "subscription_morosa_expired");

  const redirect = shouldGateToBilling({
    isInternalAccount: false,
    accessGate: gate,
    pathname: "/hoy",
  });
  assert.equal(redirect, true);
});

test("shouldGateToBilling: MOROSA+vencido YA en billing → NO redirige (sin dead-end)", () => {
  const redirect = shouldGateToBilling({
    isInternalAccount: false,
    accessGate: BLOCKED_MOROSA,
    pathname: BILLING_RECOVERY_PATH,
  });
  assert.equal(redirect, false);
});

test("shouldGateToBilling: billing con query (?gate / ?activation) sigue siendo alcanzable", () => {
  for (const p of [
    `${BILLING_RECOVERY_PATH}?gate=subscription_morosa_expired`,
    `${BILLING_RECOVERY_PATH}?activation=ok`,
    `${BILLING_RECOVERY_PATH}/`,
    `${BILLING_RECOVERY_PATH}/cualquier-subruta`,
  ]) {
    assert.equal(
      shouldGateToBilling({ isInternalAccount: false, accessGate: BLOCKED_MOROSA, pathname: p }),
      false,
      `esperaba NO redirigir estando en ${p}`,
    );
  }
});

test("shouldGateToBilling: cualquier reason de bloqueo permite llegar a billing", () => {
  // CANCELADA, PAUSADA y grace_expired también deben poder recuperar.
  for (const estado of ["CANCELADA", "PAUSADA"] as const) {
    const gate = computeAccessGate(ORG_OLD, sub({ estado, proximaCobro: null }), NOW);
    assert.equal(gate.allowed, false);
    assert.equal(
      shouldGateToBilling({
        isInternalAccount: false,
        accessGate: gate,
        pathname: BILLING_RECOVERY_PATH,
      }),
      false,
    );
  }
  const graceExpired = computeAccessGate(ORG_OLD, null, NOW);
  assert.equal(graceExpired.reason, "grace_expired");
  assert.equal(
    shouldGateToBilling({
      isInternalAccount: false,
      accessGate: graceExpired,
      pathname: BILLING_RECOVERY_PATH,
    }),
    false,
  );
});

test("shouldGateToBilling: gate permitido → nunca redirige", () => {
  assert.equal(
    shouldGateToBilling({ isInternalAccount: false, accessGate: { allowed: true }, pathname: "/hoy" }),
    false,
  );
});

test("shouldGateToBilling: cuenta interna nunca se gatea aunque el gate bloquee", () => {
  assert.equal(
    shouldGateToBilling({ isInternalAccount: true, accessGate: BLOCKED_MOROSA, pathname: "/hoy" }),
    false,
  );
});

test("shouldGateToBilling: pathname ausente ('') → redirige a billing (destino correcto, no loop)", () => {
  // Si x-pathname no se pudo leer, tratamos como "no es billing" y mandamos a
  // billing — Next no re-redirige cuando origen y destino coinciden tras
  // resolver, así que no hay loop. El peor caso es un redirect de más, nunca un
  // dead-end de cobro.
  assert.equal(
    shouldGateToBilling({ isInternalAccount: false, accessGate: BLOCKED_MOROSA, pathname: "" }),
    true,
  );
});

test("isBillingRecoveryPath: matching robusto a query, hash y trailing slash", () => {
  assert.equal(isBillingRecoveryPath("/configuracion/billing"), true);
  assert.equal(isBillingRecoveryPath("/configuracion/billing/"), true);
  assert.equal(isBillingRecoveryPath("/configuracion/billing?activation=ok"), true);
  assert.equal(isBillingRecoveryPath("/configuracion/billing#x"), true);
  assert.equal(isBillingRecoveryPath("/configuracion/billing/sub"), true);
  // No debe matchear rutas vecinas que comparten prefijo textual.
  assert.equal(isBillingRecoveryPath("/configuracion/billingX"), false);
  assert.equal(isBillingRecoveryPath("/configuracion"), false);
  assert.equal(isBillingRecoveryPath("/hoy"), false);
  assert.equal(isBillingRecoveryPath(""), false);
});

// ─── C1 · los dos casos que expulsaban a un cliente que ya pagó ─────────────
//
// Ninguno de los dos es un bug del gate en sí: el gate hace lo correcto con los
// datos que recibe. Lo que fallaba era QUÉ datos le llegaban. Estos tests fijan
// el comportamiento del gate en esos dos escenarios para que un cambio futuro
// en `applySubscriptionUpdate` o en `getActiveContext` los vuelva a romper con
// un test rojo y no con un cliente afuera.

test("C1 · cancelar conserva el período pagado, salvo que se le borre proxima_cobro", () => {
  // El cliente cancela el día 5 de un ciclo mensual: le quedan ~25 días pagados.
  const pagadoHasta = "2026-06-26T00:00:00.000Z";
  const conservado = computeAccessGate(
    ORG_OLD,
    sub({ estado: "CANCELADA", proximaCobro: pagadoHasta }),
    NOW,
  );
  assert.equal(conservado.allowed, true, "cancelar no puede cortar el acceso ya pagado");

  // Lo que pasaba antes: MercadoPago deja de informar next_payment_date cuando
  // el preapproval queda `cancelled`, y applySubscriptionUpdate escribía ese
  // null encima. Con proxima_cobro en null el mismo cliente queda AFUERA en el
  // acto — y el paywall le dice que su prueba terminó.
  const borrado = computeAccessGate(ORG_OLD, sub({ estado: "CANCELADA", proximaCobro: null }), NOW);
  assert.equal(borrado.allowed, false);
  assert.equal(borrado.reason, "subscription_cancelled");
});

test("C1 · una fecha vieja de proxima_cobro no regala acceso", () => {
  // Contraparte del fix: dejar de pisar proxima_cobro no puede convertirse en
  // acceso eterno. El gate exige que sea futura.
  const vencido = computeAccessGate(
    ORG_OLD,
    sub({ estado: "CANCELADA", proximaCobro: "2026-05-01T00:00:00.000Z" }),
    NOW,
  );
  assert.equal(vencido.allowed, false);
  assert.equal(vencido.reason, "subscription_cancelled");
});

test("C1 · sin suscripción legible, el grace NO alcanza para una org vieja", () => {
  // Este es el motivo por el que getActiveContext no puede pasarle `null` al
  // gate cuando el lookup de suscripción FALLA: cae en la rama de grace de
  // GRACE_PERIOD_DAYS contados desde organization.created_at, así que cualquier
  // org de más de un mes —o sea, todo cliente real— queda bloqueada por un
  // hiccup transitorio de Supabase. El fail-open explícito vive en
  // lib/db/active-context.ts; esto documenta por qué es necesario.
  const gate = computeAccessGate(ORG_OLD, null, NOW);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "grace_expired");

  // Una org recién creada sí zafa por grace — por eso el bug era invisible en
  // desarrollo y en cuentas nuevas, y solo aparecía con clientes de verdad.
  const reciente = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(computeAccessGate(reciente, null, NOW).allowed, true);
});
