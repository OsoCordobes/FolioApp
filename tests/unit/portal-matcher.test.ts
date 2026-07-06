/**
 * Folio · unit tests del linkage matcher del portal (Fase 3 · P3).
 *
 * Prueba la LÓGICA PURA de `matchAccount` (sin DB, sin crypto): alta confianza
 * (DNI, o teléfono+email en la misma fila) vs ambiguo (sólo teléfono, sólo email,
 * o varios candidatos en una org → claim). Los booleans por-candidato simulan lo
 * que el orchestrator recomputa por org con los blind indexes salteados.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { matchAccount, type MatchCandidate } from "../../lib/portal/matcher";

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function candidate(over: Partial<MatchCandidate> & { pacienteId: string; organizationId: string }): MatchCandidate {
  return {
    dniMatch: false,
    telefonoMatch: false,
    emailMatch: false,
    ...over,
  };
}

// ─── Alta confianza → auto-link ──────────────────────────────────────────────

test("DNI exacto (único en la org) → auto-link con reason dni", () => {
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A, dniMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 1);
  assert.equal(out.claims.length, 0);
  assert.equal(out.autoLinks[0].pacienteId, "p1");
  assert.equal(out.autoLinks[0].reason, "dni");
});

test("teléfono + email en la misma fila (única en la org) → auto-link reason telefono_email", () => {
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A, telefonoMatch: true, emailMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 1);
  assert.equal(out.claims.length, 0);
  assert.equal(out.autoLinks[0].reason, "telefono_email");
});

test("DNI gana a teléfono+email en la elección de reason (DNI primero)", () => {
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A, dniMatch: true, telefonoMatch: true, emailMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 1);
  assert.equal(out.autoLinks[0].reason, "dni");
});

test("auto-link independiente por org (una fila de alta confianza en cada org)", () => {
  const out = matchAccount([
    candidate({ pacienteId: "pA", organizationId: ORG_A, dniMatch: true }),
    candidate({ pacienteId: "pB", organizationId: ORG_B, telefonoMatch: true, emailMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 2);
  assert.equal(out.claims.length, 0);
  const ids = out.autoLinks.map((a) => a.pacienteId).sort();
  assert.deepEqual(ids, ["pA", "pB"]);
});

// ─── Ambiguo → claim ─────────────────────────────────────────────────────────

test("sólo teléfono (sin email/DNI) → claim, NO auto-link", () => {
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A, telefonoMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 0);
  assert.equal(out.claims.length, 1);
  assert.deepEqual(out.claims[0].matched, { dni: false, telefono: true, email: false });
});

test("sólo email → claim, NO auto-link (email nunca alcanza el umbral)", () => {
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A, emailMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 0);
  assert.equal(out.claims.length, 1);
  assert.deepEqual(out.claims[0].matched, { dni: false, telefono: false, email: true });
});

test("DOS candidatos en la MISMA org (aunque uno sea alta confianza) → ambos a claim", () => {
  // Anti-impersonación: con ambigüedad intra-org NO arriesgamos linkear la ficha
  // equivocada; decide el clínico (P9).
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A, dniMatch: true }),
    candidate({ pacienteId: "p2", organizationId: ORG_A, emailMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 0);
  assert.equal(out.claims.length, 2);
  const ids = out.claims.map((c) => c.pacienteId).sort();
  assert.deepEqual(ids, ["p1", "p2"]);
});

test("candidato SIN ninguna coincidencia se descarta (ni link ni claim)", () => {
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A }),
  ]);
  assert.equal(out.autoLinks.length, 0);
  assert.equal(out.claims.length, 0);
});

test("mezcla: org A alta confianza (auto-link) + org B sólo teléfono (claim)", () => {
  const out = matchAccount([
    candidate({ pacienteId: "pA", organizationId: ORG_A, dniMatch: true }),
    candidate({ pacienteId: "pB", organizationId: ORG_B, telefonoMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 1);
  assert.equal(out.autoLinks[0].pacienteId, "pA");
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].pacienteId, "pB");
});

test("input vacío → outcome vacío", () => {
  const out = matchAccount([]);
  assert.equal(out.autoLinks.length, 0);
  assert.equal(out.claims.length, 0);
});

test("teléfono+email pero en filas DISTINTAS de la misma org → ambos a claim (no cruza filas)", () => {
  // El titular matchea teléfono en p1 y email en p2 (misma org): NO es "teléfono
  // + email en la misma fila" → no hay alta confianza; además son 2 candidatos en
  // la org → claim para ambos.
  const out = matchAccount([
    candidate({ pacienteId: "p1", organizationId: ORG_A, telefonoMatch: true }),
    candidate({ pacienteId: "p2", organizationId: ORG_A, emailMatch: true }),
  ]);
  assert.equal(out.autoLinks.length, 0);
  assert.equal(out.claims.length, 2);
});
