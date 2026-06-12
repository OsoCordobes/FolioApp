import assert from "node:assert/strict";
import test from "node:test";

import {
  GCAL_NUDGE_DISMISS_MS,
  decideGcalNudge,
  esIntegracionMuerta,
  gcalNudgeDismissKey,
  isInvalidGrantError,
  isNudgeDismissVigente,
  type GcalIntegracionSnapshot,
} from "../../lib/google/health";

const NOW = Date.parse("2026-06-12T12:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

const sana: GcalIntegracionSnapshot = {
  sinToken: false,
  ultimoError: null,
  ultimoErrorTs: null,
};

const muerta: GcalIntegracionSnapshot = {
  sinToken: false,
  ultimoError: "invalid_grant: Token has been expired or revoked.",
  ultimoErrorTs: "2026-06-10T08:00:00.000Z",
};

const errorTransitorio: GcalIntegracionSnapshot = {
  sinToken: false,
  ultimoError: "bloqueo upsert: timeout",
  ultimoErrorTs: "2026-06-12T08:00:00.000Z",
};

// ─── decideGcalNudge: matriz esColegiado × integración × dismiss ────────────

test("no colegiado → null siempre (sin integración, sana o muerta)", () => {
  for (const integracion of [null, sana, muerta]) {
    assert.equal(
      decideGcalNudge({ esColegiado: false, integracion, nowMs: NOW }),
      null,
    );
  }
});

test("colegiado sin integración → 'conectar'", () => {
  assert.equal(
    decideGcalNudge({ esColegiado: true, integracion: null, nowMs: NOW }),
    "conectar",
  );
});

test("colegiado con integración sana → null (no molestar)", () => {
  assert.equal(
    decideGcalNudge({ esColegiado: true, integracion: sana, nowMs: NOW }),
    null,
  );
});

test("colegiado con integración muerta (invalid_grant) → 'reconectar'", () => {
  assert.equal(
    decideGcalNudge({ esColegiado: true, integracion: muerta, nowMs: NOW }),
    "reconectar",
  );
});

test("error transitorio (no invalid_grant) → null: webhook/cron reintentan solos", () => {
  assert.equal(
    decideGcalNudge({ esColegiado: true, integracion: errorTransitorio, nowMs: NOW }),
    null,
  );
});

test("fila sin refresh token → 'reconectar' (integración inutilizable)", () => {
  assert.equal(
    decideGcalNudge({
      esColegiado: true,
      integracion: { ...sana, sinToken: true },
      nowMs: NOW,
    }),
    "reconectar",
  );
});

test("dismiss hace 3 días → null aunque corresponda mostrar", () => {
  const dismissedAtMs = NOW - 3 * DIA_MS;
  assert.equal(
    decideGcalNudge({ esColegiado: true, integracion: null, dismissedAtMs, nowMs: NOW }),
    null,
  );
  assert.equal(
    decideGcalNudge({ esColegiado: true, integracion: muerta, dismissedAtMs, nowMs: NOW }),
    null,
  );
});

test("dismiss vencido (hace 8 días) → vuelve a mostrar", () => {
  const dismissedAtMs = NOW - 8 * DIA_MS;
  assert.equal(
    decideGcalNudge({ esColegiado: true, integracion: null, dismissedAtMs, nowMs: NOW }),
    "conectar",
  );
});

test("dismiss justo en el borde de 7 días → vencido (ventana semiabierta)", () => {
  assert.equal(
    decideGcalNudge({
      esColegiado: true,
      integracion: null,
      dismissedAtMs: NOW - GCAL_NUDGE_DISMISS_MS,
      nowMs: NOW,
    }),
    "conectar",
  );
});

// ─── isNudgeDismissVigente: valores corruptos no silencian para siempre ─────

test("dismiss con timestamp futuro (corrupto) NO silencia", () => {
  assert.equal(isNudgeDismissVigente(NOW + DIA_MS, NOW), false);
});

test("dismiss null/undefined/NaN → no vigente", () => {
  assert.equal(isNudgeDismissVigente(null, NOW), false);
  assert.equal(isNudgeDismissVigente(undefined, NOW), false);
  assert.equal(isNudgeDismissVigente(Number.NaN, NOW), false);
});

// ─── esIntegracionMuerta ────────────────────────────────────────────────────

test("muerta: requiere ultimo_error_ts + invalid_grant en el texto", () => {
  assert.equal(esIntegracionMuerta(muerta), true);
  // invalid_grant viejo ya limpiado (ts null) → no muerta.
  assert.equal(
    esIntegracionMuerta({ ...muerta, ultimoErrorTs: null }),
    false,
  );
  assert.equal(esIntegracionMuerta(sana), false);
  assert.equal(esIntegracionMuerta(errorTransitorio), false);
});

test("muerta: matchea invalid_grant case-insensitive y en cualquier posición", () => {
  assert.equal(
    esIntegracionMuerta({
      sinToken: false,
      ultimoError: "GaxiosError: INVALID_GRANT",
      ultimoErrorTs: "2026-06-11T00:00:00.000Z",
    }),
    true,
  );
});

// ─── isInvalidGrantError: formas reales de googleapis ──────────────────────

test("isInvalidGrantError: Error con message 'invalid_grant'", () => {
  assert.equal(isInvalidGrantError(new Error("invalid_grant")), true);
});

test("isInvalidGrantError: mensaje envuelto por el caller", () => {
  assert.equal(
    isInvalidGrantError(new Error("turno query: invalid_grant: Token revoked")),
    true,
  );
});

test("isInvalidGrantError: GaxiosError-shaped con response.data.error", () => {
  const gaxios = Object.assign(new Error("request failed with status 400"), {
    response: { data: { error: "invalid_grant", error_description: "Bad Request" } },
  });
  assert.equal(isInvalidGrantError(gaxios), true);
});

test("isInvalidGrantError: errores ajenos → false", () => {
  assert.equal(isInvalidGrantError(new Error("ECONNRESET")), false);
  assert.equal(
    isInvalidGrantError(
      Object.assign(new Error("403"), { response: { data: { error: "rateLimitExceeded" } } }),
    ),
    false,
  );
  assert.equal(isInvalidGrantError(null), false);
  assert.equal(isInvalidGrantError(undefined), false);
  assert.equal(isInvalidGrantError(42), false);
});

test("isInvalidGrantError: string crudo con invalid_grant", () => {
  assert.equal(isInvalidGrantError("invalid_grant"), true);
});

// ─── gcalNudgeDismissKey: namespacing por member ────────────────────────────

test("la clave de dismiss es por member (dos profesionales no se pisan)", () => {
  const a = gcalNudgeDismissKey("member-a");
  const b = gcalNudgeDismissKey("member-b");
  assert.notEqual(a, b);
  assert.ok(a.includes("member-a"));
});
