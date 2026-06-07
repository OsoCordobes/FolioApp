/**
 * Folio · /finanzas data fetcher (Sprint S1 T-1.8).
 *
 * Agrega pagos + turnos del mes en curso (en TZ de la org) y devuelve los
 * shapes que consume el Client Component `<Finanzas />`.
 *
 * Outputs:
 *   - totalIngresos: suma de pago.monto_cents donde estado=PAGADO + en mes.
 *   - totalSesiones: count distinct turnos CERRADO en mes.
 *   - ticketPromedio
 *   - proyeccionFinDeMes (regresión lineal simple)
 *   - ingresosPorDia: array [day1..dayN] con suma de pagos del día.
 *   - serviciosBreakdown: agrupado por servicio.tipo_canonico.
 *   - transacciones: top 20 más recientes con paciente desencriptado.
 *   - kpiDelta vs mes pasado (porcentaje).
 *
 * Multi-tenant: la tabla `pago` NO tiene columna `organization_id` (su tenancy
 * deriva de `turno_id → turno.organization_id` + RLS). Por eso solo la query de
 * `turno` filtra explícitamente por `organization_id`; las queries de `pago`
 * confían en el join (turno) + RLS para el scoping.
 */

import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";

// ─── Output shape ──────────────────────────────────────────────────────────

export type MetodoPagoUI = "mercadopago" | "transferencia" | "efectivo" | "tarjeta" | "obra_social" | "otro" | "pendiente";

export interface FinanzasTransaccion {
  id: string;
  fecha: string; // ISO
  paciente: string;
  servicio: string;
  monto: number;
  metodo: MetodoPagoUI;
  estado: "cobrado" | "pendiente";
}

export interface FinanzasServicioBreakdown {
  id: string;
  nombre: string;
  count: number;
  monto: number;
  color: string;
}

export interface FinanzasData {
  mesLabel: string;          // "mayo 2026"
  mesNumero: number;         // 1..12
  anio: number;
  diaActual: number;         // 1..31 según TZ
  diasDelMes: number;
  totalIngresos: number;     // pesos enteros
  totalSesiones: number;
  ticketPromedio: number;
  proyeccionFinDeMes: number;
  deltaIngresosVsMesPasadoPct: number | null;
  ingresosPorDia: Array<[number, number]>; // [day, monto]
  serviciosBreakdown: FinanzasServicioBreakdown[];
  transacciones: FinanzasTransaccion[];
}

interface FetcherInput {
  organizationId: string;
  timezone: string;
  /** ISO YYYY-MM-01 del mes a leer (default: mes en curso en TZ). */
  monthAnchor?: string;
  /**
   * Rango explícito (UTC) que sobreescribe el cálculo mensual. Lo usa el
   * selector de período de /finanzas (hoy/semana/mes/6m/año). Cuando está
   * presente, los KPIs y transacciones se computan sobre [startUtc, endUtc).
   * Para rangos largos (>~1 mes) el chart diario se omite (ingresosPorDia vacío)
   * y se reportan solo los totales.
   */
  rangeOverride?: { startUtc: string; endUtc: string; label: string };
}

// ─── Tipos de rows DB ──────────────────────────────────────────────────────

interface PagoTurnoRow {
  id: string;
  monto_cents: number;
  metodo: "EFECTIVO" | "TRANSFERENCIA" | "MERCADOPAGO" | "TARJETA" | "OBRA_SOCIAL" | "OTRO";
  estado: "PENDIENTE" | "PAGADO" | "PARCIAL";
  pagado_ts: string | null;
  created_at: string;
  turno: {
    id: string;
    inicio: string;
    estado: string;
    duracion_min: number;
    paciente_id: string;
    servicio_id: string;
    paciente: {
      identidad: {
        nombre_cifrado: string | null;
        apellido_cifrado: string | null;
      } | null;
    } | null;
    servicio: {
      nombre: string;
      tipo_canonico: string;
    } | null;
  } | null;
}

// ─── Mapeos ────────────────────────────────────────────────────────────────

const METODO_DB_TO_UI: Record<PagoTurnoRow["metodo"], Exclude<MetodoPagoUI, "pendiente">> = {
  EFECTIVO: "efectivo",
  TRANSFERENCIA: "transferencia",
  MERCADOPAGO: "mercadopago",
  TARJETA: "tarjeta",
  OBRA_SOCIAL: "obra_social",
  OTRO: "otro",
};

const COLORES_SERVICIO = [
  "var(--accent)",
  "var(--green)",
  "var(--slate)",
  "var(--amber)",
  "var(--ink-3)",
];

// ─── Fetcher principal ─────────────────────────────────────────────────────

export async function getFinanzasDelMes(input: FetcherInput): Promise<Result<FinanzasData>> {
  const tz = input.timezone || "America/Argentina/Cordoba";
  const supabase = await createSupabaseServerClient();

  // Determinar mes (anchor en TZ).
  const nowParts = formatDateInTz(new Date(), tz);
  const monthAnchor = input.monthAnchor ?? `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-01`;
  const [y, m] = monthAnchor.split("-").map(Number);

  const override = input.rangeOverride;

  // Bounds del período. Por defecto el mes en curso; con override usamos sus
  // bounds UTC explícitos.
  const startUtc = override ? override.startUtc : wallClockInTzToUtc(y, m, 1, 0, 0, 0, tz).toISOString();
  const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const monthEndUtc = wallClockInTzToUtc(nextMonth.y, nextMonth.m, 1, 0, 0, 0, tz).toISOString();
  const endUtc = override ? override.endUtc : monthEndUtc;

  // Delta vs período anterior: solo tiene sentido para el mes (comparamos contra
  // el mes pasado). Con override de rango arbitrario lo omitimos (null).
  const prevMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const prevStartUtc = wallClockInTzToUtc(prevMonth.y, prevMonth.m, 1, 0, 0, 0, tz).toISOString();
  const prevEndUtc = wallClockInTzToUtc(y, m, 1, 0, 0, 0, tz).toISOString();

  // El chart diario solo se llena cuando el rango cabe razonablemente en un mes.
  // Para 6m/año (rangos largos) devolvemos ingresosPorDia vacío y solo totales.
  const rangeMs = new Date(endUtc).getTime() - new Date(startUtc).getTime();
  const isLongRange = rangeMs > 40 * 24 * 60 * 60_000; // > ~40 días

  // 1. Pagos del mes con join expandido para hidratar paciente + servicio.
  // PostgREST relational nesting:
  //   pago.turno → paciente → identidad → nombre/apellido_cifrado.
  const { data: pagosRaw, error: pagosErr } = await supabase
    .from("pago")
    .select(
      "id, monto_cents, metodo, estado, pagado_ts, created_at, " +
        "turno:turno_id(id, inicio, estado, duracion_min, paciente_id, servicio_id, " +
        "paciente:paciente_id(identidad:identidad_id(nombre_cifrado, apellido_cifrado)), " +
        "servicio:servicio_id(nombre, tipo_canonico))",
    )
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: false });

  if (pagosErr) return err("db_error", "Error leyendo pagos del mes.", pagosErr.message);

  // 2. Total mes pasado (solo pagado) para delta KPI.
  const { data: prevPagosAgg } = await supabase
    .from("pago")
    .select("monto_cents")
    .eq("estado", "PAGADO")
    .gte("created_at", prevStartUtc)
    .lt("created_at", prevEndUtc);

  const prevTotalCents = ((prevPagosAgg ?? []) as Array<{ monto_cents: number }>).reduce(
    (s, r) => s + (r.monto_cents ?? 0), 0,
  );

  // 3. Turnos CERRADOS del mes (para count sesiones, RLS-scoped).
  const { data: turnosCerrados } = await supabase
    .from("turno")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("estado", "CERRADO")
    .gte("inicio", startUtc)
    .lt("inicio", endUtc);

  const totalSesiones = (turnosCerrados ?? []).length;

  // ─── Transformación ──────────────────────────────────────────────────────
  const pagos = (pagosRaw ?? []) as unknown as PagoTurnoRow[];

  const diasDelMes = new Date(Date.UTC(y, m, 0)).getUTCDate(); // último día
  // El chart diario se llena por día-del-mes. Solo tiene sentido para rangos
  // cortos (default mes, hoy, semana). Para rangos largos queda vacío.
  const buildDailyChart = !isLongRange;
  const ingresosPorDiaMap = new Map<number, number>();
  if (buildDailyChart) {
    for (let d = 1; d <= diasDelMes; d++) ingresosPorDiaMap.set(d, 0);
  }

  const serviciosMap = new Map<string, { nombre: string; count: number; monto: number }>();
  let totalIngresosCents = 0;

  const transacciones: FinanzasTransaccion[] = [];

  for (const pago of pagos) {
    const monto = pago.monto_cents ?? 0;
    if (pago.estado === "PAGADO") {
      totalIngresosCents += monto;
      if (buildDailyChart) {
        const day = dayInTz(pago.pagado_ts ?? pago.created_at, tz);
        ingresosPorDiaMap.set(day, (ingresosPorDiaMap.get(day) ?? 0) + monto);
      }
    }

    if (pago.turno?.servicio) {
      const key = pago.turno.servicio.tipo_canonico || pago.turno.servicio.nombre;
      const prev = serviciosMap.get(key) ?? { nombre: pago.turno.servicio.nombre, count: 0, monto: 0 };
      serviciosMap.set(key, {
        nombre: prev.nombre,
        count: prev.count + 1,
        monto: prev.monto + monto,
      });
    }

    if (transacciones.length < 20 && pago.turno) {
      const ident = pago.turno.paciente?.identidad ?? null;
      const nombre = tryDecrypt(ident?.nombre_cifrado, "transacciones.nombre");
      const apellido = tryDecrypt(ident?.apellido_cifrado, "transacciones.apellido");
      const pacienteFull = [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente";

      transacciones.push({
        id: pago.id,
        fecha: pago.pagado_ts ?? pago.created_at,
        paciente: pacienteFull,
        servicio: pago.turno.servicio?.nombre ?? "—",
        monto: Math.round(monto / 100),
        metodo: pago.estado === "PAGADO" ? METODO_DB_TO_UI[pago.metodo] : "pendiente",
        estado: pago.estado === "PAGADO" ? "cobrado" : "pendiente",
      });
    }
  }

  const totalIngresos = Math.round(totalIngresosCents / 100);
  const ticketPromedio = totalSesiones > 0 ? Math.round(totalIngresos / totalSesiones) : 0;

  const diaActual = nowParts.year === y && nowParts.month === m
    ? nowParts.day
    : diasDelMes;
  // La proyección lineal solo aplica al mes en curso (sin override).
  const proyeccionFinDeMes = !override && diaActual > 0 && diaActual < diasDelMes
    ? Math.round(totalIngresos * (diasDelMes / diaActual))
    : totalIngresos;

  const prevTotal = Math.round(prevTotalCents / 100);
  // El delta vs mes pasado solo tiene sentido para la vista mensual default.
  const deltaIngresosVsMesPasadoPct = !override && prevTotal > 0
    ? Math.round(((totalIngresos - prevTotal) / prevTotal) * 100)
    : null;

  const ingresosPorDia: Array<[number, number]> = Array.from(ingresosPorDiaMap.entries())
    .map(([d, cents]) => [d, Math.round(cents / 100)] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const serviciosBreakdown: FinanzasServicioBreakdown[] = Array.from(serviciosMap.entries())
    .map(([id, v], i) => ({
      id,
      nombre: v.nombre,
      count: v.count,
      monto: Math.round(v.monto / 100),
      color: COLORES_SERVICIO[i % COLORES_SERVICIO.length],
    }))
    .sort((a, b) => b.monto - a.monto);

  return ok({
    mesLabel: override ? override.label : `${nombreMes(m)} ${y}`,
    mesNumero: m,
    anio: y,
    diaActual,
    diasDelMes,
    totalIngresos,
    totalSesiones,
    ticketPromedio,
    proyeccionFinDeMes,
    deltaIngresosVsMesPasadoPct,
    ingresosPorDia,
    serviciosBreakdown,
    transacciones,
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function tryDecrypt(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  try {
    return decryptColumn(value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[finanzas] decrypt falló (${label}): ${msg}`);
    return null;
  }
}

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function nombreMes(m: number): string {
  return NOMBRES_MES[m - 1] ?? `mes-${m}`;
}

export function formatDateInTz(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? 1970),
    month: Number(parts.find((p) => p.type === "month")?.value ?? 1),
    day: Number(parts.find((p) => p.type === "day")?.value ?? 1),
  };
}

function dayInTz(isoTs: string, timeZone: string): number {
  return formatDateInTz(new Date(isoTs), timeZone).day;
}

export function wallClockInTzToUtc(
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

// ─── Períodos del selector de /finanzas ────────────────────────────────────

export type FinanzasPeriodo = "hoy" | "semana" | "mes" | "6m" | "anio";

const PERIODO_LABELS: Record<FinanzasPeriodo, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
  "6m": "Últimos 6 meses",
  anio: "Este año",
};

/** Día de la semana (0=domingo) de una fecha wall-clock en la TZ dada. */
function dowInTz(year: number, month: number, day: number, timeZone: string): number {
  // El mediodía UTC de ese día wall-clock no cruza fronteras de día en AR (UTC-3),
  // así que getUTCDay del instante construido refleja el dow correcto.
  const utc = wallClockInTzToUtc(year, month, day, 12, 0, 0, timeZone);
  return utc.getUTCDay();
}

/**
 * Computa los bounds UTC [startUtc, endUtc) + label para un período del selector
 * de Finanzas, anclado a "ahora" en la TZ de la org. `mes` devuelve undefined
 * (el fetcher cae al cálculo mensual default). Semana = lunes..ahora (ISO).
 */
export function computeRangeOverride(
  periodo: FinanzasPeriodo,
  timeZone: string,
  now: Date = new Date(),
): { startUtc: string; endUtc: string; label: string } | undefined {
  if (periodo === "mes") return undefined;

  const { year: y, month: m, day: d } = formatDateInTz(now, timeZone);
  // Fin exclusivo: arranque del día siguiente (cubre todo "hoy").
  const endUtc = wallClockInTzToUtc(y, m, d + 1, 0, 0, 0, timeZone).toISOString();
  const label = PERIODO_LABELS[periodo];

  let start: Date;
  switch (periodo) {
    case "hoy":
      start = wallClockInTzToUtc(y, m, d, 0, 0, 0, timeZone);
      break;
    case "semana": {
      // Lunes de la semana en curso (ISO: lunes=1 .. domingo=0→7).
      const dow = dowInTz(y, m, d, timeZone);
      const backToMonday = dow === 0 ? 6 : dow - 1;
      start = wallClockInTzToUtc(y, m, d - backToMonday, 0, 0, 0, timeZone);
      break;
    }
    case "6m":
      // Inicio del mes 5 meses atrás (ventana de 6 meses naturales).
      start = wallClockInTzToUtc(y, m - 5, 1, 0, 0, 0, timeZone);
      break;
    case "anio":
      start = wallClockInTzToUtc(y, 1, 1, 0, 0, 0, timeZone);
      break;
    default:
      return undefined;
  }

  return { startUtc: start.toISOString(), endUtc, label };
}
