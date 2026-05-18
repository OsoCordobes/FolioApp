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
 * Devuelve slots disponibles en un rango para un profesional, dada la
 * duración requerida por el servicio.
 */
export async function getSlotsDisponibles(input: {
  organizationId: string;
  profesionalId: string;
  duracionMin: number;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<Slot[]> {
  const supabase = createSupabaseServiceClient();

  // 1. Disponibilidad del profesional (vigente y activa)
  const { data: disps } = await supabase
    .from("disponibilidad_profesional")
    .select("dia_semana, hora_inicio, hora_fin, vigencia_desde, vigencia_hasta")
    .eq("organization_id", input.organizationId)
    .eq("member_id", input.profesionalId)
    .eq("activa", true);

  if (!disps || disps.length === 0) return [];

  // 2. Bloqueos del rango
  const { data: bloqueos } = await supabase
    .from("bloqueo")
    .select("inicio, duracion_min")
    .eq("organization_id", input.organizationId)
    .eq("profesional_id", input.profesionalId)
    .gte("inicio", input.rangeStart.toISOString())
    .lt("inicio", input.rangeEnd.toISOString());

  // 3. Turnos del rango (no cerrados/cancelados)
  const { data: turnos } = await supabase
    .from("turno")
    .select("inicio, duracion_min")
    .eq("organization_id", input.organizationId)
    .eq("profesional_id", input.profesionalId)
    .in("estado", ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO"])
    .gte("inicio", input.rangeStart.toISOString())
    .lt("inicio", input.rangeEnd.toISOString());

  // 4. Pedidos pendientes con fecha en el rango (reservados tentativamente)
  const { data: pedidos } = await supabase
    .from("pedido")
    .select("fecha_propuesta, duracion_min")
    .eq("organization_id", input.organizationId)
    .eq("estado", "PENDIENTE")
    .not("fecha_propuesta", "is", null)
    .gte("fecha_propuesta", input.rangeStart.toISOString())
    .lt("fecha_propuesta", input.rangeEnd.toISOString());

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

  const isOcupado = (start: number, end: number) =>
    ocupados.some(([oStart, oEnd]) => oStart < end && oEnd > start);

  // Iterar por día AR-calendar dentro del rango
  const slots: Slot[] = [];
  const dur = input.duracionMin * 60_000;
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

      for (let t = franjaStartMs; t + dur <= franjaEndMs; t += dur) {
        if (t <= now) continue;
        if (t < rangeStartMs || t + dur > rangeEndMs) continue;
        if (isOcupado(t, t + dur)) continue;
        slots.push({
          inicio: new Date(t).toISOString(),
          fin: new Date(t + dur).toISOString(),
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
