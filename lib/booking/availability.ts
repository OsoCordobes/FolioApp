/**
 * Folio · cálculo de slots disponibles para booking público.
 *
 * Algoritmo:
 *   1. Obtener `disponibilidad_profesional` activa del member (días + franjas + slot_min).
 *   2. Generar todos los slots posibles en el rango (next 14 days).
 *   3. Restar `turno` agendados/confirmados/en_sala/atendiendo (excluyendo CERRADO/NO_ASISTIO).
 *   4. Restar `bloqueo` (Google Calendar events).
 *   5. Restar `pedido` PENDIENTE para ese slot (evita doble booking accidental).
 *
 * El servicio determina la duración del slot necesario.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface Slot {
  inicio: string;                               // ISO datetime
  fin: string;
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

  // 1. Disponibilidad del profesional
  const { data: disps } = await supabase
    .from("disponibilidad_profesional")
    .select("*")
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

  // Helper: intervalo ocupado?
  const ocupados: Array<[number, number]> = [
    ...(bloqueos ?? []).map((b: { inicio: string; duracion_min: number }) => {
      const start = new Date(b.inicio).getTime();
      return [start, start + b.duracion_min * 60_000] as [number, number];
    }),
    ...(turnos ?? []).map((t: { inicio: string; duracion_min: number }) => {
      const start = new Date(t.inicio).getTime();
      return [start, start + t.duracion_min * 60_000] as [number, number];
    }),
    ...(pedidos ?? []).map((p: { fecha_propuesta: string; duracion_min: number }) => {
      const start = new Date(p.fecha_propuesta).getTime();
      return [start, start + p.duracion_min * 60_000] as [number, number];
    }),
  ];

  const isOcupado = (start: number, end: number) =>
    ocupados.some(([oStart, oEnd]) => oStart < end && oEnd > start);

  // Generar slots a partir de disponibilidad
  const slots: Slot[] = [];
  const cursor = new Date(input.rangeStart);
  const dur = input.duracionMin * 60_000;

  while (cursor < input.rangeEnd) {
    const dow = cursor.getDay();
    const dayDisps = disps.filter((d: { dia_semana: number }) => d.dia_semana === dow);
    if (dayDisps.length === 0) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    for (const disp of dayDisps as Array<{ hora_inicio: string; hora_fin: string }>) {
      const [hInicio, mInicio] = disp.hora_inicio.split(":").map(Number);
      const [hFin, mFin] = disp.hora_fin.split(":").map(Number);
      const inicioFranja = new Date(cursor);
      inicioFranja.setHours(hInicio, mInicio, 0, 0);
      const finFranja = new Date(cursor);
      finFranja.setHours(hFin, mFin, 0, 0);

      let t = inicioFranja.getTime();
      while (t + dur <= finFranja.getTime()) {
        if (t > Date.now() && !isOcupado(t, t + dur)) {
          slots.push({
            inicio: new Date(t).toISOString(),
            fin: new Date(t + dur).toISOString(),
          });
        }
        t += dur;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return slots;
}
