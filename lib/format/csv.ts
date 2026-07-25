/**
 * Folio · escape de celdas CSV (RFC 4180 + neutralización de fórmulas).
 *
 * `csvEscape` cubre el quoting clásico (comas, comillas, saltos de línea).
 *
 * `csvEscapeTexto` (review PR #118) se usa para campos de TEXTO LIBRE que
 * pueden venir de terceros — el nombre del paciente puede nacer en el booking
 * público, el del servicio lo tipea la org. Si el valor empieza con `=`, `+`,
 * `-`, `@`, TAB o CR, Excel/Sheets/LibreOffice lo interpretan como FÓRMULA al
 * abrir el archivo (CSV/formula injection, p.ej. `=HYPERLINK(...)` o DDE
 * `=cmd|...`). Se neutraliza prefijando un apóstrofo, que las planillas
 * tratan como marcador de "texto literal".
 */

/** Prefijos que las planillas interpretan como inicio de fórmula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Quoting RFC 4180: comillas dobles escapadas y quote si hay separadores. */
export function csvEscape(v: string): string {
  const needsQuote = /[",\r\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/**
 * Escape para texto libre potencialmente hostil: neutraliza fórmulas con un
 * apóstrofo ANTES del quoting. Usar en toda celda cuyo contenido no controle
 * el server (nombres de pacientes/servicios, notas, etc.).
 */
export function csvEscapeTexto(v: string): string {
  return csvEscape(FORMULA_PREFIX.test(v) ? `'${v}` : v);
}
