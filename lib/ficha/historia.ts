/**
 * Folio · la Historia de la ficha: sesiones + notas, en una sola línea de tiempo.
 *
 * Hasta M96 la ficha sólo mostraba "Sesiones": lo que ocurrió dentro de un
 * turno. Pero la historia clínica de un paciente incluye lo que pasó ENTRE
 * turnos — la llamada, el WhatsApp, lo que el profesional anotó al día
 * siguiente. Mostrarlas en listas separadas obliga al profesional a
 * reconstruir el orden en la cabeza; mostrarlas juntas es leer la ficha.
 *
 * Módulo PURO (sin DB, sin React): el orden cronológico de una historia clínica
 * es exactamente el tipo de regla que merece un test y no una revisión visual.
 */

export interface ItemHistoriaSesion {
  tipo: "sesion";
  id: string;
  /** ISO. */
  fecha: string;
}

export interface ItemHistoriaNota {
  tipo: "nota";
  id: string;
  /** ISO. */
  fecha: string;
}

export type ItemHistoria<S extends { id: string }, N extends { id: string }> =
  | (ItemHistoriaSesion & { dato: S })
  | (ItemHistoriaNota & { dato: N });

/**
 * Fusiona sesiones y notas en orden cronológico DESCENDENTE (lo más reciente
 * arriba, como el resto de la ficha).
 *
 * Empate exacto de instante → la SESIÓN va primero: la nota que se escribe
 * junto a una visita es casi siempre un complemento de esa visita, así que
 * leerla debajo es el orden natural. Es una convención, pero tiene que ser
 * estable: sin ella, dos renders del mismo dato podrían ordenarse distinto.
 *
 * Las fechas ilegibles no se descartan — se mandan al final. Un ítem de la
 * historia clínica que desaparece porque su timestamp no parseó es peor que un
 * ítem fuera de orden.
 */
export function mergeHistoria<S extends { id: string }, N extends { id: string }>(
  sesiones: Array<{ id: string; fecha: string; dato: S }>,
  notas: Array<{ id: string; fecha: string; dato: N }>,
  max?: number,
): Array<ItemHistoria<S, N>> {
  const items: Array<ItemHistoria<S, N>> = [
    ...sesiones.map((s) => ({ tipo: "sesion" as const, id: s.id, fecha: s.fecha, dato: s.dato })),
    ...notas.map((n) => ({ tipo: "nota" as const, id: n.id, fecha: n.fecha, dato: n.dato })),
  ];

  const ms = (iso: string): number => {
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };

  items.sort((a, b) => {
    const diff = ms(b.fecha) - ms(a.fecha);
    if (diff !== 0) return diff;
    if (a.tipo !== b.tipo) return a.tipo === "sesion" ? -1 : 1;
    // Último desempate: por id, para que el orden sea determinista entre
    // renders aunque dos ítems del mismo tipo compartan instante.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return typeof max === "number" ? items.slice(0, max) : items;
}
