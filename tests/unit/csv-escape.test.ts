import assert from "node:assert/strict";
import test from "node:test";

import { csvEscape, csvEscapeTexto } from "../../lib/format/csv";

// Review PR #118 · CSV formula injection en /finanzas/export: el nombre del
// paciente puede venir del booking público — un valor que empieza con
// = + - @ TAB o CR se ejecuta como fórmula al abrir el CSV en Excel/Sheets.
// csvEscapeTexto lo neutraliza con un apóstrofo ANTES del quoting RFC 4180.

// ─── csvEscape (quoting RFC 4180) ──────────────────────────────────────────

test("csvEscape: valor simple pasa tal cual", () => {
  assert.equal(csvEscape("Ana López"), "Ana López");
});

test("csvEscape: coma fuerza quoting", () => {
  assert.equal(csvEscape("López, Ana"), '"López, Ana"');
});

test("csvEscape: comillas se duplican y fuerzan quoting", () => {
  assert.equal(csvEscape('Juan "el Tano" Pérez'), '"Juan ""el Tano"" Pérez"');
});

test("csvEscape: saltos de línea fuerzan quoting", () => {
  assert.equal(csvEscape("línea1\nlínea2"), '"línea1\nlínea2"');
});

// ─── csvEscapeTexto (neutralización de fórmulas) ───────────────────────────

test("csvEscapeTexto: '=' inicial se neutraliza con apóstrofo (y las comillas se escapan)", () => {
  assert.equal(
    csvEscapeTexto('=HYPERLINK("http://evil")'),
    '"\'=HYPERLINK(""http://evil"")"',
  );
});

test("csvEscapeTexto: prefijos peligrosos (= + - @ TAB CR) se neutralizan", () => {
  assert.equal(csvEscapeTexto("=1+1"), "'=1+1");
  assert.equal(csvEscapeTexto("+541155550000"), "'+541155550000");
  assert.equal(csvEscapeTexto("-2+3"), "'-2+3");
  assert.equal(csvEscapeTexto("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvEscapeTexto("\tcmd"), "'\tcmd");
});

test("csvEscapeTexto: CR inicial se neutraliza Y se quotea (contiene CR)", () => {
  assert.equal(csvEscapeTexto("\rcmd"), '"\'\rcmd"');
});

test("csvEscapeTexto: payload DDE con comas queda neutralizado y quoteado", () => {
  assert.equal(csvEscapeTexto("=cmd|' /C calc'!A0,x"), "\"'=cmd|' /C calc'!A0,x\"");
});

test("csvEscapeTexto: texto normal no se toca (el guion interior no dispara)", () => {
  assert.equal(csvEscapeTexto("Ana María Pérez-Gómez"), "Ana María Pérez-Gómez");
  assert.equal(csvEscapeTexto("Consulta cardiológica"), "Consulta cardiológica");
});
