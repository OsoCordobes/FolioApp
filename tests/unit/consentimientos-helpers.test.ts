/**
 * Tests de lib/consentimientos/helpers.ts — helpers puros del flujo de
 * consentimiento informado (Ley 26.529): path de firma (CHECK M07),
 * selección de plantilla vigente, decisión de firmante (tutor legal) y
 * parser del markdown legal. Sin red ni DB.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFirmaStoragePath,
  defaultTutorId,
  elegirPlantillasVigentes,
  esFirmaPathValido,
  FIRMA_PATH_REGEX,
  mapConsentimientoRow,
  parseConsentMarkdown,
  parseInlineBold,
  pathSinBucket,
  tipoConsentimientoLabel,
  tutorRequerido,
  tutorVigente,
  type PlantillaConsentimientoRow,
  type TutorOption,
} from "../../lib/consentimientos/helpers";

const ORG = "0b2f1a3c-1111-4a2b-8c3d-9e8f7a6b5c4d";
const PAC = "1c3e2b4d-2222-4b3c-9d4e-0f9a8b7c6d5e";
const ARCHIVO = "2d4f3c5e-3333-4c4d-ae5f-1a0b9c8d7e6f";

// ─── buildFirmaStoragePath / FIRMA_PATH_REGEX (CHECK M07) ────────────────────

test("buildFirmaStoragePath: arma el path canónico y pasa el CHECK de M07", () => {
  const path = buildFirmaStoragePath({
    organizationId: ORG,
    pacienteId: PAC,
    archivoUuid: ARCHIVO,
  });
  assert.equal(path, `consentimientos-firmados/${ORG}/${PAC}/${ARCHIVO}.png`);
  assert.ok(FIRMA_PATH_REGEX.test(path));
  // Mismo regex que el zod createSchema de lib/db/consentimientos.ts.
  assert.ok(
    /^consentimientos-firmados\/[a-f0-9-]+\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+$/.test(path),
  );
});

test("buildFirmaStoragePath: rechaza ids que no son uuid (defensa contra path traversal)", () => {
  assert.throws(() =>
    buildFirmaStoragePath({ organizationId: "../otra-org", pacienteId: PAC, archivoUuid: ARCHIVO }),
  );
  assert.throws(() =>
    buildFirmaStoragePath({ organizationId: ORG, pacienteId: "", archivoUuid: ARCHIVO }),
  );
  // uuid uppercase no matchea el CHECK [a-f0-9-] de M07 → también rechazado.
  assert.throws(() =>
    buildFirmaStoragePath({ organizationId: ORG.toUpperCase(), pacienteId: PAC, archivoUuid: ARCHIVO }),
  );
});

test("esFirmaPathValido: acepta el formato del CHECK y rechaza variantes", () => {
  assert.ok(esFirmaPathValido(`consentimientos-firmados/${ORG}/${PAC}/${ARCHIVO}.png`));
  assert.ok(esFirmaPathValido(`consentimientos-firmados/${ORG}/${PAC}/firma.pdf`));
  // Sin prefijo del bucket
  assert.equal(esFirmaPathValido(`${ORG}/${PAC}/${ARCHIVO}.png`), false);
  // Segmento extra
  assert.equal(esFirmaPathValido(`consentimientos-firmados/${ORG}/${PAC}/x/${ARCHIVO}.png`), false);
  // Traversal
  assert.equal(esFirmaPathValido(`consentimientos-firmados/../${PAC}/${ARCHIVO}.png`), false);
  // Filename con caracteres fuera de [a-zA-Z0-9_.-]
  assert.equal(esFirmaPathValido(`consentimientos-firmados/${ORG}/${PAC}/fir ma.png`), false);
});

test("pathSinBucket: saca solo el prefijo del bucket (storage.objects.name)", () => {
  const full = `consentimientos-firmados/${ORG}/${PAC}/${ARCHIVO}.png`;
  assert.equal(pathSinBucket(full), `${ORG}/${PAC}/${ARCHIVO}.png`);
  // Idempotente sobre un path ya sin prefijo
  assert.equal(pathSinBucket(`${ORG}/${PAC}/x.png`), `${ORG}/${PAC}/x.png`);
});

// ─── elegirPlantillasVigentes ────────────────────────────────────────────────

const plantilla = (
  over: Partial<PlantillaConsentimientoRow>,
): PlantillaConsentimientoRow => ({
  id: over.id ?? crypto.randomUUID(),
  organization_id: null,
  tipo: "GENERAL",
  version: 1,
  titulo: null,
  texto_markdown: "# Texto",
  ...over,
});

test("elegirPlantillasVigentes: una por tipo, en el orden del enum", () => {
  const out = elegirPlantillasVigentes([
    plantilla({ tipo: "TELEMEDICINA" }),
    plantilla({ tipo: "GENERAL" }),
    plantilla({ tipo: "FOTOS" }),
  ]);
  assert.deepEqual(
    out.map((p) => p.tipo),
    ["GENERAL", "FOTOS", "TELEMEDICINA"],
  );
});

test("elegirPlantillasVigentes: la custom de la org le gana a la global del mismo tipo", () => {
  const custom = plantilla({ id: "c".repeat(8) + "-4444-4444-8444-444444444444", organization_id: ORG, version: 1 });
  const global = plantilla({ version: 3 }); // aunque la global tenga versión mayor
  const out = elegirPlantillasVigentes([global, custom]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, custom.id);
  assert.equal(out[0].esCustomDeOrg, true);
});

test("elegirPlantillasVigentes: a igual origen gana la versión más alta", () => {
  const v1 = plantilla({ version: 1 });
  const v2 = plantilla({ version: 2 });
  const out = elegirPlantillasVigentes([v1, v2]);
  assert.equal(out.length, 1);
  assert.equal(out[0].version, 2);
});

test("elegirPlantillasVigentes: titulo NULL cae al label del tipo", () => {
  const out = elegirPlantillasVigentes([plantilla({ tipo: "FOTOS", titulo: null })]);
  assert.equal(out[0].titulo, tipoConsentimientoLabel("FOTOS"));
  assert.equal(out[0].titulo, "Registro fotográfico");
});

test("elegirPlantillasVigentes: tipos desconocidos (enum futuro) van al final, no explotan", () => {
  const out = elegirPlantillasVigentes([
    plantilla({ tipo: "ZUKUNFT" }),
    plantilla({ tipo: "GENERAL" }),
  ]);
  assert.deepEqual(out.map((p) => p.tipo), ["GENERAL", "ZUKUNFT"]);
  assert.equal(out[1].titulo, "ZUKUNFT"); // label fallback = el tipo tal cual
});

// ─── mapConsentimientoRow ────────────────────────────────────────────────────

test("mapConsentimientoRow: vigente con plantilla embebida", () => {
  const item = mapConsentimientoRow({
    id: "x1",
    tipo: "GENERAL",
    firmado_en: "2026-07-04T12:00:00Z",
    firmado_por_tutor_id: null,
    revocado_en: null,
    revocado_motivo: null,
    plantilla: { titulo: "Consentimiento general", tipo: "GENERAL", version: 2 },
  });
  assert.equal(item.vigente, true);
  assert.equal(item.titulo, "Consentimiento general");
  assert.equal(item.version, 2);
  assert.equal(item.firmadoPorTutor, false);
});

test("mapConsentimientoRow: revocado + tutor + sin plantilla → fallback al label del tipo", () => {
  const item = mapConsentimientoRow({
    id: "x2",
    tipo: "TRATAMIENTO_MENOR",
    firmado_en: "2026-07-01T12:00:00Z",
    firmado_por_tutor_id: "t1",
    revocado_en: "2026-07-03T12:00:00Z",
    revocado_motivo: "Retiró la autorización",
    plantilla: null,
  });
  assert.equal(item.vigente, false);
  assert.equal(item.firmadoPorTutor, true);
  assert.equal(item.titulo, "Tratamiento de menor");
  assert.equal(item.version, null);
});

test("mapConsentimientoRow: version string (PostgREST smallint como texto) se parsea", () => {
  const item = mapConsentimientoRow({
    id: "x3",
    tipo: "FOTOS",
    firmado_en: "2026-07-04T12:00:00Z",
    firmado_por_tutor_id: null,
    revocado_en: null,
    revocado_motivo: null,
    plantilla: { titulo: null, tipo: "FOTOS", version: "3" },
  });
  assert.equal(item.version, 3);
  assert.equal(item.titulo, "Registro fotográfico"); // titulo NULL → label
});

// ─── Decisión de firmante (tutor legal) ──────────────────────────────────────

const tutor = (over: Partial<TutorOption>): TutorOption => ({
  id: crypto.randomUUID(),
  nombre: "Tutor",
  vinculo: "MADRE",
  esPrincipal: false,
  ...over,
});

test("defaultTutorId: TRATAMIENTO_MENOR preselecciona el tutor principal", () => {
  const t1 = tutor({});
  const principal = tutor({ esPrincipal: true });
  assert.equal(defaultTutorId("TRATAMIENTO_MENOR", [t1, principal]), principal.id);
});

test("defaultTutorId: sin principal cae al primero; sin tutores o tipo común → null", () => {
  const t1 = tutor({});
  const t2 = tutor({});
  assert.equal(defaultTutorId("TRATAMIENTO_MENOR", [t1, t2]), t1.id);
  assert.equal(defaultTutorId("TRATAMIENTO_MENOR", []), null);
  assert.equal(defaultTutorId("GENERAL", [t1]), null);
});

test("tutorRequerido: solo TRATAMIENTO_MENOR y solo si hay tutores cargados", () => {
  assert.equal(tutorRequerido("TRATAMIENTO_MENOR", 1), true);
  assert.equal(tutorRequerido("TRATAMIENTO_MENOR", 0), false);
  assert.equal(tutorRequerido("GENERAL", 3), false);
});

test("tutorVigente: fechas opcionales (M06) — sin fechas vigente; rango inclusive", () => {
  assert.equal(tutorVigente({ vigenciaDesde: null, vigenciaHasta: null }, "2026-07-04"), true);
  assert.equal(tutorVigente({ vigenciaDesde: "2026-07-04", vigenciaHasta: null }, "2026-07-04"), true);
  assert.equal(tutorVigente({ vigenciaDesde: "2026-07-05", vigenciaHasta: null }, "2026-07-04"), false);
  assert.equal(tutorVigente({ vigenciaDesde: null, vigenciaHasta: "2026-07-03" }, "2026-07-04"), false);
  assert.equal(tutorVigente({ vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-07-04" }, "2026-07-04"), true);
});

// ─── parseInlineBold ─────────────────────────────────────────────────────────

test("parseInlineBold: segmentos normal/negrita por pares de **", () => {
  assert.deepEqual(parseInlineBold("Hola **mundo** cruel"), [
    { bold: false, text: "Hola " },
    { bold: true, text: "mundo" },
    { bold: false, text: " cruel" },
  ]);
});

test("parseInlineBold: ** sin cerrar no se come texto (fail-safe)", () => {
  const out = parseInlineBold("Hola **mundo");
  assert.equal(out.map((s) => s.text).join(""), "Hola **mundo");
  assert.ok(out.every((s) => !s.bold));
});

test("parseInlineBold: texto sin negrita → un solo segmento", () => {
  assert.deepEqual(parseInlineBold("plano"), [{ bold: false, text: "plano" }]);
});

// ─── parseConsentMarkdown ────────────────────────────────────────────────────

test("parseConsentMarkdown: headings, párrafos, listas, checkbox y hr", () => {
  const md = [
    "# Título",
    "",
    "## Sección",
    "",
    "Un párrafo con **negrita** adentro.",
    "Segunda línea del mismo párrafo.",
    "",
    "- item uno",
    "- item dos",
    "",
    "1. primero",
    "2. segundo",
    "",
    "[ ] Opción sin marcar",
    "",
    "---",
    "",
    "**Firma del paciente:** ________",
  ].join("\n");

  const bloques = parseConsentMarkdown(md);
  assert.deepEqual(
    bloques.map((b) => b.kind),
    ["heading", "heading", "parrafo", "lista", "lista", "checkbox", "hr", "parrafo"],
  );

  const [h1, h2, p1, ul, ol, check] = bloques;
  assert.ok(h1.kind === "heading" && h1.nivel === 1 && h1.text === "Título");
  assert.ok(h2.kind === "heading" && h2.nivel === 2 && h2.text === "Sección");
  // Líneas contiguas se juntan en un párrafo
  assert.ok(
    p1.kind === "parrafo" &&
      p1.inlines.map((s) => s.text).join("") ===
        "Un párrafo con negrita adentro. Segunda línea del mismo párrafo.",
  );
  assert.ok(p1.kind === "parrafo" && p1.inlines.some((s) => s.bold && s.text === "negrita"));
  assert.ok(ul.kind === "lista" && !ul.ordenada && ul.items.length === 2);
  assert.ok(ol.kind === "lista" && ol.ordenada && ol.items.length === 2);
  assert.ok(check.kind === "checkbox" && check.text === "Opción sin marcar");
});

test("parseConsentMarkdown: la plantilla GENERAL del seed M68 parsea sin perder texto", () => {
  // Fragmento representativo del seed (placeholders incluidos).
  const md = [
    "# Consentimiento informado · Atención clínica general",
    "",
    "**Fecha:** {{fecha}}",
    "**Paciente:** {{paciente_nombre}} · DNI {{paciente_dni}}",
    "",
    "## Derechos",
    "",
    "1. Puedo solicitar copia de mi historia clínica (Ley 26.529 art. 14).",
    "",
    "- Revocar este consentimiento por escrito en cualquier momento.",
  ].join("\n");

  const bloques = parseConsentMarkdown(md);
  const textoPlano = JSON.stringify(bloques);
  // Nada del contenido legal se pierde (placeholders quedan tal cual).
  for (const fragmento of ["{{fecha}}", "{{paciente_nombre}}", "Ley 26.529 art. 14", "Revocar"]) {
    assert.ok(textoPlano.includes(fragmento), `falta "${fragmento}"`);
  }
  assert.equal(bloques[0].kind, "heading");
});

test("parseConsentMarkdown: CRLF y líneas desconocidas caen a párrafo (no se pierde nada)", () => {
  const bloques = parseConsentMarkdown("línea uno\r\nlínea dos\r\n\r\n<raro>契約");
  assert.equal(bloques.length, 2);
  assert.ok(bloques[0].kind === "parrafo");
  assert.ok(
    bloques[1].kind === "parrafo" && bloques[1].inlines[0].text.includes("<raro>"),
  );
});

test("parseConsentMarkdown: string vacío → sin bloques", () => {
  assert.deepEqual(parseConsentMarkdown(""), []);
});
