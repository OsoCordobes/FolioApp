import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAVES_PROHIBIDAS_RESUMEN,
  esTurnoPasado,
  resumenTieneClaveProhibida,
  type PortalConsentimientoView,
  type PortalResumenView,
  type PortalTurnoPasadoView,
} from "../../lib/db/portal-resumen";

// ═══════════════════════════════════════════════════════════════════════════════
// Folio · P5 · resumen clínico curado del portal — whitelist + clasificador puro
//
// El resumen del paciente es un WHITELIST de lo que puede ver (turnos pasados +
// consentimientos firmados), NUNCA un filtro sobre el SOAP. El paciente no tiene
// grant a `sesion` (M71) ⇒ la sobre-exposición es imposible por construcción. Estos
// tests fijan, sin mockear Supabase:
//   1. El shape servido al portal NO contiene NINGUNA clave SOAP/tool_data/riesgo
//      ni de firma/audit (resumenTieneClaveProhibida sobre un DTO representativo).
//   2. El clasificador esTurnoPasado sólo cuenta como "historia de atención" lo que
//      ya ocurrió (no un turno futuro vivo).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── resumenTieneClaveProhibida · backstop del whitelist ─────────────────────

test("la salida representativa del resumen NO tiene ninguna clave SOAP/riesgo/firma", () => {
  const turno: PortalTurnoPasadoView = {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizacionNombre: "Consultorio Demo",
    inicio: "2026-06-01T14:00:00-03:00",
    duracionMin: 45,
    estado: "CERRADO",
    modalidad: "presencial",
  };
  const consentimiento: PortalConsentimientoView = {
    id: "22222222-2222-4222-8222-222222222222",
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizacionNombre: "Consultorio Demo",
    tipo: "TELEMEDICINA",
    tipoLabel: "Telemedicina",
    firmadoEn: "2026-05-20T10:00:00-03:00",
    revocadoEn: null,
    plantillaTitulo: "Consentimiento para atención por telemedicina",
    plantillaVersion: 1,
  };
  const resumen: PortalResumenView = {
    turnosPasados: [turno],
    consentimientos: [consentimiento],
  };

  const hit = resumenTieneClaveProhibida(resumen);
  assert.equal(hit, null, `clave prohibida encontrada en el resumen: ${hit}`);
});

test("un shape contaminado con SOAP es DETECTADO (el guard realmente escanea)", () => {
  // Si un cambio futuro filtrara de más (p. ej. un embed de `sesion`), el guard
  // debe delatarlo. Este test asegura que resumenTieneClaveProhibida no es un no-op.
  const contaminado = {
    turnosPasados: [
      { id: "x", inicio: "2026-06-01T14:00:00-03:00", soap: "paciente refiere..." },
    ],
    consentimientos: [],
  };
  const hit = resumenTieneClaveProhibida(contaminado);
  assert.equal(hit, "soap");
});

test("detecta claves de riesgo anidadas en profundidad", () => {
  const contaminado = {
    turnosPasados: [
      { id: "x", nested: { deeper: { riesgo_suicida: true } } },
    ],
  };
  const hit = resumenTieneClaveProhibida(contaminado);
  assert.equal(hit, "riesgo_suicida");
});

test("detecta tool_data y firma_storage_path (columnas nunca expuestas al portal)", () => {
  assert.equal(resumenTieneClaveProhibida({ tool_data_cifrado: "..." }), "tool_data_cifrado");
  assert.equal(resumenTieneClaveProhibida({ firma_storage_path: "consentimientos-firmados/x/y/z.png" }), "firma_storage_path");
  assert.equal(resumenTieneClaveProhibida({ ip: "1.2.3.4" }), "ip");
  assert.equal(resumenTieneClaveProhibida({ user_agent: "Mozilla/5.0" }), "user_agent");
});

test("la comparación de claves prohibidas es case-insensitive", () => {
  assert.equal(resumenTieneClaveProhibida({ SOAP: "x" }), "SOAP");
  assert.equal(resumenTieneClaveProhibida({ Tool_Data: "x" }), "Tool_Data");
});

test("un shape limpio (sólo campos whitelisteados) pasa", () => {
  const limpio = {
    id: "x",
    organizationId: "y",
    organizacionNombre: "Demo",
    inicio: "2026-06-01T14:00:00-03:00",
    duracionMin: 30,
    estado: "CERRADO",
    modalidad: "telemedicina",
    tipo: "GENERAL",
    tipoLabel: "Tratamiento general",
    firmadoEn: "2026-05-20T10:00:00-03:00",
    revocadoEn: null,
    plantillaTitulo: "Título",
    plantillaVersion: 2,
  };
  assert.equal(resumenTieneClaveProhibida(limpio), null);
});

test("primitivos y null no rompen el guard (devuelven null)", () => {
  assert.equal(resumenTieneClaveProhibida(null), null);
  assert.equal(resumenTieneClaveProhibida("soap"), null); // string, no clave
  assert.equal(resumenTieneClaveProhibida(42), null);
  assert.equal(resumenTieneClaveProhibida(undefined), null);
});

test("la lista de claves prohibidas cubre las familias SOAP / tool_data / riesgo / firma", () => {
  const lc = CLAVES_PROHIBIDAS_RESUMEN.map((k) => k.toLowerCase());
  for (const clave of [
    "soap",
    "subjetivo",
    "objetivo",
    "evaluacion",
    "plan",
    "tool_data",
    "notas_importantes",
    "sesion",
    "riesgo",
    "cssrs",
    "firma_storage_path",
    "ip",
    "user_agent",
  ]) {
    assert.ok(lc.includes(clave), `falta la clave prohibida "${clave}" en la lista`);
  }
});

// ─── esTurnoPasado · clasificador de historia de atención ─────────────────────

const NOW = Date.parse("2026-07-06T12:00:00-03:00");
const PASADO = "2026-06-01T14:00:00-03:00";
const FUTURO = "2026-08-01T14:00:00-03:00";

test("CERRADO/ATENDIENDO/EN_SALA/NO_ASISTIO cuentan como atención pasada (aunque el horario sea futuro)", () => {
  for (const estado of ["CERRADO", "ATENDIENDO", "EN_SALA", "NO_ASISTIO"]) {
    assert.equal(esTurnoPasado(estado, FUTURO, NOW), true, `estado ${estado} debe ser pasado`);
  }
});

test("AGENDADO/CONFIRMADO futuro NO es historia (es un próximo turno)", () => {
  assert.equal(esTurnoPasado("AGENDADO", FUTURO, NOW), false);
  assert.equal(esTurnoPasado("CONFIRMADO", FUTURO, NOW), false);
});

test("AGENDADO/CONFIRMADO cuyo horario YA pasó SÍ es historia (turno perdido sin cerrar)", () => {
  assert.equal(esTurnoPasado("AGENDADO", PASADO, NOW), true);
  assert.equal(esTurnoPasado("CONFIRMADO", PASADO, NOW), true);
});

test("CANCELADO/REAGENDADO no se muestran como atención ocurrida (ni pasado ni futuro)", () => {
  for (const estado of ["CANCELADO", "REAGENDADO"]) {
    assert.equal(esTurnoPasado(estado, PASADO, NOW), false, `estado ${estado} no es atención ocurrida`);
    assert.equal(esTurnoPasado(estado, FUTURO, NOW), false);
  }
});

test("un inicio inválido no crashea el clasificador (estado vivo → false)", () => {
  assert.equal(esTurnoPasado("AGENDADO", "no-es-fecha", NOW), false);
});
