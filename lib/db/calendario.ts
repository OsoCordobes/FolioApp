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
  profesional_id: string;
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

// ─── Días cerrados (vista semanal) ─────────────────────────────────────────

/** Franja de disponibilidad_profesional relevante para decidir días cerrados. */
export interface DisponibilidadVigencia {
  /** 0=domingo … 6=sábado (convención DB de disponibilidad_profesional, M02). */
  diaSemana: number;
  /** "YYYY-MM-DD". */
  vigenciaDesde: string;
  /** "YYYY-MM-DD" o null (sin fin). */
  vigenciaHasta: string | null;
}

/**
 * `deriveDiasCerrados` — función pura (testeable sin DB) que decide qué
 * columnas de la vista semanal se pintan "Cerrado".
 *
 * Reglas (alineadas al baseline visual, que pinta SOLO sáb/dom en gris):
 *   - Lun–vie NUNCA se marcan cerrados (idéntico al render histórico).
 *   - Sáb/dom se marcan cerrados SALVO que:
 *       a) exista una franja activa de disponibilidad_profesional para ese
 *          día de semana, vigente en esa fecha (vigencia_desde/hasta), o
 *       b) haya eventos ese día (turnos/bloqueos/pedidos) — un día con
 *          agenda nunca se esconde detrás del overlay gris.
 *
 * Si la org no tiene disponibilidad de finde y no hay eventos, el resultado
 * es [false ×5, true, true] — exactamente el hardcode anterior (i===5||i===6).
 *
 * @param weekDates 7 fechas ISO lun..dom (índice 0=LUN … 6=DOM).
 * @param disponibilidad franjas activas de la org (cualquier profesional).
 * @param fechasConEventos fechas "YYYY-MM-DD" con turnos/bloqueos/pedidos.
 */
export function deriveDiasCerrados(
  weekDates: string[],
  disponibilidad: DisponibilidadVigencia[],
  fechasConEventos: ReadonlySet<string>,
): boolean[] {
  return weekDates.map((iso, i) => {
    const esFinde = i === 5 || i === 6;
    if (!esFinde) return false;
    if (fechasConEventos.has(iso)) return false;
    // Índice UI (0=lun..6=dom) → convención DB (0=dom..6=sáb).
    const dowDb = (i + 1) % 7;
    const tieneFranja = disponibilidad.some(
      (f) =>
        f.diaSemana === dowDb &&
        f.vigenciaDesde <= iso &&
        (f.vigenciaHasta == null || f.vigenciaHasta >= iso),
    );
    return !tieneFranja;
  });
}

// ─── Capacidad del día (vista semanal) ─────────────────────────────────────

/** Franja con horario, para computar minutos de capacidad del día. */
export interface FranjaDisponibilidad extends DisponibilidadVigencia {
  /** "HH:MM" 24h (CHECK disp_hora_format, M02). */
  horaInicio: string;
  /** "HH:MM" 24h, > horaInicio (CHECK disp_orden, M02). */
  horaFin: string;
}

function franjaMinutos(horaInicio: string, horaFin: string): number {
  const [hi, mi] = horaInicio.split(":").map(Number);
  const [hf, mf] = horaFin.split(":").map(Number);
  return Math.max(0, hf * 60 + mf - (hi * 60 + mi));
}

/**
 * `deriveCapacidadSemana` — función pura: minutos de disponibilidad real por
 * día de la semana (índice 0=LUN..6=DOM), sumando TODAS las franjas vigentes
 * recibidas. El caller decide el universo de franjas:
 *   - filtro de profesional activo → solo SUS franjas (capacidad personal);
 *   - vista "Todos" → franjas de toda la org (suma de los colegiados — 3
 *     médicos en paralelo NO saturan el 100% con la agenda de uno).
 *
 * Devuelve `null` para un día SIN franja vigente: el caller cae al
 * denominador histórico (600 min) y el render no cambia para orgs sin
 * disponibilidad cargada.
 *
 * @param weekDates 7 fechas ISO lun..dom (índice 0=LUN … 6=DOM).
 * @param franjas franjas activas con horario y vigencia.
 */
export function deriveCapacidadSemana(
  weekDates: string[],
  franjas: FranjaDisponibilidad[],
): Array<number | null> {
  return weekDates.map((iso, i) => {
    // Índice UI (0=lun..6=dom) → convención DB (0=dom..6=sáb).
    const dowDb = (i + 1) % 7;
    const vigentes = franjas.filter(
      (f) =>
        f.diaSemana === dowDb &&
        f.vigenciaDesde <= iso &&
        (f.vigenciaHasta == null || f.vigenciaHasta >= iso),
    );
    if (vigentes.length === 0) return null;
    const total = vigentes.reduce((acc, f) => acc + franjaMinutos(f.horaInicio, f.horaFin), 0);
    return total > 0 ? total : null;
  });
}

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
  /** Por índice de weekDates (0=LUN..6=DOM): true = columna "Cerrado". */
  diasCerrados: boolean[];
  /**
   * Minutos de disponibilidad real por día (0=LUN..6=DOM); null = sin franja
   * vigente ese día → la UI cae al denominador histórico (600 min).
   * Con filtro de profesional: SU capacidad; en "Todos": suma org-wide.
   */
  capacidadDiaMin: Array<number | null>;
}

interface FetcherInput {
  organizationId: string;
  weekStartIso: string;            // lunes "YYYY-MM-DD"
  timezone: string;
  profesionalId?: string | null;
  /**
   * member.id → display name. Si viene, cada TurnoSemana sale con
   * `profesionalNombre` (atribución en vista "Todos" multi-colegiado).
   */
  profesionalesNombreById?: Record<string, string>;
}

// ─── Fetcher ───────────────────────────────────────────────────────────────

export async function getCalendarioSemana(input: FetcherInput): Promise<Result<CalendarioSemanaData>> {
  const { organizationId, weekStartIso, timezone, profesionalId, profesionalesNombreById } = input;
  const tz = timezone || "America/Argentina/Cordoba";
  const supabase = await createSupabaseServerClient();

  const { startUtc, endUtc } = computeWeekRangeUtc(weekStartIso, tz);

  // 4 queries en paralelo: turnos, bloqueos, pedidos, disponibilidad.
  const [turnosRes, bloqueosRes, pedidosRes, dispRes] = await Promise.all([
    (async () => {
      let q = supabase
        .from("turno_extendido")
        .select(
          "id, organization_id, inicio, duracion_min, estado, origen, " +
            "paciente_id, paciente_nombre_cifrado, paciente_apellido_cifrado, paciente_telefono_cifrado, " +
            "paciente_tipo, paciente_tags, paciente_alerta_alergia, servicio_nombre, profesional_id",
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
    // Disponibilidad activa — decide qué días de finde se pintan "Cerrado" y
    // el denominador del % de capacidad por día. Con filtro de profesional
    // activo se acota a SUS franjas (su agenda, su capacidad); en "Todos" es
    // org-wide: un día queda cerrado solo si NINGÚN profesional tiene franja
    // (unión) y la capacidad suma a todos los colegiados. Org-scoped: la RLS
    // disp_select_org (M02) limita a miembros de la org.
    (async () => {
      let q = supabase
        .from("disponibilidad_profesional")
        .select("dia_semana, hora_inicio, hora_fin, vigencia_desde, vigencia_hasta")
        .eq("organization_id", organizationId)
        .eq("activa", true);
      if (profesionalId) q = q.eq("member_id", profesionalId);
      return q;
    })(),
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
      profesionalId: row.profesional_id ?? null,
      profesionalNombre: profesionalesNombreById?.[row.profesional_id] ?? null,
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

  // Días cerrados de la semana. Si la lectura de disponibilidad falla, NO
  // tumbamos la página por algo cosmético: caemos al comportamiento histórico
  // (finde cerrado salvo eventos) con un warn para diagnóstico.
  if (dispRes.error) {
    console.warn(`[calendario] disponibilidad_profesional falló: ${dispRes.error.message}`);
  }
  const disponibilidad: FranjaDisponibilidad[] = (
    (dispRes.data ?? []) as unknown as Array<{
      dia_semana: number;
      hora_inicio: string;
      hora_fin: string;
      vigencia_desde: string;
      vigencia_hasta: string | null;
    }>
  ).map((r) => ({
    diaSemana: r.dia_semana,
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
    vigenciaDesde: r.vigencia_desde,
    vigenciaHasta: r.vigencia_hasta,
  }));
  const fechasConEventos = new Set<string>([
    ...turnos.map((t) => t.fecha),
    ...bloqueos.map((b) => b.fecha),
    ...pedidos.filter((p) => p.estado === "pendiente" && p.fecha).map((p) => p.fecha as string),
  ]);
  const diasCerrados = deriveDiasCerrados(weekDates, dispRes.error ? [] : disponibilidad, fechasConEventos);
  // Capacidad por día: con filtro de profesional la query ya vino acotada a
  // sus franjas; en "Todos" suma las de toda la org. Sin franjas → null →
  // fallback histórico (600 min) en la UI.
  const capacidadDiaMin = deriveCapacidadSemana(weekDates, dispRes.error ? [] : disponibilidad);

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
    diasCerrados,
    capacidadDiaMin,
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

// ─── Vista mensual (PR E) ──────────────────────────────────────────────────

const MESES_FULL = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface MonthGridCell {
  dateIso: string;        // "YYYY-MM-DD"
  inCurrentMonth: boolean;
  isToday: boolean;
}

/**
 * `monthAnchorInTz` — dado un `?mes=YYYY-MM` (o null), devuelve el ancla
 * "YYYY-MM" del mes a mostrar. Default: el mes actual en la TZ dada.
 */
export function monthAnchorInTz(monthOrNull: string | null, timezone: string): string {
  const tz = timezone || "America/Argentina/Cordoba";
  if (monthOrNull && /^\d{4}-\d{2}$/.test(monthOrNull)) {
    return monthOrNull;
  }
  return ymdInTz(new Date().toISOString(), tz).slice(0, 7);
}

/** Avanza/retrocede N meses sobre un ancla "YYYY-MM". */
export function shiftMonth(monthIso: string, deltaMonths: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + deltaMonths;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

/** Etiqueta legible del mes: "junio 2026". */
export function formatMonthLabel(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return `${MESES_FULL[m - 1]} ${y}`;
}

/**
 * `buildMonthGrid` — función pura que construye la grilla mensual visible:
 * desde el lunes en/antes del día 1 hasta el domingo en/después del último
 * día (semanas completas, longitud múltiplo de 7; típicamente 35 o 42 celdas).
 *
 * `todayIso` es el "YYYY-MM-DD" de hoy en la TZ (se pasa pre-computado para
 * mantener la función pura/testeable sin DB ni reloj).
 */
export function buildMonthGrid(monthIso: string, todayIso: string): MonthGridCell[] {
  const [y, m] = monthIso.split("-").map(Number);

  // Lunes en/antes del día 1 (cálculo vía mediodía UTC, no cruza día).
  const firstMidday = Date.UTC(y, m - 1, 1, 12, 0, 0);
  const dow = new Date(firstMidday).getUTCDay(); // 0 dom..6 sab
  const offset = (dow + 6) % 7;                   // 0 si lunes
  const gridStart = Date.UTC(y, m - 1, 1 - offset);

  // Último día del mes.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastMidday = Date.UTC(y, m - 1, lastDay, 12, 0, 0);
  const lastDow = new Date(lastMidday).getUTCDay();
  const tailOffset = (7 - ((lastDow + 6) % 7) - 1); // días hasta el domingo
  const gridEnd = Date.UTC(y, m - 1, lastDay + tailOffset);

  const cells: MonthGridCell[] = [];
  for (
    let t = gridStart;
    t <= gridEnd;
    t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1)
  ) {
    const dt = new Date(t);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    const dateIso = `${yy}-${mm}-${dd}`;
    cells.push({
      dateIso,
      inCurrentMonth: dateIso.slice(0, 7) === monthIso,
      isToday: dateIso === todayIso,
    });
  }
  return cells;
}

export interface CalendarioMesData {
  monthIso: string;                // "YYYY-MM"
  monthLabel: string;              // "junio 2026"
  hoyIso: string;                  // "YYYY-MM-DD" en TZ
  grid: MonthGridCell[];           // semanas completas (length % 7 === 0)
  /** Turnos confirmados/activos del rango visible, ya en fecha/hora TZ. */
  turnos: TurnoSemana[];
  pacientes: PacientesById;
}

interface MesFetcherInput {
  organizationId: string;
  monthIso: string;                // "YYYY-MM"
  timezone: string;
  profesionalId?: string | null;
  /** Ver FetcherInput.profesionalesNombreById. */
  profesionalesNombreById?: Record<string, string>;
}

/**
 * `getCalendarioMes` — turnos del rango cubierto por la grilla mensual
 * visible (lunes antes del 1 → domingo después del último día). Mismo client
 * autenticado y RLS que la vista semanal. Devuelve turnos activos (no
 * cancelados/no-asistió/reagendados) para los conteos/preview por día.
 */
export async function getCalendarioMes(input: MesFetcherInput): Promise<Result<CalendarioMesData>> {
  const { organizationId, monthIso, timezone, profesionalId, profesionalesNombreById } = input;
  const tz = timezone || "America/Argentina/Cordoba";
  const supabase = await createSupabaseServerClient();

  const hoyIso = ymdInTz(new Date().toISOString(), tz);
  const grid = buildMonthGrid(monthIso, hoyIso);
  const firstIso = grid[0].dateIso;
  const lastIso = grid[grid.length - 1].dateIso;

  const [fy, fm, fd] = firstIso.split("-").map(Number);
  const [ly, lm, ld] = lastIso.split("-").map(Number);
  const startUtc = wallClockInTzToUtc(fy, fm, fd, 0, 0, 0, tz).toISOString();
  // Fin exclusivo: medianoche del día siguiente al último de la grilla.
  const endUtc = wallClockInTzToUtc(ly, lm, ld + 1, 0, 0, 0, tz).toISOString();

  let q = supabase
    .from("turno_extendido")
    .select(
      "id, organization_id, inicio, duracion_min, estado, origen, " +
        "paciente_id, paciente_nombre_cifrado, paciente_apellido_cifrado, paciente_telefono_cifrado, " +
        "paciente_tipo, paciente_tags, paciente_alerta_alergia, servicio_nombre, profesional_id",
    )
    .eq("organization_id", organizationId)
    .in("estado", ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO", "CERRADO"])
    .gte("inicio", startUtc)
    .lt("inicio", endUtc)
    .order("inicio", { ascending: true });
  if (profesionalId) q = q.eq("profesional_id", profesionalId);

  const turnosRes = await q;
  if (turnosRes.error) return err("db_error", "Error leyendo turnos del mes.", turnosRes.error.message);

  const turnoRows = (turnosRes.data ?? []) as unknown as TurnoExtendidoRow[];
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
      profesionalId: row.profesional_id ?? null,
      profesionalNombre: profesionalesNombreById?.[row.profesional_id] ?? null,
    };
  });

  return ok({
    monthIso,
    monthLabel: formatMonthLabel(monthIso),
    hoyIso,
    grid,
    turnos,
    pacientes: Object.fromEntries(pacientesAcum.entries()),
  });
}
