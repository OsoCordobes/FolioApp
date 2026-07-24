/**
 * PR 1.2 · decideLifecycleEmails — decisión pura de emails de lifecycle.
 *
 * Fija el contrato de lib/billing/lifecycle.ts, rama por rama:
 *
 *   (a) trial_por_vencer SOLO en graceDaysLeft ∈ {3,1} y sin suscripción
 *       activa, dedupe `trial-por-vencer:{org}:{n}d` (idéntica a la key
 *       interna de notifyTrialPorVencer).
 *   (b) suscripcion_suspendida SOLO con gate bloqueado por
 *       subscription_morosa_expired, dedupe por episodio (morosa_desde, con
 *       fallback a la fecha de corte del gate para filas pre-M65).
 *   (c) internas → NUNCA nada, aunque el resto del snapshot califique.
 *   (d) los otros reasons de bloqueo (grace_expired / cancelled / paused) NO
 *       mandan "suspendida" (copy de morosidad; decisión documentada).
 *   (e) sin escalation MOROSA→CANCELADA (backlog: MP cancela solo).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  decideLifecycleEmails,
  TRIAL_AVISO_UMBRALES_DIAS,
  type LifecycleOrgSnapshot,
} from "../../lib/billing/lifecycle";

const ORG = "org-1";
const EPISODIO = "2026-06-20T10:00:00.000Z";
const CORTE = "2026-06-27T10:00:00.000Z";

function snapshot(overrides: Partial<LifecycleOrgSnapshot> = {}): LifecycleOrgSnapshot {
  return {
    organizationId: ORG,
    isInternalAccount: false,
    gate: { allowed: true, reason: null, graceDaysLeft: null },
    estadoSuscripcion: null,
    morosaDesdeIso: null,
    corteFallbackIso: null,
    ...overrides,
  };
}

// ─── (a) trial_por_vencer ────────────────────────────────────────────────────

test("trial: graceDaysLeft=3 sin suscripción → un email 3d con dedupe estable", () => {
  const emails = decideLifecycleEmails(
    snapshot({ gate: { allowed: true, reason: null, graceDaysLeft: 3 } }),
  );
  assert.deepEqual(emails, [
    { tipo: "trial_por_vencer", dedupeKey: `trial-por-vencer:${ORG}:3d`, diasRestantes: 3 },
  ]);
});

test("trial: graceDaysLeft=1 → un email 1d", () => {
  const emails = decideLifecycleEmails(
    snapshot({ gate: { allowed: true, reason: null, graceDaysLeft: 1 } }),
  );
  assert.deepEqual(emails, [
    { tipo: "trial_por_vencer", dedupeKey: `trial-por-vencer:${ORG}:1d`, diasRestantes: 1 },
  ]);
});

test("trial: graceDaysLeft=7 → un email 7d (primer aviso del grace de 30)", () => {
  const emails = decideLifecycleEmails(
    snapshot({ gate: { allowed: true, reason: null, graceDaysLeft: 7 } }),
  );
  assert.deepEqual(emails, [
    { tipo: "trial_por_vencer", dedupeKey: `trial-por-vencer:${ORG}:7d`, diasRestantes: 7 },
  ]);
});

test("trial: los umbrales exportados son exactamente {7,3,1}", () => {
  assert.deepEqual([...TRIAL_AVISO_UMBRALES_DIAS], [7, 3, 1]);
});

test("trial: cualquier otro graceDaysLeft (30/14/5/4/2/0/null) → nada", () => {
  for (const dias of [30, 14, 5, 4, 2, 0, null]) {
    const emails = decideLifecycleEmails(
      snapshot({ gate: { allowed: true, reason: null, graceDaysLeft: dias } }),
    );
    assert.deepEqual(emails, [], `graceDaysLeft=${dias} no debe mandar nada`);
  }
});

test("trial: con suscripción PENDIENTE_ACTIVACION en grace 3 → SÍ manda (checkout a medias)", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: true, reason: null, graceDaysLeft: 3 },
      estadoSuscripcion: "PENDIENTE_ACTIVACION",
    }),
  );
  assert.equal(emails.length, 1);
  assert.equal(emails[0].tipo, "trial_por_vencer");
});

test("trial: suscripción ACTIVA → nada, aunque el snapshot traiga graceDaysLeft (inconsistente)", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: true, reason: null, graceDaysLeft: 3 },
      estadoSuscripcion: "ACTIVA",
    }),
  );
  assert.deepEqual(emails, []);
});

// ─── (b) suscripcion_suspendida ──────────────────────────────────────────────

test("suspendida: bloqueado por morosa_expired con morosa_desde → email con episodio", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: false, reason: "subscription_morosa_expired", graceDaysLeft: 0 },
      estadoSuscripcion: "MOROSA",
      morosaDesdeIso: EPISODIO,
      corteFallbackIso: CORTE,
    }),
  );
  assert.deepEqual(emails, [
    {
      tipo: "suscripcion_suspendida",
      dedupeKey: `suscripcion-suspendida:${ORG}:${EPISODIO}`,
      episodioIso: EPISODIO,
    },
  ]);
});

test("suspendida: sin morosa_desde (episodio pre-M65) → usa la fecha de corte del gate", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: false, reason: "subscription_morosa_expired", graceDaysLeft: 0 },
      estadoSuscripcion: "MOROSA",
      morosaDesdeIso: null,
      corteFallbackIso: CORTE,
    }),
  );
  assert.deepEqual(emails, [
    {
      tipo: "suscripcion_suspendida",
      dedupeKey: `suscripcion-suspendida:${ORG}:${CORTE}`,
      episodioIso: CORTE,
    },
  ]);
});

test("suspendida: sin discriminador estable (ni morosa_desde ni corte) → nada (no spamear)", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: false, reason: "subscription_morosa_expired", graceDaysLeft: 0 },
      estadoSuscripcion: "MOROSA",
      morosaDesdeIso: null,
      corteFallbackIso: null,
    }),
  );
  assert.deepEqual(emails, []);
});

test("suspendida: MOROSA con gate todavía permitido (periodo pagado) → nada", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: true, reason: null, graceDaysLeft: null },
      estadoSuscripcion: "MOROSA",
      morosaDesdeIso: EPISODIO,
      corteFallbackIso: CORTE,
    }),
  );
  assert.deepEqual(emails, []);
});

// ─── (d) otros reasons de bloqueo NO mandan suspendida ───────────────────────

test("bloqueado por grace_expired (nunca se suscribió) → nada", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: false, reason: "grace_expired", graceDaysLeft: 0 },
      estadoSuscripcion: null,
      corteFallbackIso: CORTE,
    }),
  );
  assert.deepEqual(emails, []);
});

test("bloqueado por subscription_cancelled (cancelación deliberada) → nada", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: false, reason: "subscription_cancelled", graceDaysLeft: 0 },
      estadoSuscripcion: "CANCELADA",
      morosaDesdeIso: EPISODIO,
      corteFallbackIso: CORTE,
    }),
  );
  assert.deepEqual(emails, []);
});

test("bloqueado por subscription_paused (pausa deliberada) → nada", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: false, reason: "subscription_paused", graceDaysLeft: null },
      estadoSuscripcion: "PAUSADA",
      corteFallbackIso: CORTE,
    }),
  );
  assert.deepEqual(emails, []);
});

// ─── (c) internas ────────────────────────────────────────────────────────────

test("interna: NUNCA recibe nada, aunque el snapshot califique para trial o suspendida", () => {
  const trial = decideLifecycleEmails(
    snapshot({
      isInternalAccount: true,
      gate: { allowed: true, reason: null, graceDaysLeft: 3 },
    }),
  );
  assert.deepEqual(trial, []);

  const suspendida = decideLifecycleEmails(
    snapshot({
      isInternalAccount: true,
      gate: { allowed: false, reason: "subscription_morosa_expired", graceDaysLeft: 0 },
      estadoSuscripcion: "MOROSA",
      morosaDesdeIso: EPISODIO,
    }),
  );
  assert.deepEqual(suspendida, []);
});

// ─── Neutros ─────────────────────────────────────────────────────────────────

test("org sin nada que avisar (allowed, sin grace, sin suscripción) → lista vacía", () => {
  assert.deepEqual(decideLifecycleEmails(snapshot()), []);
});

test("suscripción ACTIVA con gate permitido → lista vacía", () => {
  const emails = decideLifecycleEmails(
    snapshot({
      gate: { allowed: true, reason: null, graceDaysLeft: null },
      estadoSuscripcion: "ACTIVA",
    }),
  );
  assert.deepEqual(emails, []);
});
