import assert from "node:assert/strict";
import test from "node:test";

import { capabilitiesFor } from "../../lib/auth/capabilities";
import { finanzasScopeMemberId } from "../../lib/auth/finanzas-scope";

// E1 · FIX LEAK: decisión pura de qué member.id se le pasa a getFinanzasDelMes.
// La matriz de permisos promete "Ver finanzas propias — solo los ingresos
// generados por uno mismo" para PROFESIONAL; sin este scope un médico veía
// las finanzas de TODA la clínica.

const MEMBER_ID = "3f2d1c4b-0000-4000-8000-000000000001";

test("OWNER ve toda la organización (sin filtro por profesional)", () => {
  assert.equal(finanzasScopeMemberId(capabilitiesFor("OWNER", true), MEMBER_ID), null);
});

test("DIRECTOR (colegiado o administrativo) ve toda la organización", () => {
  assert.equal(finanzasScopeMemberId(capabilitiesFor("DIRECTOR", true), MEMBER_ID), null);
  assert.equal(finanzasScopeMemberId(capabilitiesFor("DIRECTOR", false), MEMBER_ID), null);
});

test("PROFESIONAL queda scoped a su propio member.id (fix del leak)", () => {
  assert.equal(finanzasScopeMemberId(capabilitiesFor("PROFESIONAL", true), MEMBER_ID), MEMBER_ID);
});

test("ASISTENTE y COORDINADOR no tienen panel de finanzas — scope irrelevante", () => {
  // La page corta antes con notFound() (!canSeeFinanzas); el helper devuelve
  // null para no inventar un filtro que ningún fetch va a ejecutar.
  const asistente = capabilitiesFor("ASISTENTE", false);
  const coordinador = capabilitiesFor("COORDINADOR", false);
  assert.equal(asistente.canSeeFinanzas, false);
  assert.equal(coordinador.canSeeFinanzas, false);
  assert.equal(finanzasScopeMemberId(asistente, MEMBER_ID), null);
  assert.equal(finanzasScopeMemberId(coordinador, MEMBER_ID), null);
});

test("la decisión sale de canSeeFinanzasAll/Own, no del rol literal", () => {
  // Guard de regresión: si algún día un rol nuevo obtiene canSeeFinanzasOwn
  // sin canSeeFinanzasAll, el scope se aplica automáticamente.
  assert.equal(
    finanzasScopeMemberId({ canSeeFinanzasAll: false, canSeeFinanzasOwn: true }, MEMBER_ID),
    MEMBER_ID,
  );
  assert.equal(
    finanzasScopeMemberId({ canSeeFinanzasAll: true, canSeeFinanzasOwn: true }, MEMBER_ID),
    null,
  );
});
