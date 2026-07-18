/**
 * Folio · instrumentos · helpers de scoring compartidos (puros).
 *
 * Utilidades comunes a los scorers Likert (validación laxa de arrays de
 * respuestas, suma, resolución de banda por corte). Mismo contrato laxo que
 * psicología: acepta `unknown` y devuelve `null` ante cualquier invalidez, para
 * que el historial con shapes ajenos nunca rompa la ficha.
 */

/**
 * Valida un array de respuestas Likert de longitud EXACTA `len`, con todos los
 * ítems enteros dentro de `[min, max]`, y devuelve la suma. `null` si el input
 * no es un array de la longitud exacta o algún ítem es inválido (parcial, fuera
 * de rango, no entero, no numérico). Escalas de tamizaje sólo puntúan completas.
 */
export function sumaLikert(
  items: unknown,
  len: number,
  min: number,
  max: number,
): number | null {
  if (!Array.isArray(items) || items.length !== len) return null;
  let total = 0;
  for (const item of items) {
    if (
      typeof item !== "number" ||
      !Number.isInteger(item) ||
      item < min ||
      item > max
    ) {
      return null;
    }
    total += item;
  }
  return total;
}

/**
 * Resuelve una banda por cortes crecientes. `cortes` es una lista ordenada de
 * `{ hasta, id }`: la primera cuyo `hasta` (inclusive) sea ≥ `total` gana. El
 * último corte suele usar `Infinity` como techo. Devuelve el `id` de la banda.
 */
export function bandaPorCorte(
  total: number,
  cortes: ReadonlyArray<{ hasta: number; id: string }>,
): string {
  for (const c of cortes) {
    if (total <= c.hasta) return c.id;
  }
  // Defensivo: si ningún corte matchea (no debería con Infinity de techo),
  // devuelve el último id declarado.
  return cortes[cortes.length - 1].id;
}
