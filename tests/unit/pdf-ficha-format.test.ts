import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMembreteMeta,
  evolucionDesdeSesiones,
  evolucionValidada,
  EVOLUCION_PDF_MAX,
  formatGeneradoTs,
  orDash,
  tieneSoap,
  type EvolucionSesionInput,
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

// ─── evolucionDesdeSesiones (D2 · sección Evolución del PDF) ─────────────────

function sesion(overrides: Partial<EvolucionSesionInput> = {}): EvolucionSesionInput {
  return {
    fecha: "2026-07-01",
    servicio: "Sesión estándar",
    cambio: "C4 ajustada",
    soap: { s: "refiere mejora", o: "", a: "", p: "" },
    ...overrides,
  };
}

test("evolucionDesdeSesiones: mapea fecha · servicio · resumen y conserva el SOAP", () => {
  const out = evolucionDesdeSesiones([sesion()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].fecha, "2026-07-01");
  assert.equal(out[0].servicio, "Sesión estándar");
  assert.equal(out[0].resumen, "C4 ajustada");
  assert.deepEqual(out[0].soap, { s: "refiere mejora", o: "", a: "", p: "" });
});

test("evolucionDesdeSesiones: SOAP vacío o null se omite (no imprime cuatro '—')", () => {
  const vacio = sesion({ soap: { s: "  ", o: "", a: "\n", p: "" } });
  const sinSesion = sesion({ soap: null });
  const out = evolucionDesdeSesiones([vacio, sinSesion]);
  assert.equal(out[0].soap, null);
  assert.equal(out[1].soap, null);
});

test("evolucionDesdeSesiones: un resumen con límite explícito preserva el orden DESC", () => {
  const muchas = Array.from({ length: EVOLUCION_PDF_MAX + 5 }, (_, i) =>
    sesion({ fecha: `2026-06-${String(i + 1).padStart(2, "0")}` }),
  );
  const out = evolucionDesdeSesiones(muchas, EVOLUCION_PDF_MAX);
  assert.equal(out.length, EVOLUCION_PDF_MAX);
  // Toma las PRIMERAS N (el historial ya viene DESC: las más recientes).
  assert.equal(out[0].fecha, "2026-06-01");
});

test("evolucionDesdeSesiones: lista vacía → [] (la sección se omite)", () => {
  assert.deepEqual(evolucionDesdeSesiones([]), []);
});

test("evolucionDesdeSesiones preserves the full history by default and original amendment provenance", () => {
  const enmiendas = [{ id: "e1", autorId: "author", createdAt: "2026-09-08T12:00:00Z", motivo: "Correction", texto: "Original amendment" }];
  const rows = Array.from({ length: 62 }, (_, i) => sesion({ sesionId: `s${i}`, enmiendas, profesionalId: "professional", lockedAt: null }));
  const out = evolucionDesdeSesiones(rows);
  assert.equal(out.length, 62); assert.equal(out[61].sesionId, "s61");
  assert.deepEqual(out[0].enmiendas, enmiendas); assert.equal(out[0].profesionalId, "professional");
});

test("validated evolution keeps visits without a session and uses dated original clinical data", () => {
  const recorded = sesion({ sesionId: "s1" });
  const empty = sesion({ sesionId: null, soap: null, cambio: "No clinical record" });
  const clinical = { ...evolucionDesdeSesiones([recorded])[0], sesionId: "s1", fecha: "2026-06-30", resumen: "Validated original" };
  const out = evolucionValidada([recorded, empty], [clinical]);
  assert.equal(out.length, 2); assert.equal(out[0].fecha, "2026-06-30"); assert.equal(out[0].resumen, "Validated original");
  assert.equal(out[1].soap, null); assert.equal(out[1].resumen, "No clinical record");
  assert.throws(() => evolucionValidada([recorded], []), /pdf_history_changed/);
  assert.throws(() => evolucionValidada([], [clinical]), /pdf_history_changed/);
  assert.throws(() => evolucionValidada([recorded, recorded], [clinical]), /pdf_history_changed/);
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
