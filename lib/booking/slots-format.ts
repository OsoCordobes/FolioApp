/**
 * Folio · formateo/agrupado de slots de booking (helpers PUROS, sin DB).
 *
 * Extraídos de components/booking/booking-wizard.tsx (F2 · identidad del
 * portal) para poder reusarlos en el picker de reagenda del portal del
 * paciente sin arrastrar el wizard entero al bundle. Comparten la premisa de
 * todo el booking: los ISO llegan en UTC y se PRESENTAN en hora argentina
 * (America/Argentina/Cordoba, UTC-3 fijo, sin DST desde 2009).
 *
 * Testeables sin DOM ni DB (tests/unit/booking-slots-format.test.ts).
 */

export const TZ_AR = "America/Argentina/Cordoba";

/** Cualquier cosa con un `inicio` ISO agrupable por día (Slot del booking,
 * slot del portal, etc.). */
export interface SlotConInicio {
  inicio: string;
}

/** "14:30" en hora AR. hourCycle explícito: los browsers ya resuelven es-AR
 * como h23, pero el ICU de Node cae a h12 ("10:00 a. m.") — lo fijamos para
 * que server/cliente/tests rindan idéntico. */
export function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TZ_AR,
  });
}

/** "Lunes 3 de marzo" (capitalizado) en hora AR. */
export function fmtDia(iso: string): string {
  const d = new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ_AR,
  });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** YYYY-MM-DD en AR — clave estable de agrupado por día calendario. */
export function diaKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_AR });
}

/**
 * Agrupa slots por día calendario AR, preservando el orden interno de cada
 * grupo y ordenando los grupos cronológicamente. El label del grupo sale del
 * primer slot del día (fmtDia).
 */
export function agruparPorDia<T extends SlotConInicio>(
  slots: T[],
): Array<{ dia: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const s of slots) {
    const k = diaKey(s.inicio);
    const arr = map.get(k);
    if (arr) arr.push(s);
    else map.set(k, [s]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, items]) => ({ dia: fmtDia(items[0].inicio), items }));
}
