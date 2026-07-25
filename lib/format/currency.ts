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

// ─── Techo de montos persistidos (review PR #118) ───────────────────────────
//
// Las columnas *_cents (pago.monto_cents, servicio.precio_cents, …) son int4
// en Postgres: el techo REAL es 2_147_483_647 centavos (~$21,4M). El schema
// del server (cobroCierreSchema en lib/db/turnos.ts) y la validación
// client-side del mini-diálogo de cobro comparten ESTAS constantes para que
// el límite nunca diverja. (El techo anterior de $1M rechazaba el cierre
// entero de un turno caro con un error genérico.)

/** Máximo representable en una columna int4 de centavos. */
export const MONTO_MAX_CENTS = 2_147_483_647;

/** Máximo en pesos enteros que cabe en int4 al convertirse a centavos. */
export const MONTO_MAX_PESOS = Math.floor(MONTO_MAX_CENTS / 100); // 21_474_836
