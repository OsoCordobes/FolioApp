/**
 * Folio · pluralización de contadores (E1).
 *
 * "1 turnos" aparecía en la grilla del calendario, en la vista mes y en las
 * cabeceras de bloque de /hoy. No rompe nada, pero es exactamente el detalle
 * por el que un profesional decide que el software es amateur — y Folio se le
 * cobra por mes.
 *
 * Castellano nada más, que es el único idioma de la app: el plural es
 * `${palabra}s` salvo para las palabras irregulares que pase el caller
 * (`sesión`/`sesiones`). Sin dependencias ni `Intl.PluralRules`: son dos
 * ramas y así se puede leer de un vistazo qué imprime.
 *
 * Testeado en tests/unit/plural.test.ts.
 */

/**
 * `"1 turno"` / `"3 turnos"`. Pasá `plural` cuando la palabra es irregular o
 * lleva tilde que se pierde ("sesión" → "sesiones").
 */
export function contar(n: number, singular: string, plural?: string): string {
  return `${n} ${palabra(n, singular, plural)}`;
}

/** Solo la palabra, sin el número: para cuando el número ya se pinta aparte. */
export function palabra(n: number, singular: string, plural?: string): string {
  // Math.abs: −1 también es singular ("−1 turno"), y el 0 es plural en
  // castellano ("0 turnos"), igual que cualquier cantidad distinta de uno.
  return Math.abs(n) === 1 ? singular : (plural ?? `${singular}s`);
}
