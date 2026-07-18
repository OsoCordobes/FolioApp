import assert from "node:assert/strict";
import test from "node:test";

import {
  firmaPathMatchesFicha,
  mapConsentimientoPortal,
} from "../../lib/db/portal-consentimientos";
import { resumenTieneClaveProhibida } from "../../lib/db/portal-resumen";

// ═══════════════════════════════════════════════════════════════════════════════
// Folio · P6 · ver / firmar consentimientos desde el portal — helpers puros
//
// La frontera dura la fijan las policies RLS M85 (consentimiento_insert_portal +
// "consentimientos-firmados portal read/write", scopeadas por paciente_owns) + los
// triggers de M07 (inmutabilidad, tutor). Estos tests cubren la lógica PURA que el
// data layer usa antes/alrededor de la RLS:
//   1. firmaPathMatchesFicha — anti-IDOR: el path del binario debe apuntar EXACTO a
//      la ficha (org+paciente) que la sesión autorizó (cinturón sobre el regex M07).
//   2. mapConsentimientoPortal — el item servido al portal es un WHITELIST: nunca
//      expone firma_storage_path, ip ni user_agent (se re-usa el backstop de P5).
// ═══════════════════════════════════════════════════════════════════════════════

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTRA_ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTRO_PAC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// ─── firmaPathMatchesFicha · anti-IDOR de path ───────────────────────────────

test("path correcto (org+paciente de la sesión) → true", () => {
  const path = `consentimientos-firmados/${ORG}/${PAC}/${crypto.randomUUID()}.png`;
  assert.equal(firmaPathMatchesFicha(path, ORG, PAC), true);
});

test("path con OTRA org (mismo paciente) → false (no puede cruzar org)", () => {
  const path = `consentimientos-firmados/${OTRA_ORG}/${PAC}/x.png`;
  assert.equal(firmaPathMatchesFicha(path, ORG, PAC), false);
});

test("path con OTRO paciente (misma org) → false (anti-IDOR)", () => {
  const path = `consentimientos-firmados/${ORG}/${OTRO_PAC}/x.png`;
  assert.equal(firmaPathMatchesFicha(path, ORG, PAC), false);
});

test("path de otro bucket / prefijo inesperado → false", () => {
  assert.equal(firmaPathMatchesFicha(`documentos-clinicos/${ORG}/${PAC}/x.png`, ORG, PAC), false);
  assert.equal(firmaPathMatchesFicha(`${ORG}/${PAC}/x.png`, ORG, PAC), false);
});

test("un intento de path-injection (org como prefijo pero paciente distinto) → false", () => {
  // El prefijo exige la barra final tras el paciente: `.../paciente/`. Un paciente
  // que sea prefijo textual de otro (no ocurre con uuids, pero probamos el borde) no
  // debe colar: exigimos la barra separadora exacta.
  const path = `consentimientos-firmados/${ORG}/${PAC}extra/x.png`;
  assert.equal(firmaPathMatchesFicha(path, ORG, PAC), false);
});

// ─── mapConsentimientoPortal · whitelist del item servido ────────────────────

test("el item mapeado NO contiene firma_storage_path / ip / user_agent ni SOAP", () => {
  const nombrePorOrg = new Map<string, string | null>([[ORG, "Consultorio Demo"]]);
  const item = mapConsentimientoPortal(
    {
      id: "11111111-1111-4111-8111-111111111111",
      organization_id: ORG,
      tipo: "TELEMEDICINA",
      firmado_en: "2026-05-20T10:00:00-03:00",
      revocado_en: null,
      plantilla: { titulo: "Consentimiento para atención por telemedicina", version: 1 },
    },
    nombrePorOrg,
  );

  // Backstop del whitelist (mismo guard que P5): cero claves SOAP/firma/audit.
  const hit = resumenTieneClaveProhibida(item);
  assert.equal(hit, null, `clave prohibida en el item del portal: ${hit}`);

  // Y positivamente: sólo el whitelist esperado.
  assert.deepEqual(Object.keys(item).sort(), [
    "firmadoEn",
    "id",
    "organizacionNombre",
    "organizationId",
    "tipo",
    "tipoLabel",
    "titulo",
    "version",
    "revocadoEn",
    "vigente",
  ].sort());
});

test("mapConsentimientoPortal resuelve el nombre de org desde el fan-out de la sesión", () => {
  const item = mapConsentimientoPortal(
    {
      id: "1",
      organization_id: ORG,
      tipo: "GENERAL",
      firmado_en: "2026-05-20T10:00:00-03:00",
      revocado_en: null,
      plantilla: null,
    },
    new Map([[ORG, "Clínica Norte"]]),
  );
  assert.equal(item.organizacionNombre, "Clínica Norte");
  // Sin plantilla, el título cae al label del tipo (nunca vacío).
  assert.equal(item.titulo, "Tratamiento general");
  assert.equal(item.tipoLabel, "Tratamiento general");
});

test("un consentimiento revocado se marca vigente=false y expone revocadoEn", () => {
  const item = mapConsentimientoPortal(
    {
      id: "1",
      organization_id: ORG,
      tipo: "FOTOS",
      firmado_en: "2026-05-20T10:00:00-03:00",
      revocado_en: "2026-06-01T09:00:00-03:00",
      plantilla: { titulo: "Registro fotográfico", version: 2 },
    },
    new Map(),
  );
  assert.equal(item.vigente, false);
  assert.equal(item.revocadoEn, "2026-06-01T09:00:00-03:00");
  assert.equal(item.version, 2);
});

test("embed de plantilla como array (cardinalidad inferida) se normaliza", () => {
  const item = mapConsentimientoPortal(
    {
      id: "1",
      organization_id: ORG,
      tipo: "GENERAL",
      firmado_en: "2026-05-20T10:00:00-03:00",
      revocado_en: null,
      plantilla: [{ titulo: "Título embebido", version: 3 }],
    },
    new Map(),
  );
  assert.equal(item.titulo, "Título embebido");
  assert.equal(item.version, 3);
});
