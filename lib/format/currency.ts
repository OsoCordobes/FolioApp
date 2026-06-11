/**
 * Folio · Formateo de moneda ARS.
 *
 * Único formateador de pesos del producto (landing, billing, public card).
 * es-AR + ARS + 0 decimales — ej: "$ 30.000". Si alguna superficie necesita
 * decimales u otras opciones, que cree su propio formatter; este es el
 * canónico para precios enteros.
 */

const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/** Formatea un monto expresado en ARS (unidad entera). */
export function formatArs(ars: number): string {
  return arsFormatter.format(ars);
}

/** Formatea un monto expresado en centavos de ARS (como se persiste en DB). */
export function formatArsFromCents(cents: number): string {
  return arsFormatter.format(cents / 100);
}
