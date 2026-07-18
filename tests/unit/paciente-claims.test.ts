import assert from "node:assert/strict";
import test from "node:test";

import { maskDocumento, puedeResolverClaims } from "../../lib/db/paciente-claims";

// ═══════════════════════════════════════════════════════════════════════════════
// Folio · P9 · aprobación de claims de vinculación (lado clínico) — helpers puros
//
// El GATE ANTI-IMPERSONACIÓN real (CAS atómico + "cuenta_id sólo si NULL" + validación
// de can_read_clinical por auth.uid()) vive en el RPC SECURITY DEFINER
// resolver_paciente_claim (M87) y se verifica contra Postgres (no acá). Estos tests
// cubren la copia PURA de este data layer:
//   1. puedeResolverClaims — el gate APP de rol clínico. DEBE espejar EXACTAMENTE
//      public.can_read_clinical (M01): OWNER + PROFESIONAL + DIRECTOR colegiado, y
//      NADIE más. Si esto diverge de la RLS, un rol no-clínico vería la cola (aunque
//      la página + el RPC igual lo frenen). Fijamos la equivalencia acá.
//   2. maskDocumento — no volcar el DNI completo del paciente en el listado de la cola.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── puedeResolverClaims · espejo de can_read_clinical (M01) ──────────────────

test("puedeResolverClaims: OWNER siempre puede (colegiado o no)", () => {
  assert.equal(puedeResolverClaims("OWNER", true), true);
  assert.equal(puedeResolverClaims("OWNER", false), true);
});

test("puedeResolverClaims: PROFESIONAL siempre puede (colegiado o no)", () => {
  assert.equal(puedeResolverClaims("PROFESIONAL", true), true);
  assert.equal(puedeResolverClaims("PROFESIONAL", false), true);
});

test("puedeResolverClaims: DIRECTOR SÓLO si es colegiado (igual que can_read_clinical)", () => {
  assert.equal(puedeResolverClaims("DIRECTOR", true), true);
  assert.equal(puedeResolverClaims("DIRECTOR", false), false);
});

test("puedeResolverClaims: COORDINADOR y ASISTENTE NUNCA pueden (no leen clínico)", () => {
  assert.equal(puedeResolverClaims("COORDINADOR", true), false);
  assert.equal(puedeResolverClaims("COORDINADOR", false), false);
  assert.equal(puedeResolverClaims("ASISTENTE", true), false);
  assert.equal(puedeResolverClaims("ASISTENTE", false), false);
});

test("puedeResolverClaims: la matriz completa coincide con can_read_clinical", () => {
  // Verdad de referencia: can_read_clinical = OWNER + PROFESIONAL + (DIRECTOR ∧ colegiado).
  const canReadClinical = (role: string, cole: boolean): boolean =>
    role === "OWNER" || role === "PROFESIONAL" || (role === "DIRECTOR" && cole);

  const roles = ["OWNER", "DIRECTOR", "PROFESIONAL", "COORDINADOR", "ASISTENTE"] as const;
  for (const role of roles) {
    for (const cole of [true, false]) {
      assert.equal(
        puedeResolverClaims(role, cole),
        canReadClinical(role, cole),
        `divergencia en ${role}/${cole ? "colegiado" : "no-colegiado"}`,
      );
    }
  }
});

// ─── maskDocumento · no exponer el DNI completo en la cola ────────────────────

test("maskDocumento: DNI típico deja sólo los últimos 4 visibles", () => {
  assert.equal(maskDocumento("12345678"), "••••5678");
});

test("maskDocumento: null / vacío → placeholder", () => {
  assert.equal(maskDocumento(null), "—");
  assert.equal(maskDocumento(""), "—");
});

test("maskDocumento: documento corto (<=4) se enmascara entero (no revela nada)", () => {
  assert.equal(maskDocumento("123"), "•••");
  assert.equal(maskDocumento("1234"), "••••");
});

test("maskDocumento: recorta espacios antes de enmascarar", () => {
  assert.equal(maskDocumento("  12345678  "), "••••5678");
});

test("maskDocumento: documento largo (pasaporte) mantiene sólo 4 finales", () => {
  assert.equal(maskDocumento("AB1234567"), "•••••4567");
});
