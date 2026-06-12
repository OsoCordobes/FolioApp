/**
 * Folio · cálculo de slots disponibles para booking público.
 *
 * Algoritmo:
 *   1. Obtener `disponibilidad_profesional` activa del member, vigente para
 *      el rango (vigencia_desde/hasta), con días + franjas horarias.
 *   2. Generar todos los slots posibles en el rango (next 14 days) en la zona
 *      horaria AR (UTC-3 fijo, sin DST desde 2009 en Argentina).
 *   3. Restar `turno` agendados/confirmados/en_sala/atendiendo (excluyendo CERRADO/NO_ASISTIO).
 *   4. Restar `bloqueo` (Google Calendar events u horarios manuales).
 *   5. Restar `pedido` PENDIENTE con fecha_propuesta en el slot (evita doble booking
 *      tentativo mientras el profesional confirma).
 *
 * El `duracionMin` del servicio determina la granularidad del slot.
 *
 * Timezone: hora_inicio/hora_fin son texto "HH:MM" interpretado como AR-local
 * (America/Argentina/Cordoba, UTC-3 fijo). El servidor corre en UTC en Vercel,
 * por eso construimos los timestamps UTC sumando 3h al horario AR.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface Slot {
  inicio: string;                               // ISO datetime UTC
  fin: string;
}

/**
 * Error de lectura de agenda. Se lanza (en vez de devolver `[]`) cuando una de
 * las queries de disponibilidad falla, para que el caller distinga un error
 * transitorio de DB de un resultado legítimo de cero slots. Sin esto el booking
 * público mostraría "sin turnos" y rechazaría pacientes reales ante un fallo.
 */
export class AvailabilityDbError extends Error {
  readonly code = "db_error" as const;
  constructor(detail?: string) {
    super("No pudimos leer la agenda. Probá de nuevo.");
    this.name = "AvailabilityDbError";
    if (detail) this.cause = detail;
  }
}

// Argentina UTC-3 fijo (sin horario de verano desde 2009). En el futuro podríamos
// usar `Intl.DateTimeFormat` para soporte multi-zona, pero hoy todos los clientes
// están en AR.
const AR_OFFSET_MIN = -180;

/** AR-calendar Y/M/D del instante UTC pasado. */
function arCalendarDate(utcMs: number): { y: number; m: number; d: number; dow: number } {
  const arMs = utcMs + AR_OFFSET_MIN * 60_000;
  const ar = new Date(arMs);
  return {
    y: ar.getUTCFullYear(),
    m: ar.getUTCMonth(),
    d: ar.getUTCDate(),
    dow: ar.getUTCDay(),
  };
}

/** UTC ms correspondiente a la hora AR local (h:m) de la fecha AR (y, m, d). */
function arToUtcMs(y: number, m: number, d: number, h: number, min: number): number {
  // AR = UTC + AR_OFFSET_MIN (negativo) → UTC = AR - AR_OFFSET_MIN
  return Date.UTC(y, m, d, h - AR_OFFSET_MIN / 60, min);
}

/** "YYYY-MM-DD" en AR-calendar para comparar contra vigencia_desde/hasta (DATE). */
function arDateString(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Genera los slots ofrecidos dentro de una franja horaria (pura, testeable).
 *
 * Avanza el cursor por `duracionMs + margenMs` entre slots ofrecidos: el margen
 * SOLO afecta el espaciado de los slots OFRECIDOS, nunca la detección de
 * ocupación/conflicto (los rangos `ocupados` mantienen su span real).
 *
 * Un slot `[t, t+duracionMs)` se incluye sii:
 *   - `t + duracionMs <= franjaEndMs` (entra completo en la franja),
 *   - `t > nowMs` (no es pasado),
 *   - no solapa ningún rango en `ocupados` (half-open overlap).
 */
export function generateSlotsForFranja(
  franjaStartMs: number,
  franjaEndMs: number,
  duracionMs: number,
  margenMs: number,
  nowMs: number,
  ocupados: Array<[number, number]>,
): Array<{ inicio: number; fin: number }> {
  const out: Array<{ inicio: number; fin: number }> = [];
  if (duracionMs <= 0) return out;
  const step = duracionMs + Math.max(0, margenMs);
  const isOcupado = (start: number, end: number) =>
    ocupados.some(([oStart, oEnd]) => oStart < end && oEnd > start);

  for (let t = franjaStartMs; t + duracionMs <= franjaEndMs; t += step) {
    if (t <= nowMs) continue;
    if (isOcupado(t, t + duracionMs)) continue;
    out.push({ inicio: t, fin: t + duracionMs });
  }
  return out;
}

/**
 * ¿`inicioIso` coincide exactamente con el inicio de algún slot ofrecido?
 * (pura, testeable). Compara por instante (getTime) para tolerar distintas
 * representaciones ISO del mismo momento (Z vs -03:00).
 *
 * Defensa server-side del submit público: el cliente solo puede reservar
 * horarios que la grilla realmente ofrece — no timestamps arbitrarios
 * (madrugada, pasado, fuera de la disponibilidad del profesional).
 */
export function slotEstaOfrecido(slots: Slot[], inicioIso: string): boolean {
  const inicioMs = new Date(inicioIso).getTime();
  if (!Number.isFinite(inicioMs)) return false;
  return slots.some((s) => new Date(s.inicio).getTime() === inicioMs);
}

/**
 * Devuelve slots disponibles en un rango para un profesional, dada la
 * duración requerida por el servicio.
 */
export async function getSlotsDisponibles(input: {
  organizationId: string;
  profesionalId: string;
  duracionMin: number;
  rangeStart: Date;
  rangeEnd: Date;
  /** M43 · minutos de margen entre slots ofrecidos (no afecta conflictos). */
  margenMin?: number;
}): Promise<Slot[]> {
  const supabase = createSupabaseServiceClient();

  // Las 4 queries son independientes entre sí (solo dependen del input):
  // se despachan en paralelo (perf: 1 round-trip de latencia en vez de 4).
  const [
    { data: disps, error: dispsErr },
    { data: bloqueos, error: bloqueosErr },
    { data: turnos, error: turnosErr },
    { data: pedidos, error: pedidosErr },
  ] = await Promise.all([
    // 1. Disponibilidad del profesional (vigente y activa)
    supabase
      .from("disponibilidad_profesional")
      .select("dia_semana, hora_inicio, hora_fin, vigencia_desde, vigencia_hasta")
      .eq("organization_id", input.organizationId)
      .eq("member_id", input.profesionalId)
      .eq("activa", true),
    // 2. Bloqueos del rango
    supabase
      .from("bloqueo")
      .select("inicio, duracion_min")
      .eq("organization_id", input.organizationId)
      .eq("profesional_id", input.profesionalId)
      .gte("inicio", input.rangeStart.toISOString())
      .lt("inicio", input.rangeEnd.toISOString()),
    // 3. Turnos del rango (no cerrados/cancelados)
    supabase
      .from("turno")
      .select("inicio, duracion_min")
      .eq("organization_id", input.organizationId)
      .eq("profesional_id", input.profesionalId)
      .in("estado", ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO"])
      .gte("inicio", input.rangeStart.toISOString())
      .lt("inicio", input.rangeEnd.toISOString()),
    // 4. Pedidos pendientes con fecha en el rango (reservados tentativamente)
    supabase
      .from("pedido")
      .select("fecha_propuesta, duracion_min")
      .eq("organization_id", input.organizationId)
      .eq("estado", "PENDIENTE")
      .not("fecha_propuesta", "is", null)
      .gte("fecha_propuesta", input.rangeStart.toISOString())
      .lt("fecha_propuesta", input.rangeEnd.toISOString()),
  ]);

  // Un error de DB debe propagarse como falla (no como "sin slots"): de lo
  // contrario el booking público mostraría agenda vacía y rechazaría pacientes
  // reales ante un error transitorio. Se preserva el AvailabilityDbError POR
  // QUERY (mismo orden determinístico que la versión secuencial). Una agenda
  // sin disponibilidad configurada SÍ es un resultado legítimo de cero slots.
  if (dispsErr) throw new AvailabilityDbError(dispsErr.message);
  if (bloqueosErr) throw new AvailabilityDbError(bloqueosErr.message);
  if (turnosErr) throw new AvailabilityDbError(turnosErr.message);
  if (pedidosErr) throw new AvailabilityDbError(pedidosErr.message);
  if (!disps || disps.length === 0) return [];

  // Intervalos ocupados [startUtcMs, endUtcMs)
  type DispRow = {
    dia_semana: number;
    hora_inicio: string;
    hora_fin: string;
    vigencia_desde: string | null;
    vigencia_hasta: string | null;
  };
  type BloqueoRow = { inicio: string; duracion_min: number };
  type TurnoRow = { inicio: string; duracion_min: number };
  type PedidoRow = { fecha_propuesta: string; duracion_min: number };

  const ocupados: Array<[number, number]> = [
    ...((bloqueos as BloqueoRow[] | null) ?? []).map((b) => {
      const start = new Date(b.inicio).getTime();
      return [start, start + b.duracion_min * 60_000] as [number, number];
    }),
    ...((turnos as TurnoRow[] | null) ?? []).map((t) => {
      const start = new Date(t.inicio).getTime();
      return [start, start + t.duracion_min * 60_000] as [number, number];
    }),
    ...((pedidos as PedidoRow[] | null) ?? []).map((p) => {
      const start = new Date(p.fecha_propuesta).getTime();
      return [start, start + p.duracion_min * 60_000] as [number, number];
    }),
  ];

  // Iterar por día AR-calendar dentro del rango
  const slots: Slot[] = [];
  const dur = input.duracionMin * 60_000;
  const margenMs = Math.max(0, input.margenMin ?? 0) * 60_000;
  const now = Date.now();
  const rangeStartMs = input.rangeStart.getTime();
  const rangeEndMs = input.rangeEnd.getTime();

  // Cursor: arrancar en AR-midnight del día AR que contiene rangeStart
  let { y, m, d } = arCalendarDate(rangeStartMs);

  while (true) {
    const midnightUtcMs = arToUtcMs(y, m, d, 0, 0);
    if (midnightUtcMs >= rangeEndMs) break;

    const dayDateStr = arDateString(y, m, d);
    const dow = arCalendarDate(midnightUtcMs).dow;

    const dayDisps = (disps as DispRow[]).filter((dp) => {
      if (dp.dia_semana !== dow) return false;
      if (dp.vigencia_desde && dayDateStr < dp.vigencia_desde) return false;
      if (dp.vigencia_hasta && dayDateStr > dp.vigencia_hasta) return false;
      return true;
    });

    for (const disp of dayDisps) {
      const [hI, mI] = disp.hora_inicio.split(":").map(Number);
      const [hF, mF] = disp.hora_fin.split(":").map(Number);
      const franjaStartMs = arToUtcMs(y, m, d, hI, mI);
      const franjaEndMs = arToUtcMs(y, m, d, hF, mF);

      const franjaSlots = generateSlotsForFranja(
        franjaStartMs, franjaEndMs, dur, margenMs, now, ocupados,
      );
      for (const s of franjaSlots) {
        // Clamp al rango pedido (next 14d). El margen NO afecta este chequeo.
        if (s.inicio < rangeStartMs || s.fin > rangeEndMs) continue;
        slots.push({
          inicio: new Date(s.inicio).toISOString(),
          fin: new Date(s.fin).toISOString(),
        });
      }
    }

    // Avanzar al día AR siguiente
    d += 1;
    const next = new Date(Date.UTC(y, m, d));
    y = next.getUTCFullYear();
    m = next.getUTCMonth();
    d = next.getUTCDate();
  }

  return slots;
}
