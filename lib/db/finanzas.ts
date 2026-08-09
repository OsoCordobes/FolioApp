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
 *   - ingresosPorDia: un bucket por FECHA REAL del período (no día-del-mes).
 *   - serviciosBreakdown: agrupado por servicio.tipo_canonico.
 *   - transacciones: TODOS los pendientes + los cobros más recientes.
 *   - kpiDelta vs mes pasado (porcentaje).
 *
 * Paginación (review /finanzas · H2/H7): PostgREST corta en `max_rows`
 * (supabase/config.toml = 1000, idem el proyecto hosteado) y NINGUNA query de
 * este módulo paginaba: una clínica con >1000 pagos en el año veía totales,
 * donut, desglose por profesional y CSV calculados sobre un subconjunto, SIN
 * aviso — plata mal reportada. Ahora toda lectura de `pago` pasa por
 * `fetchAllRowsPaginado` (loop de .range() guiado por el `count` exacto, que
 * PostgREST devuelve completo aunque clampee las filas), y el count de sesiones
 * usa `head: true` (antes `.length` de las filas → el KPI se clavaba en 1000).
 * Si aun así se toca el tope de seguridad (MAX_PAGINAS × PAGE_SIZE) el fetcher
 * devuelve `datosParciales: true` y la UI lo dice: nunca truncar en silencio.
 *
 * Multi-tenant: la tabla `pago` NO tiene columna `organization_id` (su tenancy
 * deriva de `turno_id → turno.organization_id` + RLS). Por eso solo la query de
 * `turno` filtra explícitamente por `organization_id`; las queries de `pago`
 * confían en el join (turno) + RLS para el scoping.
 *
 * Semántica temporal (review PR #118): el período se filtra (y los totales se
 * DEVENGAN) por `created_at`; `pagado_ts` solo AFINA el día/mes dentro del
 * período. Si `pagado_ts` cae fuera del rango elegido (deuda vieja saldada en
 * otro período), el bucket cae a `created_at` — así el total del período
 * siempre cuadra con las barras del chart (ver `fechaBucketPago`).
 */

import type { ProfesionalLite } from "@/lib/agenda/profesional";
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

/**
 * Punto de la serie diaria (períodos cortos: hoy/semana/mes y "año" cuando
 * todavía cabe en <40 días).
 *
 * Review /finanzas · H5+H8: antes esto era `[díaDelMes, monto]` sobre un eje
 * 1..diasDelMes del mes ANCLA, sin importar qué período hubiera elegido el
 * usuario. En "Semana" a caballo de dos meses los días del mes anterior caían
 * en buckets 27..31 y el chart los recortaba; en "Año" (enero/febrero, rango
 * corto) todo pago con día-del-mes > hoy desaparecía de la curva aunque
 * estuviera sumado en el KPI y en el CSV. Ahora el bucket es la FECHA REAL en
 * la TZ de la organización, así que el eje es exactamente el período elegido y
 * la suma de la curva cierra con el KPI en los 5 períodos.
 */
export interface FinanzasDiaIngreso {
  /** "2026-07-28" — fecha wall-clock en la TZ de la org. Clave estable. */
  fecha: string;
  /** Label del eje: "28", o "28/7" si el rango cruza meses. */
  label: string;
  /** Pesos enteros. */
  monto: number;
}

/** Punto de la serie mensual (períodos 6m/año). */
export interface FinanzasMesIngreso {
  /** "2026-02" — clave estable. */
  ym: string;
  /** Label corto para el eje ("feb", o "feb 26" si el rango cruza años). */
  label: string;
  /** Pesos enteros. */
  monto: number;
}

/** Desglose de ingresos por profesional (solo canSeeFinanzasAll). */
export interface FinanzasProfesionalBreakdown {
  /** member.id del profesional del turno. */
  id: string;
  nombre: string;
  /** Pagos cobrados del período. */
  count: number;
  /** Pesos enteros (solo PAGADO — la deuda vive en porCobrar). */
  monto: number;
}

export interface FinanzasData {
  mesLabel: string;          // "mayo 2026"
  mesNumero: number;         // 1..12
  anio: number;
  diaActual: number;         // 1..31 según TZ
  diasDelMes: number;
  /** Fecha de hoy en TZ de la org ("YYYY-MM-DD") — marca el punto HOY del chart. */
  hoyFecha: string;
  totalIngresos: number;     // pesos enteros
  totalSesiones: number;
  ticketPromedio: number;
  proyeccionFinDeMes: number;
  deltaIngresosVsMesPasadoPct: number | null;
  /**
   * Serie diaria del período (un punto por fecha real, en TZ de la org).
   * Vacía para rangos largos (manda `ingresosPorMes`).
   */
  ingresosPorDia: FinanzasDiaIngreso[];
  /**
   * E2 · serie mensual agregada para rangos largos (6m/año). Vacía para
   * rangos cortos (el chart diario manda). Meses sin ingresos vienen en 0.
   */
  ingresosPorMes: FinanzasMesIngreso[];
  /** true = rango >~40 días: la UI cambia el chart diario por barras mensuales. */
  esRangoLargo: boolean;
  /** E2 · deuda del período: suma de pagos con estado ≠ PAGADO (pesos). */
  porCobrar: number;
  porCobrarCount: number;
  serviciosBreakdown: FinanzasServicioBreakdown[];
  /**
   * E2 · ingresos por profesional — solo cuando el caller pasó `profesionales`
   * (la page lo hace únicamente con canSeeFinanzasAll y >1 colegiado). null =
   * no corresponde mostrarlo.
   */
  profesionalesBreakdown: FinanzasProfesionalBreakdown[] | null;
  /**
   * Filas de la tabla: TODOS los pagos pendientes del período (sin cap) + los
   * `CAP_COBRADOS` cobros más recientes. Ver `particionarPagosParaTabla`.
   */
  transacciones: FinanzasTransaccion[];
  /**
   * Cobros del período que NO entraron en `transacciones` por el cap de
   * recientes. Están completos en el CSV — la UI lo dice en el pie.
   */
  cobradosNoListados: number;
  /**
   * true = la lectura de pagos tocó el tope de seguridad de paginación: los
   * totales, el chart y el donut son PARCIALES. La UI muestra un aviso; jamás
   * truncamos en silencio.
   */
  datosParciales: boolean;
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
   * y en su lugar se agrega la serie mensual (ingresosPorMes).
   */
  rangeOverride?: { startUtc: string; endUtc: string; label: string };
  /**
   * E1 · FIX LEAK: scoping por profesional. Cuando viene (PROFESIONAL con
   * canSeeFinanzasOwn y sin canSeeFinanzasAll), las TRES queries filtran por
   * turno.profesional_id — cada médico/a ve SOLO lo suyo, como promete la
   * matriz de permisos de Configuración. null/undefined = toda la org.
   */
  profesionalMemberId?: string | null;
  /**
   * E2 · colegiados activos para el desglose por profesional (nombres). La
   * page los pasa solo con canSeeFinanzasAll y >1 colegiado; ausente/vacío →
   * profesionalesBreakdown = null.
   */
  profesionales?: ProfesionalLite[];
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
    profesional_id: string | null;
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

const MESES_ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Review PR #118 · fecha efectiva para bucketizar un pago cobrado dentro del
 * período [startUtcMs, endUtcMs). Función pura (testeable sin DB).
 *
 * El fetcher filtra pagos por `created_at` ∈ rango pero bucketizaba por
 * `pagado_ts ?? created_at` SIN guard: una deuda de mayo saldada en julio se
 * sumaba al día equivocado de MAYO (con el filtro en julio) y nunca aparecía
 * en julio; en 6m/año sumaba al total pero se descartaba de las barras. Con el
 * guard, si `pagado_ts` cae fuera del rango se bucketiza por `created_at` —
 * el monto queda en el período que el filtro eligió y el total siempre cuadra
 * con el chart. Semántica: devengado por created_at; pagado_ts solo afina el
 * día dentro del período.
 */
export function fechaBucketPago(
  pagadoTs: string | null,
  createdAt: string,
  startUtcMs: number,
  endUtcMs: number,
): string {
  if (!pagadoTs) return createdAt;
  const ts = new Date(pagadoTs).getTime();
  if (Number.isNaN(ts) || ts < startUtcMs || ts >= endUtcMs) return createdAt;
  return pagadoTs;
}

// ─── Paginación (H2/H7) ────────────────────────────────────────────────────

/** Filas por request. PostgREST clampea en `max_rows` (1000) — pedimos eso. */
const PAGE_SIZE = 1000;
/** Tope de seguridad: 20 × 1000 = 20.000 filas por período. */
const MAX_PAGINAS = 20;
/** Filas máximas que una lectura paginada puede devolver antes de truncar. */
export const MAX_FILAS_PERIODO = PAGE_SIZE * MAX_PAGINAS;

/** Contrato mínimo del query builder que necesita `fetchAllRowsPaginado`. */
export interface QueryPaginable<T> {
  range(from: number, to: number): PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
    count: number | null;
  }>;
}

/**
 * Lee TODAS las filas de una query paginando con `.range()`.
 *
 * Por qué no alcanza con un `.limit()` grande: PostgREST recorta cualquier
 * respuesta en `max_rows` (1000) y NO avisa — la query vuelve "exitosa" con
 * 1000 filas. Por eso el loop se guía por el `count` EXACTO del header
 * Content-Range (que PostgREST devuelve completo aunque clampee las filas) y
 * no por "¿me vino una página corta?": si el server clampea por debajo del
 * pageSize pedido, el corte por página corta pararía antes de tiempo.
 *
 * `makeQuery` debe devolver un builder NUEVO por página (los builders de
 * supabase-js son mutables y de un solo uso).
 *
 * Devuelve `truncado: true` si se agotaron las páginas antes de llegar al
 * count — el caller TIENE que propagarlo a la UI.
 */
export async function fetchAllRowsPaginado<T>(
  makeQuery: () => QueryPaginable<T>,
  opts?: { pageSize?: number; maxPaginas?: number },
): Promise<{ rows: T[]; truncado: boolean; error: { message: string } | null }> {
  const pageSize = opts?.pageSize ?? PAGE_SIZE;
  const maxPaginas = opts?.maxPaginas ?? MAX_PAGINAS;
  const rows: T[] = [];
  let total: number | null = null;

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const from = rows.length;
    const { data, error, count } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { rows, truncado: false, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (count != null) total = count;
    // Sin count utilizable caemos al heurístico de página corta (mejor que
    // colgarse); con count, la condición de corte es exacta.
    if (batch.length === 0) return { rows, truncado: false, error: null };
    if (total == null) {
      if (batch.length < pageSize) return { rows, truncado: false, error: null };
    } else if (rows.length >= total) {
      return { rows, truncado: false, error: null };
    }
  }

  return { rows, truncado: total == null || rows.length < total, error: null };
}

// ─── Agregación pura (testeable sin DB) ────────────────────────────────────

/** Lo mínimo que necesitan los agregadores de series. */
export interface PagoAgregable {
  estado: string;
  pagado_ts: string | null;
  created_at: string;
  monto_cents: number;
}

/** Tope de días del eje diario (el rango corto son <=41; el resto va a meses). */
const MAX_DIAS_EJE = 400;

/** Cobros recientes que se listan en la tabla (los pendientes NO tienen cap). */
export const CAP_COBRADOS = 20;

interface Ymd { year: number; month: number; day: number }

function ymdKey(p: Ymd): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDaysYmd(p: Ymd, n: number): Ymd {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Fecha wall-clock ("YYYY-MM-DD") de un instante ISO en la TZ dada. */
export function fechaKeyInTz(isoTs: string, timeZone: string): string {
  return ymdKey(formatDateInTz(new Date(isoTs), timeZone));
}

/**
 * Serie diaria del período, bucketizada por FECHA REAL en la TZ de la org.
 *
 * Propiedades que garantiza (y que testea tests/unit/finanzas-buckets-periodo):
 *  - el eje va desde el primer día del rango hasta HOY (o hasta el fin del
 *    rango si ya pasó): nada de días futuros vacíos ni de días recortados por
 *    comparar contra el día-del-mes;
 *  - la suma de la serie == total de pagos PAGADO del período (ningún monto se
 *    descarta en silencio: lo que no cae en el eje va al último bucket).
 */
export function buildIngresosPorDia(
  pagos: PagoAgregable[],
  opts: { startUtc: string; endUtc: string; timeZone: string; now?: Date },
): FinanzasDiaIngreso[] {
  const tz = opts.timeZone;
  const startMs = new Date(opts.startUtc).getTime();
  const endMs = new Date(opts.endUtc).getTime();
  const nowMs = (opts.now ?? new Date()).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  // El eje corta en HOY: ningún pago puede tener fecha futura, así que la suma
  // de la curva sigue cerrando con el KPI.
  const axisEndMs = Math.min(endMs - 1, nowMs);
  if (axisEndMs < startMs) return [];

  const primero = formatDateInTz(new Date(startMs), tz);
  const ultimo = formatDateInTz(new Date(axisEndMs), tz);
  const ultimoKey = ymdKey(ultimo);

  const claves: string[] = [];
  let cur = primero;
  for (let i = 0; i < MAX_DIAS_EJE; i++) {
    const k = ymdKey(cur);
    claves.push(k);
    if (k === ultimoKey) break;
    cur = addDaysYmd(cur, 1);
  }

  const montos = new Map<string, number>(claves.map((k) => [k, 0]));
  for (const p of pagos) {
    if (p.estado !== "PAGADO") continue;
    const iso = fechaBucketPago(p.pagado_ts, p.created_at, startMs, endMs);
    let key = fechaKeyInTz(iso, tz);
    // Nunca descartar en silencio: un timestamp por delante de `now` (skew de
    // reloj app/DB) cae al último bucket del eje.
    if (!montos.has(key)) key = claves[claves.length - 1];
    montos.set(key, (montos.get(key) ?? 0) + (p.monto_cents ?? 0));
  }

  const cruzaMeses = primero.year !== ultimo.year || primero.month !== ultimo.month;
  return claves.map((k) => {
    const [, mm, dd] = k.split("-");
    return {
      fecha: k,
      label: cruzaMeses ? `${Number(dd)}/${Number(mm)}` : String(Number(dd)),
      monto: Math.round((montos.get(k) ?? 0) / 100),
    };
  });
}

/**
 * Serie mensual del período (rangos largos: 6m/año). Prellena TODOS los meses
 * del rango en 0 para que un mes sin ingresos aparezca como barra vacía y no
 * desaparezca del eje.
 */
export function buildIngresosPorMes(
  pagos: PagoAgregable[],
  opts: { startUtc: string; endUtc: string; timeZone: string },
): FinanzasMesIngreso[] {
  const tz = opts.timeZone;
  const startMs = new Date(opts.startUtc).getTime();
  const endMs = new Date(opts.endUtc).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const startParts = formatDateInTz(new Date(startMs), tz);
  const endParts = formatDateInTz(new Date(endMs - 1), tz);
  const mesesRango: Array<{ y: number; m: number }> = [];
  let cy = startParts.year;
  let cm = startParts.month;
  while ((cy < endParts.year || (cy === endParts.year && cm <= endParts.month)) && mesesRango.length < 24) {
    mesesRango.push({ y: cy, m: cm });
    cm += 1;
    if (cm > 12) { cm = 1; cy += 1; }
  }

  const montos = new Map<string, number>(mesesRango.map((mes) => [ymKey(mes.y, mes.m), 0]));
  for (const p of pagos) {
    if (p.estado !== "PAGADO") continue;
    const iso = fechaBucketPago(p.pagado_ts, p.created_at, startMs, endMs);
    const parts = formatDateInTz(new Date(iso), tz);
    let key = ymKey(parts.year, parts.month);
    if (!montos.has(key)) {
      // PR #118 · nunca descartar en silencio (antes el has() tragaba el monto
      // y el total no cuadraba con las barras): fallback al mes de created_at,
      // que por el filtro de la query SIEMPRE cae en rango.
      const fb = formatDateInTz(new Date(p.created_at), tz);
      key = ymKey(fb.year, fb.month);
      if (!montos.has(key)) continue;
    }
    montos.set(key, (montos.get(key) ?? 0) + (p.monto_cents ?? 0));
  }

  // Label con año abreviado solo si el rango cruza años.
  const cruzaAnios = mesesRango.length > 0 && mesesRango[0].y !== mesesRango[mesesRango.length - 1].y;
  return mesesRango.map(({ y: yy, m: mm }) => ({
    ym: ymKey(yy, mm),
    label: MESES_ABREV[mm - 1] + (cruzaAnios ? ` ${String(yy).slice(-2)}` : ""),
    monto: Math.round((montos.get(ymKey(yy, mm)) ?? 0) / 100),
  }));
}

/**
 * Elige qué pagos se renderizan en la tabla de transacciones.
 *
 * Review /finanzas · H1+H4: antes se cortaba en los 20 pagos más recientes del
 * listado created_at DESC, PERO el KPI "Por cobrar" acumulaba sobre TODO el
 * período y el único botón "Cobrar" del repo vive en una fila visible de esa
 * tabla. Con >20 pagos en el período (el caso normal de un consultorio real en
 * la vista mensual) una deuda vieja quedaba invisible E INCOBRABLE mientras el
 * KPI la seguía anunciando y la pestaña "Pendientes" decía "Todo cobrado".
 *
 * Diseño elegido (lo más simple que garantiza la propiedad): los pendientes se
 * priorizan ANTES del cap y no tienen cap — cada uno es una acción de cobro que
 * no existe en ninguna otra superficie, y su cantidad es exactamente la que el
 * KPI `porCobrarCount` anuncia. El cap sigue aplicando solo a los cobros
 * (histórico de lectura, sin acción asociada, disponible completo en el CSV).
 */
export function particionarPagosParaTabla<T extends { estado: string }>(
  pagos: T[],
  capCobrados: number = CAP_COBRADOS,
): { visibles: T[]; cobradosNoListados: number } {
  const visibles: T[] = [];
  let cobradosVistos = 0;
  let cobradosListados = 0;
  for (const p of pagos) {
    if (p.estado === "PAGADO") {
      cobradosVistos += 1;
      if (cobradosListados < capCobrados) {
        visibles.push(p);
        cobradosListados += 1;
      }
    } else {
      visibles.push(p);
    }
  }
  return { visibles, cobradosNoListados: cobradosVistos - cobradosListados };
}

/**
 * Select compartido de pagos con el join expandido (paciente + servicio +
 * profesional). Lo usan getFinanzasDelMes y getFinanzasExportRows para que el
 * export vea EXACTAMENTE las mismas filas que la página (solo que sin cap).
 */
const PAGOS_SELECT =
  "id, monto_cents, metodo, estado, pagado_ts, created_at, " +
  "turno:turno_id!inner(id, inicio, estado, duracion_min, organization_id, paciente_id, servicio_id, profesional_id, " +
  "paciente:paciente_id(identidad:identidad_id(nombre_cifrado, apellido_cifrado)), " +
  "servicio:servicio_id(nombre, tipo_canonico))";

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

  // Scoping por profesional (E1 · FIX LEAK): con `profesionalMemberId` las
  // TRES queries filtran por turno.profesional_id — el join !inner ya expone
  // la columna en las de pago.
  const scopeMemberId = input.profesionalMemberId ?? null;

  // 1. Pagos del mes con join expandido para hidratar paciente + servicio.
  // PostgREST relational nesting:
  //   pago.turno → paciente → identidad → nombre/apellido_cifrado.
  //
  // Scoping por org EXPLÍCITO (no solo RLS): `pago` no tiene organization_id
  // propio y la RLS delega en la visibilidad de `turno`, que permite TODAS las
  // membresías del user (user_org_ids()). Con multi-membresía (clínicas,
  // cuenta demo multi-org) una query sin filtro mezclaría pagos de todas las
  // orgs — por eso el join es !inner + .eq sobre turno.organization_id.
  //
  // H2 · paginada: sin .range() en loop PostgREST devolvía como mucho 1000
  // filas y el resto del período se perdía sin aviso. El `.order("id")` extra
  // hace determinista el orden entre páginas (created_at empata cuando se
  // cierran varios turnos en el mismo instante).
  const makePagosQuery = () => {
    let q = supabase
      .from("pago")
      .select(PAGOS_SELECT, { count: "exact" })
      .eq("turno.organization_id", input.organizationId)
      .gte("created_at", startUtc)
      .lt("created_at", endUtc)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (scopeMemberId) q = q.eq("turno.profesional_id", scopeMemberId);
    return q as unknown as QueryPaginable<PagoTurnoRow>;
  };

  const pagosPage = await fetchAllRowsPaginado<PagoTurnoRow>(makePagosQuery);
  if (pagosPage.error) return err("db_error", "Error leyendo pagos del mes.", pagosPage.error.message);

  // 2. Total mes pasado (solo pagado) para delta KPI. Mismo scoping explícito
  // por org (y por profesional, si aplica) que la query principal.
  const makePrevPagosQuery = () => {
    let q = supabase
      .from("pago")
      .select("id, monto_cents, turno:turno_id!inner(organization_id, profesional_id)", { count: "exact" })
      .eq("turno.organization_id", input.organizationId)
      .eq("estado", "PAGADO")
      .gte("created_at", prevStartUtc)
      .lt("created_at", prevEndUtc)
      .order("id", { ascending: false });
    if (scopeMemberId) q = q.eq("turno.profesional_id", scopeMemberId);
    return q as unknown as QueryPaginable<{ monto_cents: number }>;
  };
  const prevPage = await fetchAllRowsPaginado<{ monto_cents: number }>(makePrevPagosQuery);

  const prevTotalCents = prevPage.rows.reduce((s, r) => s + (r.monto_cents ?? 0), 0);

  // 3. Turnos CERRADOS del mes (para count sesiones, RLS-scoped).
  // H2 · `head: true` + count exacto: antes se traían las filas y se contaba
  // con `.length`, así que el KPI "Sesiones" se clavaba en 1000 (max_rows).
  let turnosQuery = supabase
    .from("turno")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", input.organizationId)
    .eq("estado", "CERRADO")
    .gte("inicio", startUtc)
    .lt("inicio", endUtc);
  if (scopeMemberId) turnosQuery = turnosQuery.eq("profesional_id", scopeMemberId);

  const { count: turnosCerradosCount } = await turnosQuery;

  const totalSesiones = turnosCerradosCount ?? 0;

  // ─── Transformación ──────────────────────────────────────────────────────
  const pagos = pagosPage.rows;

  const diasDelMes = new Date(Date.UTC(y, m, 0)).getUTCDate(); // último día

  const serviciosMap = new Map<string, { nombre: string; count: number; monto: number }>();
  const profesionalesMap = new Map<string, { count: number; monto: number }>();
  let totalIngresosCents = 0;
  let porCobrarCents = 0;
  let porCobrarCount = 0;

  for (const pago of pagos) {
    const monto = pago.monto_cents ?? 0;
    if (pago.estado === "PAGADO") {
      totalIngresosCents += monto;
    } else {
      // E2 · deuda del período (pagos PENDIENTE/PARCIAL del mini-diálogo de
      // cierre con "quedó debiendo").
      porCobrarCents += monto;
      porCobrarCount += 1;
    }

    // Breakdown por servicio y por profesional: SOLO pagos cobrados — el
    // donut y la tabla de profesionales hablan de ingresos reales; la deuda
    // vive en el KPI "Por cobrar". (Antes daba igual: todo pago nacía PAGADO.)
    if (pago.estado === "PAGADO") {
      if (pago.turno?.servicio) {
        const key = pago.turno.servicio.tipo_canonico || pago.turno.servicio.nombre;
        const prev = serviciosMap.get(key) ?? { nombre: pago.turno.servicio.nombre, count: 0, monto: 0 };
        serviciosMap.set(key, {
          nombre: prev.nombre,
          count: prev.count + 1,
          monto: prev.monto + monto,
        });
      }
      if (pago.turno?.profesional_id) {
        const prev = profesionalesMap.get(pago.turno.profesional_id) ?? { count: 0, monto: 0 };
        profesionalesMap.set(pago.turno.profesional_id, {
          count: prev.count + 1,
          monto: prev.monto + monto,
        });
      }
    }
  }

  // H5+H8 · series del chart: buckets por FECHA REAL del período (rangos
  // cortos) o por mes (rangos largos). Ver buildIngresosPorDia.
  const serieOpts = { startUtc, endUtc, timeZone: tz };
  const ingresosPorDia = isLongRange ? [] : buildIngresosPorDia(pagos, serieOpts);
  const ingresosPorMes = isLongRange ? buildIngresosPorMes(pagos, serieOpts) : [];

  // H1+H4 · la tabla lista TODOS los pendientes (única superficie de cobro del
  // repo) + los cobros más recientes. Desencriptamos solo lo que se renderiza.
  const { visibles, cobradosNoListados } = particionarPagosParaTabla(pagos);
  const transacciones: FinanzasTransaccion[] = visibles
    .map((pago) => {
      const ident = pago.turno?.paciente?.identidad ?? null;
      const nombre = tryDecrypt(ident?.nombre_cifrado, "transacciones.nombre");
      const apellido = tryDecrypt(ident?.apellido_cifrado, "transacciones.apellido");
      const pacienteFull = [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente";

      return {
        id: pago.id,
        fecha: pago.pagado_ts ?? pago.created_at,
        paciente: pacienteFull,
        servicio: pago.turno?.servicio?.nombre ?? "—",
        monto: Math.round((pago.monto_cents ?? 0) / 100),
        // E1 · el método ahora es un dato real (elegido en el cierre), así que
        // se muestra SIEMPRE; el estado viaja aparte (columna Estado + chips).
        metodo: METODO_DB_TO_UI[pago.metodo],
        estado: (pago.estado === "PAGADO" ? "cobrado" : "pendiente") as FinanzasTransaccion["estado"],
      };
    })
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

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
  // Si la lectura del mes pasado se truncó, el porcentaje sería mentira: null.
  const deltaIngresosVsMesPasadoPct = !override && !prevPage.truncado && prevTotal > 0
    ? Math.round(((totalIngresos - prevTotal) / prevTotal) * 100)
    : null;

  const serviciosBreakdown: FinanzasServicioBreakdown[] = Array.from(serviciosMap.entries())
    .map(([id, v], i) => ({
      id,
      nombre: v.nombre,
      count: v.count,
      monto: Math.round(v.monto / 100),
      color: COLORES_SERVICIO[i % COLORES_SERVICIO.length],
    }))
    .sort((a, b) => b.monto - a.monto);

  // Desglose por profesional: solo si la page pasó los colegiados (permiso
  // canSeeFinanzasAll + >1 colegiado). Nombres por member.id; un profesional
  // dado de baja con pagos históricos cae al fallback genérico.
  let profesionalesBreakdown: FinanzasProfesionalBreakdown[] | null = null;
  if (input.profesionales && input.profesionales.length > 0) {
    const nombreById = new Map(input.profesionales.map((p) => [p.id, p.displayName]));
    profesionalesBreakdown = Array.from(profesionalesMap.entries())
      .map(([id, v]) => ({
        id,
        nombre: nombreById.get(id) ?? "Profesional",
        count: v.count,
        monto: Math.round(v.monto / 100),
      }))
      .sort((a, b) => b.monto - a.monto);
  }

  return ok({
    mesLabel: override ? override.label : `${nombreMes(m)} ${y}`,
    mesNumero: m,
    anio: y,
    diaActual,
    diasDelMes,
    hoyFecha: ymdKey(nowParts),
    totalIngresos,
    totalSesiones,
    ticketPromedio,
    proyeccionFinDeMes,
    deltaIngresosVsMesPasadoPct,
    ingresosPorDia,
    ingresosPorMes,
    esRangoLargo: isLongRange,
    porCobrar: Math.round(porCobrarCents / 100),
    porCobrarCount,
    serviciosBreakdown,
    profesionalesBreakdown,
    transacciones,
    cobradosNoListados,
    datosParciales: pagosPage.truncado,
  });
}

// ─── Export CSV (server-side, sin cap) ─────────────────────────────────────

export interface FinanzasExportRow {
  /** ISO de cobro (pagado_ts) o de registro (created_at). */
  fecha: string;
  paciente: string;
  servicio: string;
  /** Pesos enteros. */
  monto: number;
  metodo: MetodoPagoUI;
  estado: "cobrado" | "pendiente";
}

/**
 * E2 · filas COMPLETAS del período para el export CSV de /finanzas. El botón
 * exportaba solo las ≤20 transacciones renderizadas; esta query es la MISMA
 * que la de getFinanzasDelMes (mismo select, mismos bounds, mismo scoping por
 * org y por profesional) pero sin cap. PII desencriptada server-side, igual
 * que la página.
 *
 * H7 · la doc decía "sin cap" y el pie de la tabla promete "el export CSV
 * incluye el período completo", pero PostgREST truncaba en 1000 filas: el
 * contador recibía un CSV incompleto creyéndolo entero. Ahora pagina igual que
 * la página y devuelve `truncado` si tocó el tope de seguridad — el route
 * handler agrega una fila de AVISO al CSV en ese caso.
 */
export async function getFinanzasExportRows(
  input: FetcherInput,
): Promise<Result<{ rows: FinanzasExportRow[]; label: string; truncado: boolean }>> {
  const tz = input.timezone || "America/Argentina/Cordoba";
  const supabase = await createSupabaseServerClient();

  const nowParts = formatDateInTz(new Date(), tz);
  const monthAnchor = input.monthAnchor ?? `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-01`;
  const [y, m] = monthAnchor.split("-").map(Number);

  const override = input.rangeOverride;
  const startUtc = override ? override.startUtc : wallClockInTzToUtc(y, m, 1, 0, 0, 0, tz).toISOString();
  const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const endUtc = override ? override.endUtc : wallClockInTzToUtc(nextMonth.y, nextMonth.m, 1, 0, 0, 0, tz).toISOString();

  const makePagosQuery = () => {
    let q = supabase
      .from("pago")
      .select(PAGOS_SELECT, { count: "exact" })
      .eq("turno.organization_id", input.organizationId)
      .gte("created_at", startUtc)
      .lt("created_at", endUtc)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (input.profesionalMemberId) {
      q = q.eq("turno.profesional_id", input.profesionalMemberId);
    }
    return q as unknown as QueryPaginable<PagoTurnoRow>;
  };

  const pagosPage = await fetchAllRowsPaginado<PagoTurnoRow>(makePagosQuery);
  if (pagosPage.error) return err("db_error", "Error leyendo pagos del período.", pagosPage.error.message);

  const pagos = pagosPage.rows;
  const rows: FinanzasExportRow[] = pagos.map((pago) => {
    const ident = pago.turno?.paciente?.identidad ?? null;
    const nombre = tryDecrypt(ident?.nombre_cifrado, "export.nombre");
    const apellido = tryDecrypt(ident?.apellido_cifrado, "export.apellido");
    return {
      fecha: pago.pagado_ts ?? pago.created_at,
      paciente: [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente",
      servicio: pago.turno?.servicio?.nombre ?? "—",
      monto: Math.round((pago.monto_cents ?? 0) / 100),
      metodo: METODO_DB_TO_UI[pago.metodo],
      estado: pago.estado === "PAGADO" ? "cobrado" : "pendiente",
    };
  });

  return ok({
    rows,
    label: override ? override.label : `${nombreMes(m)} ${y}`,
    truncado: pagosPage.truncado,
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

// Los formatters de Intl son caros de construir. Con la paginación de H2 esta
// función puede correr decenas de miles de veces por request (una por pago),
// así que cacheamos uno por TZ.
const FMT_FECHA_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmtFechaFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = FMT_FECHA_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    FMT_FECHA_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

export function formatDateInTz(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = fmtFechaFor(timeZone).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? 1970),
    month: Number(parts.find((p) => p.type === "month")?.value ?? 1),
    day: Number(parts.find((p) => p.type === "day")?.value ?? 1),
  };
}

/** Clave estable año-mes ("2026-02") para la serie mensual. */
function ymKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
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
