/**
 * Folio · /hoy data fetcher (Sprint S1 T-1.4).
 *
 * Lee `turno_extendido` (vista M14) para la fecha local del consultorio y
 * devuelve el shape que consume el Client Component `<Dashboard />`:
 *   { turnos: Turno[], pacientes: PacientesById }
 *
 * Responsabilidades:
 *   - Desencripta PII de paciente server-side (nombre/apellido/telefono).
 *   - Mapea estado uppercase (DB) → lowercase (UI legacy).
 *   - Convierte timestamptz `inicio` a "HH:MM" en la timezone de la org.
 *   - Computa `postVisita.guardada` desde existencia de sesion + completion.
 *
 * El cliente nunca recibe el ciphertext. RLS sobre `turno_extendido`
 * (security_invoker=true) garantiza que solo se devuelven turnos del scope
 * del rol activo.
 */

import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";
import type { Paciente, PacientesById, EstadoTurno, OrigenTurno, PostVisita, Turno } from "@/lib/types";

// ─── Tipo de fila de turno_extendido ───────────────────────────────────────

interface TurnoExtendidoRow {
  id: string;
  organization_id: string;
  inicio: string; // timestamptz ISO
  duracion_min: number;
  estado: "AGENDADO" | "CONFIRMADO" | "EN_SALA" | "ATENDIENDO" | "CERRADO" | "NO_ASISTIO" | "CANCELADO" | "REAGENDADO";
  origen: "MANUAL" | "BOOKING" | "WALK_IN" | "GOOGLE" | "WHATSAPP";
  precio_cents: number;
  gcal_event_id: string | null;
  atendiendo_desde: string | null;
  duracion_real_min: number | null;
  paciente_id: string;
  paciente_nombre_cifrado: string | null;
  paciente_apellido_cifrado: string | null;
  paciente_telefono_cifrado: string | null;
  paciente_tipo: "ACTIVO" | "INACTIVO" | "EN_ESPERA";
  paciente_tags: string[] | null;
  paciente_alerta_alergia: boolean;
  servicio_nombre: string;
  servicio_tipo_canonico: string;
  pago_id: string | null;
  profesional_id: string;
}

// ─── Mapeos enum DB → UI ───────────────────────────────────────────────────

const ESTADO_DB_TO_UI: Record<TurnoExtendidoRow["estado"], EstadoTurno> = {
  AGENDADO: "agendado",
  CONFIRMADO: "confirmado",
  EN_SALA: "en_sala",
  ATENDIENDO: "atendiendo",
  CERRADO: "cerrado",
  NO_ASISTIO: "no_asistio",
  CANCELADO: "cancelado",
  REAGENDADO: "reagendado",
};

const ORIGEN_DB_TO_UI: Record<TurnoExtendidoRow["origen"], OrigenTurno> = {
  MANUAL: "manual",
  BOOKING: "web",
  WALK_IN: "walk_in",
  GOOGLE: "google",
  WHATSAPP: "whatsapp",
};

// ─── Conversión timestamptz → "HH:MM" en zona horaria de la org ───────────

function horaEnTz(isoTs: string, timezone: string): string {
  // Intl.DateTimeFormat respeta IANA timezone names; cae en UTC si la zona
  // no es válida (defensivo). Para Folio defaultea a America/Argentina/Buenos_Aires.
  try {
    const formatter = new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone || "America/Argentina/Buenos_Aires",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // Algunos locales formatean "24:00" en lugar de "00:00"; normalizamos.
    return formatter.format(new Date(isoTs)).replace("24:", "00:");
  } catch {
    return new Date(isoTs).toISOString().slice(11, 16);
  }
}

// ─── Fetcher principal ─────────────────────────────────────────────────────

export interface DashboardHoyData {
  turnos: Turno[];
  pacientes: PacientesById;
  fechaIso: string;
  fechaLarga: string;
  fechaAnio: number;
}

interface FetcherInput {
  organizationId: string;
  /** Fecha local del consultorio en formato YYYY-MM-DD. */
  fechaIso: string;
  /** IANA timezone de la org (ej. "America/Argentina/Buenos_Aires"). */
  timezone: string;
  /** Si está seteado, filtra turnos solo del profesional indicado. */
  profesionalId?: string | null;
  /**
   * member.id → display name. Si viene, cada Turno sale con
   * `profesionalNombre` (atribución visual en vista "Todos" multi-colegiado).
   * Ausente → profesionalNombre null y el render histórico no cambia.
   */
  profesionalesNombreById?: Record<string, string>;
}

export async function getDashboardHoy(input: FetcherInput): Promise<Result<DashboardHoyData>> {
  const { organizationId, fechaIso, timezone, profesionalId, profesionalesNombreById } = input;
  const supabase = await createSupabaseServerClient();

  // Rango UTC equivalente a [00:00, 24:00) en la zona horaria de la org.
  // Conversión via UTC offset es propensa a DST issues; usamos `tz_to_utc_range`
  // calculado en JS pasando la fecha pivot a Intl.
  const { startUtc, endUtc } = computeDayRangeUtc(fechaIso, timezone);

  let query = supabase
    .from("turno_extendido")
    .select(
      "id, organization_id, inicio, duracion_min, estado, origen, precio_cents, " +
        "gcal_event_id, atendiendo_desde, duracion_real_min, " +
        "paciente_id, paciente_nombre_cifrado, paciente_apellido_cifrado, paciente_telefono_cifrado, " +
        "paciente_tipo, paciente_tags, paciente_alerta_alergia, " +
        "servicio_nombre, servicio_tipo_canonico, pago_id, profesional_id",
    )
    .eq("organization_id", organizationId)
    .gte("inicio", startUtc)
    .lt("inicio", endUtc)
    .order("inicio", { ascending: true });

  if (profesionalId) {
    query = query.eq("profesional_id", profesionalId);
  }

  const { data, error } = await query;
  if (error) return err("db_error", "Error leyendo agenda del día.", error.message);

  const rows = (data ?? []) as unknown as TurnoExtendidoRow[];

  // Si hay turnos cerrados, levantamos las sesiones existentes para saber si
  // ya tienen post-visita registrada (M10: sesion.turno_id 1:1 con turno).
  const turnoIdsCerrados = rows.filter((r) => r.estado === "CERRADO").map((r) => r.id);
  const postVisitaByTurno = await loadPostVisitaFlags(turnoIdsCerrados, organizationId);

  // Agrupar pacientes únicos (set + desencripción una sola vez por paciente).
  const pacientesAcum = new Map<string, Paciente>();

  const turnos: Turno[] = rows.map((row) => {
    if (!pacientesAcum.has(row.paciente_id)) {
      pacientesAcum.set(row.paciente_id, rowToPaciente(row));
    }
    return rowToTurno(row, postVisitaByTurno.get(row.id) ?? null, timezone, profesionalesNombreById);
  });

  const pacientes: PacientesById = Object.fromEntries(pacientesAcum.entries());

  // Construir labels de fecha para PageHeader.
  const { fechaLarga, fechaAnio } = formatFechaLarga(fechaIso, timezone);

  return ok({ turnos, pacientes, fechaIso, fechaLarga, fechaAnio });
}

// ─── Helpers internos ──────────────────────────────────────────────────────

async function loadPostVisitaFlags(
  turnoIds: string[],
  organizationId: string,
): Promise<Map<string, { guardada: boolean }>> {
  const out = new Map<string, { guardada: boolean }>();
  if (turnoIds.length === 0) return out;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sesion")
    .select("turno_id, soap_s_cifrado, soap_o_cifrado, soap_a_cifrado, soap_p_cifrado")
    .eq("organization_id", organizationId)
    .in("turno_id", turnoIds);

  for (const r of (data ?? []) as unknown as Array<{
    turno_id: string;
    soap_s_cifrado: string | null;
    soap_o_cifrado: string | null;
    soap_a_cifrado: string | null;
    soap_p_cifrado: string | null;
  }>) {
    const guardada = !!(r.soap_s_cifrado || r.soap_o_cifrado || r.soap_a_cifrado || r.soap_p_cifrado);
    out.set(r.turno_id, { guardada });
  }
  return out;
}

function rowToPaciente(row: TurnoExtendidoRow): Paciente {
  const nombre = tryDecrypt(row.paciente_nombre_cifrado, `paciente.${row.paciente_id}.nombre`);
  const apellido = tryDecrypt(row.paciente_apellido_cifrado, `paciente.${row.paciente_id}.apellido`);
  const telefono = tryDecrypt(row.paciente_telefono_cifrado, `paciente.${row.paciente_id}.telefono`);
  const fullName = [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente sin nombre";

  return {
    nombre: fullName,
    tipo: row.paciente_tipo === "ACTIVO" ? "recurrente" : "nuevo",
    sesiones: 0, // se computa server-side en otra ruta; en /hoy no lo necesitamos para el render
    edad: 0,
    genero: "M",
    motivo: "",
    tags: row.paciente_tags ?? [],
    notasImportantes: row.paciente_alerta_alergia
      ? "Alergias severas registradas — revisar ficha antes de medicar."
      : "",
    telefono: telefono ?? "",
  };
}

function rowToTurno(
  row: TurnoExtendidoRow,
  postVisitaFlag: { guardada: boolean } | null,
  timezone: string,
  profesionalesNombreById?: Record<string, string>,
): Turno {
  const estado = ESTADO_DB_TO_UI[row.estado];
  const origen = ORIGEN_DB_TO_UI[row.origen];
  const postVisita: PostVisita = postVisitaFlag
    ? { guardada: postVisitaFlag.guardada }
    : { guardada: false };

  return {
    id: row.id,
    hora: horaEnTz(row.inicio, timezone),
    pacienteId: row.paciente_id,
    servicio: row.servicio_nombre,
    precio: Math.round((row.precio_cents ?? 0) / 100),
    estado,
    duracionMin: row.duracion_real_min ?? row.duracion_min ?? null,
    duracionRealMin: row.duracion_real_min ?? null,
    atendiendoDesde: row.atendiendo_desde ?? null,
    postVisita,
    gcal: !!row.gcal_event_id,
    origen,
    cobro: row.pago_id ? { estado: "pagado", ts: null } : { estado: "pendiente", ts: null },
    profesionalId: row.profesional_id ?? null,
    profesionalNombre: profesionalesNombreById?.[row.profesional_id] ?? null,
  };
}

function tryDecrypt(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  try {
    return decryptColumn(value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[hoy] decrypt falló (${label}): ${msg}. len=${value.length}`);
    return null;
  }
}

// ─── Time helpers ──────────────────────────────────────────────────────────

/**
 * Calcula el rango UTC `[startUtc, endUtc)` que corresponde al día calendario
 * `fechaIso` en la zona horaria `timezone`. Maneja DST porque usamos
 * Intl para resolver el offset en cada borde.
 */
function computeDayRangeUtc(fechaIso: string, timezone: string): { startUtc: string; endUtc: string } {
  const tz = timezone || "America/Argentina/Buenos_Aires";
  const [y, m, d] = fechaIso.split("-").map(Number);
  // Strategy: pick a tentative midnight in the tz; convert to UTC by computing
  // tz offset at that wall-clock time via Intl.
  const tentativeStart = wallClockInTzToUtc(y, m, d, 0, 0, 0, tz);
  const tentativeEnd = wallClockInTzToUtc(y, m, d + 1, 0, 0, 0, tz);
  return { startUtc: tentativeStart.toISOString(), endUtc: tentativeEnd.toISOString() };
}

/**
 * Devuelve la fecha UTC que corresponde a una wall-clock dada en una IANA
 * timezone. Algoritmo:
 *   1. Toma como punto de partida la fecha como si fuera UTC.
 *   2. Calcula la diferencia entre la wall-clock leída en la tz y la deseada.
 *   3. Aplica el offset.
 *   4. Repite una vez para corregir transiciones DST.
 */
function wallClockInTzToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timeZone: string,
): Date {
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = getTzOffsetMs(new Date(baseUtc), timeZone);
  let utc = new Date(baseUtc - offsetMs);
  // Corrección de un paso (DST boundary): si el offset cambia entre tentativa y final, re-aplicar.
  const offsetMs2 = getTzOffsetMs(utc, timeZone);
  if (offsetMs2 !== offsetMs) {
    utc = new Date(baseUtc - offsetMs2);
  }
  return utc;
}

function getTzOffsetMs(utcDate: Date, timeZone: string): number {
  // Formatear utcDate como wall-clock en tz y compararlo contra el utc original.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utcDate);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asTzUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asTzUtcMs - utcDate.getTime();
}

const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatFechaLarga(fechaIso: string, timezone: string): { fechaLarga: string; fechaAnio: number } {
  const [y, m, d] = fechaIso.split("-").map(Number);
  // Día de la semana resuelto en la tz: usar mediodía para evitar borde.
  const utcMidday = wallClockInTzToUtc(y, m, d, 12, 0, 0, timezone || "America/Argentina/Buenos_Aires");
  const dow = utcMidday.getUTCDay();
  return {
    fechaLarga: `${DIAS_ES[dow]} ${d} de ${MESES_ES[m - 1]}`,
    fechaAnio: y,
  };
}

/** Devuelve YYYY-MM-DD del "hoy" según la timezone provista. */
export function fechaHoyEnTz(timezone: string): string {
  const tz = timezone || "America/Argentina/Buenos_Aires";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}
