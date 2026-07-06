import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMembreteMeta,
  formatGeneradoTs,
  orDash,
  tieneSoap,
} from "../../lib/pdf/ficha-format";
import {
  PDF_COLORS,
  PDF_PAGE,
  PDF_RADIUS,
  PDF_SPACE,
  PDF_TYPE,
} from "../../lib/pdf/theme";

// ─── orDash ──────────────────────────────────────────────────────────────────

test("orDash: valores vacíos/nulos → em dash", () => {
  assert.equal(orDash(null), "—");
  assert.equal(orDash(undefined), "—");
  assert.equal(orDash(""), "—");
  assert.equal(orDash("   "), "—");
});

test("orDash: valores con contenido se devuelven trimeados (display limpio)", () => {
  assert.equal(orDash("Cardiología"), "Cardiología");
  // Recorta whitespace de borde para no ensuciar el layout del PDF.
  assert.equal(orDash("  hola  "), "hola");
});

// ─── buildMembreteMeta ───────────────────────────────────────────────────────

test("buildMembreteMeta: arma profesional · matrícula · especialidad en orden", () => {
  assert.deepEqual(
    buildMembreteMeta({ profesional: "Dra. Vega", matricula: "12345", especialidad: "Cardiología" }),
    ["Dra. Vega", "Mat. 12345", "Cardiología"],
  );
});

test("buildMembreteMeta: matrícula omitida cuando la route no la pasa (opt-in M62 off)", () => {
  // La route pasa matricula=null cuando member.mostrar_matricula es false.
  assert.deepEqual(
    buildMembreteMeta({ profesional: "Dra. Vega", matricula: null, especialidad: "Psicología" }),
    ["Dra. Vega", "Psicología"],
  );
});

test("buildMembreteMeta: filtra vacíos y strings de solo espacios", () => {
  assert.deepEqual(buildMembreteMeta({ profesional: "", matricula: "  ", especialidad: null }), []);
  assert.deepEqual(buildMembreteMeta({}), []);
});

test("buildMembreteMeta: la matrícula lleva prefijo 'Mat.'", () => {
  const meta = buildMembreteMeta({ matricula: "MP-9876" });
  assert.deepEqual(meta, ["Mat. MP-9876"]);
});

// ─── tieneSoap ───────────────────────────────────────────────────────────────

test("tieneSoap: true si algún campo tiene contenido", () => {
  assert.equal(tieneSoap({ s: "dolor lumbar", o: "", a: "", p: "" }), true);
  assert.equal(tieneSoap({ s: "", o: "", a: "", p: "plan de tratamiento" }), true);
});

test("tieneSoap: false si todos vacíos o solo espacios", () => {
  assert.equal(tieneSoap({ s: "", o: "", a: "", p: "" }), false);
  assert.equal(tieneSoap({ s: "  ", o: "\n", a: "\t", p: " " }), false);
});

// ─── formatGeneradoTs ────────────────────────────────────────────────────────

test("formatGeneradoTs: ISO válido → cadena es-AR no vacía y distinta del ISO", () => {
  const out = formatGeneradoTs("2026-07-06T15:30:00.000Z");
  assert.equal(typeof out, "string");
  assert.ok(out.length > 0);
  // 2026 debe aparecer en la fecha larga es-AR.
  assert.match(out, /2026/);
});

test("formatGeneradoTs: ISO inválido se devuelve tal cual (defensivo)", () => {
  assert.equal(formatGeneradoTs("no-es-una-fecha"), "no-es-una-fecha");
});

// ─── theme (tokens estables) ─────────────────────────────────────────────────

test("theme: paleta brass/cream espeja los tokens de folio.css (tema claro)", () => {
  // Fijamos los valores canónicos: si folio.css cambia estos tokens, el PDF
  // debe seguir el cambio a mano (y este test marca el drift).
  assert.equal(PDF_COLORS.surface, "#FBF9F4"); // --surface
  assert.equal(PDF_COLORS.ink, "#1B1812"); // --ink
  assert.equal(PDF_COLORS.accent, "#8A6722"); // --accent (brass)
  assert.equal(PDF_COLORS.accent2, "#6E5119"); // --accent-2
  assert.equal(PDF_COLORS.line, "#DDD5C0"); // --line
});

test("theme: escalas de espaciado/radio son números positivos y monótonos", () => {
  assert.ok(PDF_SPACE.s1 < PDF_SPACE.s2);
  assert.ok(PDF_SPACE.s2 < PDF_SPACE.s3);
  assert.ok(PDF_RADIUS.sm < PDF_RADIUS.md);
  assert.ok(PDF_RADIUS.md < PDF_RADIUS.lg);
  for (const v of Object.values(PDF_SPACE)) assert.ok(v >= 0);
});

test("theme: tipografía usa las familias core de PDF (sin fuentes externas)", () => {
  // Helvetica / Helvetica-Bold vienen embebidas en react-pdf → CSP-safe en
  // Vercel (sin fetch a hosts externos, sin Font.register de assets).
  assert.equal(PDF_TYPE.family, "Helvetica");
  assert.equal(PDF_TYPE.familyBold, "Helvetica-Bold");
  assert.ok(PDF_TYPE.h1 > PDF_TYPE.body);
  assert.ok(PDF_TYPE.body > PDF_TYPE.small);
});

test("theme: márgenes de página A4 dejan aire para membrete y pie", () => {
  assert.ok(PDF_PAGE.paddingTop > 0);
  assert.ok(PDF_PAGE.paddingBottom > 0);
  assert.ok(PDF_PAGE.paddingHorizontal > 0);
});
