/**
 * Folio · un rango de ausencia → filas de `bloqueo`, partido por día local.
 *
 * `bloqueo` (M09) es una fila por tramo con `inicio` + `duracion_min`, y el
 * CHECK `bloqueo_duracion_valid` la limita a 5..1440 minutos. Una ausencia de
 * varios días (vacaciones, congreso, licencia) NO entra en una sola fila:
 * hay que partirla en tramos de a lo sumo un día. Truncarla en 1440 min es
 * peor que no guardarla — deja los días 2..n abiertos a reserva sin que nadie
 * se entere.
 *
 * Además, partir por día local es lo que hace que el bloqueo se VEA y se
 * RESTE: tanto la grilla semanal (lib/db/calendario.ts) como la
 * disponibilidad pública (lib/booking/availability.ts) filtran bloqueos por
 * `inicio` dentro del rango consultado — una fila única de 5 días que arranca
 * el lunes es invisible para la semana siguiente.
 *
 * Módulo PURO (sin imports de server ni de DB): lo usan el sync inbound de
 * Google (lib/google/inbound.ts) y la creación manual desde el calendario
 * (lib/db/bloqueos.ts), y lo testea tests/unit/bloqueo-rango.test.ts sin DB.
 *
 * Toda la aritmética de día es wall-clock en la timezone de la organización
 * (vía Intl), no UTC: en Argentina no hay DST desde 2009, pero el corte de
 * medianoche tiene que ser el del consultorio, no el de UTC (que caería a las
 * 21:00 del día anterior).
 */

/** Límites de `bloqueo.duracion_min` (CHECK bloqueo_duracion_valid, M09). */
export const BLOQUEO_DURACION_MIN = 5;
export const BLOQUEO_DURACION_MAX = 1440;

/** Tope defensivo de tramos por rango (un año). Evita loops patológicos. */
export const MAX_SEGMENTOS_BLOQUEO = 366;

const MS_MIN = 60_000;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SegmentoBloqueo {
  /** "YYYY-MM-DD" del día local que cubre el tramo — clave estable del tramo. */
  fechaLocal: string;
  /** Epoch ms del inicio del tramo. */
  inicioMs: number;
  /** Minutos, ya dentro del CHECK (5..1440). */
  duracionMin: number;
}

// ─── Helpers de timezone (wall-clock ↔ UTC) ─────────────────────────────────

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const comoUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return comoUtc - utcMs;
}

/** Fecha "YYYY-MM-DD" del instante `utcMs` visto desde `timeZone`. */
export function fechaLocalEnTz(utcMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Epoch ms de la medianoche local de "YYYY-MM-DD" en `timeZone`. Doble probe
 * de offset (mismo patrón que lib/db/calendario.ts) para caer del lado
 * correcto de un salto de DST.
 */
export function medianocheLocalUtcMs(fechaLocal: string, timeZone: string): number {
  const [y, m, d] = fechaLocal.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d, 0, 0, 0);
  const o1 = offsetMs(base, timeZone);
  const utc = base - o1;
  const o2 = offsetMs(utc, timeZone);
  return o2 === o1 ? utc : base - o2;
}

/** Suma días de calendario a una fecha "YYYY-MM-DD" (aritmética de fecha, sin TZ). */
export function sumarDiasIso(fechaLocal: string, dias: number): string {
  const [y, m, d] = fechaLocal.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export function esFechaIso(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && FECHA_RE.test(valor);
}

// ─── Rango de días completos ────────────────────────────────────────────────

/**
 * Rango [desde, hasta) de una ausencia expresada en días completos, con
 * `hastaFecha` INCLUSIVO (así lo entiende quien carga "del 20 al 27": el 27
 * también está de vacaciones). Devuelve null si las fechas no son válidas o
 * el rango está invertido.
 *
 * Ojo con el otro convenio: los eventos all-day de Google traen `end.date`
 * EXCLUSIVO. Ese caso se arma con `sumarDiasIso(endDate, -1)` antes de
 * llamar acá — ver lib/google/inbound.ts.
 */
export function rangoDeDiasCompletos(
  desdeFecha: string,
  hastaFechaInclusive: string,
  timeZone: string,
): { desdeMs: number; hastaMs: number } | null {
  if (!esFechaIso(desdeFecha) || !esFechaIso(hastaFechaInclusive)) return null;
  if (hastaFechaInclusive < desdeFecha) return null;
  const desdeMs = medianocheLocalUtcMs(desdeFecha, timeZone);
  const hastaMs = medianocheLocalUtcMs(sumarDiasIso(hastaFechaInclusive, 1), timeZone);
  if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs) || hastaMs <= desdeMs) return null;
  return { desdeMs, hastaMs };
}

// ─── Partición por día local ────────────────────────────────────────────────

/**
 * Parte [desdeMs, hastaMs) en tramos que no cruzan la medianoche local, cada
 * uno apto para una fila de `bloqueo`.
 *
 * Reglas:
 *   - `hasta` es EXCLUSIVO (una ausencia hasta el jueves 00:00 no ocupa el
 *     jueves). Es el borde donde este tipo de código siempre falla por un día.
 *   - Cada tramo se clampa al CHECK: mínimo 5' (una cola de 2' se guarda como
 *     5' — bloquear de más 3 minutos es inocuo; perder la fila, no) y máximo
 *     1440' (un día de 25h por DST deja la última hora libre; Argentina no
 *     tiene DST desde 2009).
 *   - Rango inválido/invertido → [] (el caller decide si es error o no-op).
 */
export function partirRangoEnBloqueos(input: {
  desdeMs: number;
  hastaMs: number;
  timeZone: string;
  /** Tope de tramos; default MAX_SEGMENTOS_BLOQUEO. */
  maxSegmentos?: number;
}): SegmentoBloqueo[] {
  const { desdeMs, hastaMs, timeZone } = input;
  const max = input.maxSegmentos ?? MAX_SEGMENTOS_BLOQUEO;
  if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs) || hastaMs <= desdeMs) return [];

  const out: SegmentoBloqueo[] = [];
  let cursor = desdeMs;
  while (cursor < hastaMs && out.length < max) {
    const fechaLocal = fechaLocalEnTz(cursor, timeZone);
    const proximaMedianoche = medianocheLocalUtcMs(sumarDiasIso(fechaLocal, 1), timeZone);
    // Guard anti-loop: si la próxima medianoche no avanza (TZ exótica o dato
    // corrupto), cerramos el rango en un solo tramo y salimos.
    const fin = proximaMedianoche > cursor ? Math.min(hastaMs, proximaMedianoche) : hastaMs;
    const duracionMin = Math.min(
      BLOQUEO_DURACION_MAX,
      Math.max(BLOQUEO_DURACION_MIN, Math.round((fin - cursor) / MS_MIN)),
    );
    out.push({ fechaLocal, inicioMs: cursor, duracionMin });
    if (fin <= cursor) break;
    cursor = fin;
  }
  return out;
}
