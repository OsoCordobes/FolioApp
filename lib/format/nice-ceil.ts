/**
 * Folio · niceCeil — techo "lindo" para ejes de charts.
 *
 * Redondea un valor hacia arriba al próximo 1/2/5 × 10^n (la escala clásica
 * de ejes legibles). Reemplaza el piso hardcodeado de $150.000 del chart de
 * /finanzas, que aplanaba la curva de consultorios con ticket bajo: un
 * consultorio que factura $40.000/día veía su línea pegada al fondo.
 *
 * `fallback` cubre el estado vacío (sin datos, 0 o negativo): un techo chico
 * para que la grilla del eje no desaparezca.
 *
 * Pura y testeada en tests/unit/nice-ceil.test.ts.
 */

export function niceCeil(value: number, fallback = 10_000): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const frac = value / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}
