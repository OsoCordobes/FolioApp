/**
 * Folio · rango horario REAL de la grilla semanal (/calendario).
 *
 * Antes la grilla hardcodeaba 08:00–19:00 y cualquier turno fuera de ese rango
 * quedaba clipeado por `overflow: hidden` (existía en /hoy y en la DB pero era
 * invisible en el calendario). Estas funciones puras derivan el rango visible
 * del min/max entre:
 *   - la disponibilidad del profesional (franjas de disponibilidad_profesional
 *     vigentes en la semana visible), y
 *   - los eventos reales de la semana (turnos + bloqueos + pedidos con hora).
 *
 * El default 08–19 actúa como piso: el rango NUNCA se achica por debajo del
 * render histórico (una agenda de 10–13 sigue mostrando 08–19), solo se
 * expande. Clamp defensivo a [00, 24] contra datos corruptos.
 *
 * Módulo client-safe (sin imports de server) — lo consume el client component
 * components/calendario/calendario.tsx y lo testea tests/unit sin DB.
 */

export interface EventoHorario {
  /** "HH:MM" (o "HH:MM:SS"); null/invalid se ignora. */
  hora: string | null;
  /** Duración en minutos; null/0/negativo cae al default 45. */
  dur?: number | null;
}

/** Franja de disponibilidad_profesional con horario y vigencia (shape espejo
 *  de FranjaDisponibilidad en lib/db/calendario.ts, sin importar server code). */
export interface FranjaHorariaVigente {
  /** 0=domingo … 6=sábado (convención DB de disponibilidad_profesional, M02). */
  diaSemana: number;
  /** "HH:MM" 24h (CHECK disp_hora_format, M02). */
  horaInicio: string;
  /** "HH:MM" 24h, > horaInicio (CHECK disp_orden, M02). */
  horaFin: string;
  /** "YYYY-MM-DD". */
  vigenciaDesde: string;
  /** "YYYY-MM-DD" o null (sin fin). */
  vigenciaHasta: string | null;
}

/** Rango en minutos desde medianoche [desdeMin, hastaMin). */
export interface RangoMin {
  desdeMin: number;
  hastaMin: number;
}

/** Rango histórico de la grilla — piso del rango derivado. */
export const RANGO_DEFAULT = { horaInicio: 8, horaFin: 19 } as const;

const MIN_DIA = 24 * 60;
const DUR_DEFAULT = 45;

/** "HH:MM" (o "HH:MM:SS") → minutos desde medianoche; null si es inválida. */
function parseHoraMin(hora: string | null | undefined): number | null {
  if (!hora) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hora);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * Min/max de las franjas de disponibilidad vigentes en la semana visible.
 * `weekDates` son las 7 fechas ISO lun..dom (índice 0=LUN … 6=DOM, misma
 * convención que deriveDiasCerrados / deriveCapacidadSemana).
 *
 * Devuelve null si ninguna franja aplica a la semana (org sin disponibilidad
 * cargada) — el caller cae al default + eventos.
 */
export function deriveRangoDisponibilidadSemana(
  weekDates: string[],
  franjas: FranjaHorariaVigente[],
): RangoMin | null {
  let desde = Infinity;
  let hasta = -Infinity;
  for (let i = 0; i < weekDates.length; i++) {
    const iso = weekDates[i];
    // Índice UI (0=lun..6=dom) → convención DB (0=dom..6=sáb).
    const dowDb = (i + 1) % 7;
    for (const f of franjas) {
      if (f.diaSemana !== dowDb) continue;
      if (f.vigenciaDesde > iso) continue;
      if (f.vigenciaHasta != null && f.vigenciaHasta < iso) continue;
      const ini = parseHoraMin(f.horaInicio);
      const fin = parseHoraMin(f.horaFin);
      if (ini == null || fin == null || fin <= ini) continue;
      desde = Math.min(desde, ini);
      hasta = Math.max(hasta, fin);
    }
  }
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return null;
  return { desdeMin: desde, hastaMin: hasta };
}

/**
 * Rango horario final de la grilla (horas enteras): expande el default 08–19
 * para cubrir disponibilidad y eventos, redondeando a hora completa (floor el
 * inicio, ceil el fin — un turno de 19:30+45' extiende la grilla hasta las 21).
 */
export function deriveRangoHorario(opts: {
  eventos: EventoHorario[];
  disponibilidad?: RangoMin | null;
}): { horaInicio: number; horaFin: number } {
  let desdeMin = RANGO_DEFAULT.horaInicio * 60;
  let hastaMin = RANGO_DEFAULT.horaFin * 60;

  const disp = opts.disponibilidad;
  if (
    disp &&
    Number.isFinite(disp.desdeMin) &&
    Number.isFinite(disp.hastaMin) &&
    disp.hastaMin > disp.desdeMin
  ) {
    desdeMin = Math.min(desdeMin, Math.max(0, disp.desdeMin));
    hastaMin = Math.max(hastaMin, Math.min(MIN_DIA, disp.hastaMin));
  }

  for (const ev of opts.eventos) {
    const ini = parseHoraMin(ev.hora);
    if (ini == null) continue;
    const dur =
      typeof ev.dur === "number" && Number.isFinite(ev.dur) && ev.dur > 0
        ? Math.min(ev.dur, MIN_DIA)
        : DUR_DEFAULT;
    desdeMin = Math.min(desdeMin, ini);
    hastaMin = Math.max(hastaMin, Math.min(MIN_DIA, ini + dur));
  }

  // Redondeo a hora completa + clamp defensivo a [00, 24].
  const horaInicio = Math.max(0, Math.min(23, Math.floor(desdeMin / 60)));
  const horaFin = Math.max(horaInicio + 1, Math.min(24, Math.ceil(hastaMin / 60)));
  return { horaInicio, horaFin };
}

/**
 * Click en un slot vacío de la columna del día → hora "HH:MM" del slot.
 * Redondea al múltiplo de `snapMin` (default 15') más cercano y clampea al
 * rango visible (el último slot arranca `snapMin` antes del fin de la grilla).
 */
export function slotDesdeOffsetY(opts: {
  /** Offset vertical del click dentro de la columna, en px. */
  offsetY: number;
  horaInicio: number;
  horaFin: number;
  /** Alto en px de una hora de grilla. */
  horaPx: number;
  snapMin?: number;
}): string {
  const { offsetY, horaInicio, horaFin, horaPx } = opts;
  const snap = opts.snapMin ?? 15;
  const desde = horaInicio * 60;
  const hasta = horaFin * 60;
  const raw = horaPx > 0 ? desde + (offsetY / horaPx) * 60 : desde;
  const snapped = Math.round(raw / snap) * snap;
  const min = Math.max(desde, Math.min(hasta - snap, Number.isFinite(snapped) ? snapped : desde));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
