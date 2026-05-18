/**
 * Folio · /calendario data fetcher (Sprint S1 T-1.5).
 *
 * Lee `turno_extendido` + `bloqueo` + `pedido` para la semana de un
 * `weekStartIso` (lunes ancla en TZ local de la org) y devuelve el shape
 * que consume `<Calendario />`.
 *
 * Responsabilidades:
 *   - Desencripta PII server-side (pacientes en turnos + solicitante en pedidos).
 *   - Mapea estado/canal/origen DB (uppercase) → UI legacy (lowercase).
 *   - Convierte `inicio` (timestamptz) a fecha "YYYY-MM-DD" + hora "HH:MM" en TZ.
 *   - DST-safe via Intl + offset probe.
 */

import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";
import type {
  Bloqueo,
  CanalPedido,
  EstadoTurno,
  OrigenTurno,
  Paciente,
  PacientesById,
  Pedido,
  TurnoSemana,
} from "@/lib/types";

// ─── Tipos de rows ──────────────────────────────────────────────────────────

interface TurnoExtendidoRow {
  id: string;
  organization_id: string;
  inicio: string;
  duracion_min: number;
  estado: "AGENDADO" | "CONFIRMADO" | "EN_SALA" | "ATENDIENDO" | "CERRADO" | "NO_ASISTIO" | "CANCELADO" | "REAGENDADO";
  origen: "MANUAL" | "BOOKING" | "WALK_IN" | "GOOGLE" | "WHATSAPP";
  paciente_id: string;
  paciente_nombre_cifrado: string | null;
  paciente_apellido_cifrado: string | null;
  paciente_telefono_cifrado: string | null;
  paciente_tipo: "ACTIVO" | "INACTIVO" | "EN_ESPERA" | "NUEVO";
  paciente_tags: string[] | null;
  paciente_alerta_alergia: boolean;
  servicio_nombre: string;
}

interface BloqueoRow {
  id: string;
  inicio: string;
  duracion_min: number;
  titulo: string | null;
  origen: "google" | "manual";
}

interface PedidoRow {
  id: string;
  canal: "WEB" | "WHATSAPP" | "INSTAGRAM" | "TELEFONO";
  estado: "PENDIENTE" | "CONFIRMADO" | "RECHAZADO" | "REAGENDADO";
  nombre_cifrado: string | null;
  telefono_cifrado: string | null;
  email_cifrado: string | null;
  paciente_id: string | null;
  fecha_propuesta: string | null;
  duracion_min: number;
  servicio_id: string | null;
  motivo_cifrado: string | null;
  precio_cents: number | null;
  recibido_ts: string;
  confirmado_ts: string | null;
}

// ─── Mapeos enum ───────────────────────────────────────────────────────────

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

const CANAL_DB_TO_UI: Record<PedidoRow["canal"], CanalPedido> = {
  WEB: "web",
  WHATSAPP: "whatsapp",
  INSTAGRAM: "instagram",
  TELEFONO: "telefono",
};

// ─── Output shape ──────────────────────────────────────────────────────────

export interface CalendarioSemanaData {
  weekStartIso: string;            // "YYYY-MM-DD" lunes
  weekEndIso: string;              // "YYYY-MM-DD" domingo
  weekDates: string[];             // 7 ISO dates (lun..dom)
  weekRangeLabel: string;          // "11 – 17 may 2026"
  hoyIso: string;                  // YYYY-MM-DD en TZ
  nowHHMM: string;                 // "HH:MM" actual en TZ
  turnos: TurnoSemana[];
  bloqueos: Bloqueo[];
  pedidos: Pedido[];               // solo pendientes + reagendados
  pacientes: PacientesById;
}

interface FetcherInput {
  organizationId: string;
  weekStartIso: string;            // lunes "YYYY-MM-DD"
  timezone: string;
  profesionalId?: string | null;
}

// ─── Fetcher ───────────────────────────────────────────────────────────────

export async function getCalendarioSemana(input: FetcherInput): Promise<Result<CalendarioSemanaData>> {
  const { organizationId, weekStartIso, timezone, profesionalId } = input;
  const tz = timezone || "America/Argentina/Cordoba";
  const supabase = await createSupabaseServerClient();

  const { startUtc, endUtc } = computeWeekRangeUtc(weekStartIso, tz);

  // 3 queries en paralelo: turnos, bloqueos, pedidos.
  const [turnosRes, bloqueosRes, pedidosRes] = await Promise.all([
    (async () => {
      let q = supabase
        .from("turno_extendido")
        .select(
          "id, organization_id, inicio, duracion_min, estado, origen, " +
            "paciente_id, paciente_nombre_cifrado, paciente_apellido_cifrado, paciente_telefono_cifrado, " +
            "paciente_tipo, paciente_tags, paciente_alerta_alergia, servicio_nombre",
        )
        .eq("organization_id", organizationId)
        .gte("inicio", startUtc)
        .lt("inicio", endUtc)
        .order("inicio", { ascending: true });
      if (profesionalId) q = q.eq("profesional_id", profesionalId);
      return q;
    })(),
    (async () => {
      let q = supabase
        .from("bloqueo")
        .select("id, inicio, duracion_min, titulo, origen")
        .eq("organization_id", organizationId)
        .gte("inicio", startUtc)
        .lt("inicio", endUtc)
        .order("inicio", { ascending: true });
      if (profesionalId) q = q.eq("profesional_id", profesionalId);
      return q;
    })(),
    supabase
      .from("pedido")
      .select(
        "id, canal, estado, nombre_cifrado, telefono_cifrado, email_cifrado, paciente_id, " +
          "fecha_propuesta, duracion_min, servicio_id, motivo_cifrado, precio_cents, recibido_ts, confirmado_ts",
      )
      .eq("organization_id", organizationId)
      .in("estado", ["PENDIENTE", "REAGENDADO"])
      .order("recibido_ts", { ascending: false }),
  ]);

  if (turnosRes.error) return err("db_error", "Error leyendo turnos.", turnosRes.error.message);
  if (bloqueosRes.error) return err("db_error", "Error leyendo bloqueos.", bloqueosRes.error.message);
  if (pedidosRes.error) return err("db_error", "Error leyendo pedidos.", pedidosRes.error.message);

  const turnoRows = (turnosRes.data ?? []) as unknown as TurnoExtendidoRow[];
  const bloqueoRows = (bloqueosRes.data ?? []) as unknown as BloqueoRow[];
  const pedidoRows = (pedidosRes.data ?? []) as unknown as PedidoRow[];

  // Convertir turnos + acumular pacientes.
  const pacientesAcum = new Map<string, Paciente>();
  const turnos: TurnoSemana[] = turnoRows.map((row) => {
    if (!pacientesAcum.has(row.paciente_id)) {
      pacientesAcum.set(row.paciente_id, turnoRowToPaciente(row));
    }
    return {
      id: row.id,
      fecha: ymdInTz(row.inicio, tz),
      hora: hhmmInTz(row.inicio, tz),
      dur: row.duracion_min,
      pacienteId: row.paciente_id,
      servicio: row.servicio_nombre,
      estado: ESTADO_DB_TO_UI[row.estado],
      origen: ORIGEN_DB_TO_UI[row.origen],
    };
  });

  const bloqueos: Bloqueo[] = bloqueoRows.map((row) => ({
    fecha: ymdInTz(row.inicio, tz),
    hora: hhmmInTz(row.inicio, tz),
    dur: row.duracion_min,
    titulo: row.titulo ?? "Sin título",
    origen: row.origen === "google" ? "google" : "manual",
  }));

  const pedidos: Pedido[] = pedidoRows.map((row) => {
    const nombre = tryDecrypt(row.nombre_cifrado, `pedido.${row.id}.nombre`) ?? "Sin nombre";
    const tel = tryDecrypt(row.telefono_cifrado, `pedido.${row.id}.tel`) ?? "";
    const email = tryDecrypt(row.email_cifrado, `pedido.${row.id}.email`);
    const motivo = tryDecrypt(row.motivo_cifrado, `pedido.${row.id}.motivo`) ?? "";

    return {
      id: row.id,
      canal: CANAL_DB_TO_UI[row.canal],
      estado: row.estado === "PENDIENTE" ? "pendiente"
        : row.estado === "CONFIRMADO" ? "confirmado"
        : row.estado === "RECHAZADO" ? "rechazado"
        : "reagendado",
      nombre,
      tel,
      email: email ?? undefined,
      nuevo: row.paciente_id == null,
      pacienteId: row.paciente_id ?? undefined,
      fecha: row.fecha_propuesta ? ymdInTz(row.fecha_propuesta, tz) : null,
      hora: row.fecha_propuesta ? hhmmInTz(row.fecha_propuesta, tz) : null,
      dur: row.duracion_min,
      servicio: "—",
      precio: Math.round((row.precio_cents ?? 0) / 100),
      motivo,
      recibidoHace: relativeFromNow(row.recibido_ts),
      confirmadoEn: row.confirmado_ts ?? undefined,
    };
  });

  const weekDates = enumerateWeekDates(weekStartIso);
  const weekRangeLabel = formatWeekRangeLabel(weekStartIso, weekDates[6]);

  const nowDate = new Date();
  const hoyIso = ymdInTz(nowDate.toISOString(), tz);
  const nowHHMM = hhmmInTz(nowDate.toISOString(), tz);

  return ok({
    weekStartIso,
    weekEndIso: weekDates[6],
    weekDates,
    weekRangeLabel,
    hoyIso,
    nowHHMM,
    turnos,
    bloqueos,
    pedidos,
    pacientes: Object.fromEntries(pacientesAcum.entries()),
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function turnoRowToPaciente(row: TurnoExtendidoRow): Paciente {
  const nombre = tryDecrypt(row.paciente_nombre_cifrado, `paciente.${row.paciente_id}.nombre`);
  const apellido = tryDecrypt(row.paciente_apellido_cifrado, `paciente.${row.paciente_id}.apellido`);
  const telefono = tryDecrypt(row.paciente_telefono_cifrado, `paciente.${row.paciente_id}.telefono`);
  const fullName = [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente sin nombre";

  // tipo_paciente DB enum: 'NUEVO' | 'ACTIVO' | 'INACTIVO' | 'EN_ESPERA' — mapeamos a UI legacy.
  const tipo: Paciente["tipo"] =
    row.paciente_tipo === "ACTIVO" ? "recurrente"
    : row.paciente_tipo === "EN_ESPERA" ? "recurrente"
    : "nuevo";

  return {
    nombre: fullName,
    tipo,
    sesiones: 0,
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

function tryDecrypt(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  try {
    return decryptColumn(value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[calendario] decrypt falló (${label}): ${msg}`);
    return null;
  }
}

// ─── Time / TZ helpers ─────────────────────────────────────────────────────

function ymdInTz(isoTs: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(isoTs));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function hhmmInTz(isoTs: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(isoTs)).replace("24:", "00:");
  } catch {
    return new Date(isoTs).toISOString().slice(11, 16);
  }
}

function computeWeekRangeUtc(weekStartIso: string, timezone: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = weekStartIso.split("-").map(Number);
  const start = wallClockInTzToUtc(y, m, d, 0, 0, 0, timezone);
  const end = wallClockInTzToUtc(y, m, d + 7, 0, 0, 0, timezone);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

function wallClockInTzToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timeZone: string,
): Date {
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = getTzOffsetMs(new Date(baseUtc), timeZone);
  let utc = new Date(baseUtc - offsetMs);
  const offsetMs2 = getTzOffsetMs(utc, timeZone);
  if (offsetMs2 !== offsetMs) utc = new Date(baseUtc - offsetMs2);
  return utc;
}

function getTzOffsetMs(utcDate: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utcDate);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asTzUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asTzUtcMs - utcDate.getTime();
}

function enumerateWeekDates(weekStartIso: string): string[] {
  const [y, m, d] = weekStartIso.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

const MESES_ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatWeekRangeLabel(startIso: string, endIso: string): string {
  const [y1, m1, d1] = startIso.split("-").map(Number);
  const [, m2, d2] = endIso.split("-").map(Number);
  if (m1 === m2) {
    return `${d1} – ${d2} ${MESES_ABREV[m1 - 1]} ${y1}`;
  }
  return `${d1} ${MESES_ABREV[m1 - 1]} – ${d2} ${MESES_ABREV[m2 - 1]} ${y1}`;
}

function relativeFromNow(isoTs: string): string {
  const diffMs = Date.now() - new Date(isoTs).getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMin < 1) return "recién";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} ${diffH === 1 ? "hora" : "horas"}`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD} ${diffD === 1 ? "día" : "días"}`;
}

// ─── Lunes-anchor helper (para nav del calendario) ────────────────────────

/**
 * Dado una fecha ISO arbitraria, devuelve el "lunes anchor" (YYYY-MM-DD)
 * de la semana ISO 8601 que contiene esa fecha, en la TZ dada.
 */
export function getMondayOfWeekInTz(isoDateOrNull: string | null, timezone: string): string {
  const tz = timezone || "America/Argentina/Cordoba";
  let baseIso: string;
  if (isoDateOrNull && /^\d{4}-\d{2}-\d{2}$/.test(isoDateOrNull)) {
    baseIso = isoDateOrNull;
  } else {
    baseIso = ymdInTz(new Date().toISOString(), tz);
  }
  // Calcular día de semana del baseIso vía mediodía UTC (no cruza día con tz local).
  const [y, m, d] = baseIso.split("-").map(Number);
  const utcMidday = Date.UTC(y, m - 1, d, 12, 0, 0);
  const dow = new Date(utcMidday).getUTCDay(); // 0 dom..6 sab
  const offset = (dow + 6) % 7; // 0 si lunes
  const mondayUtc = new Date(Date.UTC(y, m - 1, d - offset));
  const yy = mondayUtc.getUTCFullYear();
  const mm = String(mondayUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(mondayUtc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Avanza/retrocede N semanas a partir de un lunes ISO. */
export function shiftWeek(weekStartIso: string, deltaWeeks: number): string {
  const [y, m, d] = weekStartIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaWeeks * 7));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
