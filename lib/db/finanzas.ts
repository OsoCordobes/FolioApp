

/** Database aggregates and bounded keyset movement pages; financial authority is cents text.
 * Payments remain attributed to created_at. pagado_ts refines the bucket only inside the range.
 * Pure legacy chart/paging helpers remain exported for their existing consumers/tests.
 */

import type { ProfesionalLite } from "@/lib/agenda/profesional";
import { roundedRatio } from "@/lib/format/financial-money";
import { collectConsistentMovements, type MovementFilter, type MovementPage } from "@/lib/finanzas/movements";
import { readFinanceMovements, readFinanceSummary } from "./finanzas-read";


import { err, ok, type Result } from "./errors";

// ─── Output shape ──────────────────────────────────────────────────────────

export type MetodoPagoUI = "mercadopago" | "transferencia" | "efectivo" | "tarjeta" | "obra_social" | "otro" | "pendiente";

export interface FinanzasTransaccion {
  id: string;
  fecha: string; // ISO
  paciente: string;
  servicio: string;
  monto: number;
  /** Exact authority; numeric monto is for chart coordinates only. */
  montoCents?: string;
  metodo: MetodoPagoUI;
  estado: "cobrado" | "pendiente";
}

export interface FinanzasServicioBreakdown {
  id: string;
  nombre: string;
  count: number;
  monto: number;
  /** Exact authority; numeric monto is for chart coordinates only. */
  montoCents?: string;
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
  /** Pesos para coordenadas; montoCents conserva los centavos exactos. */
  monto: number;
  /** Exact authority; numeric monto is for chart coordinates only. */
  montoCents?: string;
}

/** Punto de la serie mensual (períodos 6m/año). */
export interface FinanzasMesIngreso {
  /** "2026-02" — clave estable. */
  ym: string;
  /** Label corto para el eje ("feb", o "feb 26" si el rango cruza años). */
  label: string;
  /** Pesos para coordenadas; montoCents conserva los centavos exactos. */
  monto: number;
  /** Exact authority; numeric monto is for chart coordinates only. */
  montoCents?: string;
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
  /** Exact authority; numeric monto is for chart coordinates only. */
  montoCents?: string;
}

export interface FinanzasData {
  window: { startUtc: string; endUtc: string };
  movements: MovementPage;
  exact: { ingresos: string; pendientes: string; ticket: string; proyeccion: string };
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
  /** Compatibility aliases; bounded initial page, never used for aggregation. */
  transacciones: FinanzasTransaccion[];
  cobradosNoListados: number;
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
   * E2 · colegiados activos para el desglose por profesional (nombres). La
   * page los pasa solo con canSeeFinanzasAll y >1 colegiado; ausente/vacío →
   * profesionalesBreakdown = null.
   */
  profesionales?: ProfesionalLite[];
}

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

/** Period boundaries are frozen once per request/export, in the organization's timezone. */
export function financePeriodBounds(input: FetcherInput) {
  const tz = input.timezone || "America/Argentina/Cordoba";
  const nowParts = formatDateInTz(new Date(), tz);
  const [y, m] = (input.monthAnchor ?? `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-01`).split("-").map(Number);
  const startUtc = input.rangeOverride?.startUtc ?? wallClockInTzToUtc(y, m, 1, 0, 0, 0, tz).toISOString();
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const endUtc = input.rangeOverride?.endUtc ?? wallClockInTzToUtc(next.y, next.m, 1, 0, 0, 0, tz).toISOString();
  return { organizationId: input.organizationId, startUtc, endUtc, tz, y, m, nowParts };
}

export async function getFinanzasDelMes(input: FetcherInput): Promise<Result<FinanzasData>> {
  const bounds = financePeriodBounds(input);
  const { tz, y, m, nowParts, startUtc, endUtc } = bounds;
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const previousStart = wallClockInTzToUtc(prev.y, prev.m, 1, 0, 0, 0, tz).toISOString();
  const previousEnd = wallClockInTzToUtc(y, m, 1, 0, 0, 0, tz).toISOString();
  const [summary, movements] = await Promise.all([
    readFinanceSummary(bounds, previousStart, previousEnd),
    readFinanceMovements(bounds, { status: "todos", query: "" }),
  ]);
  if (!summary.ok) return summary;
  if (!movements.ok) return movements;
  const s = summary.data;
  const diasDelMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const diaActual = nowParts.year === y && nowParts.month === m ? nowParts.day : diasDelMes;
  const isLongRange = Date.parse(endUtc) - Date.parse(startUtc) > 40 * 86400000;
  const dayAmounts = new Map(s.days.map((r) => [r.bucket, r.cents]));
  const monthAmounts = new Map<string, bigint>();
  for (const row of s.days) {
    const key = row.bucket.slice(0, 7);
    monthAmounts.set(key, (monthAmounts.get(key) ?? BigInt(0)) + BigInt(row.cents));
  }
  const serieOpts = { startUtc, endUtc, timeZone: tz };
  // Extend to an actual future-dated bucket, if one exists, instead of dropping its cents.
  const latestDay = s.days.at(-1)?.bucket.split("-").map(Number);
  const axisNow = latestDay ? new Date(Math.max(Date.now(), wallClockInTzToUtc(
    latestDay[0], latestDay[1], latestDay[2], 12, 0, 0, tz).getTime())) : new Date();
  const ingresosPorDia = isLongRange ? [] : buildIngresosPorDia([], { ...serieOpts, now: axisNow }).map((r) => {
    const cents = dayAmounts.get(r.fecha) ?? "0";
    return { ...r, monto: Number(cents) / 100, montoCents: cents };
  });
  const ingresosPorMes = isLongRange ? buildIngresosPorMes([], serieOpts).map((r) => {
    const cents = String(monthAmounts.get(r.ym) ?? BigInt(0));
    return { ...r, monto: Number(cents) / 100, montoCents: cents };
  }) : [];
  const ticket = s.sessions ? roundedRatio(s.paid_cents, 1, s.sessions) : "0";
  const projection = !input.rangeOverride && diaActual < diasDelMes
    ? roundedRatio(s.paid_cents, diasDelMes, diaActual) : s.paid_cents;
  const names = new Map(input.profesionales?.map((p) => [p.id, p.displayName]) ?? []);
  return ok({
    window: { startUtc, endUtc },
    mesLabel: input.rangeOverride?.label ?? `${nombreMes(m)} ${y}`, mesNumero: m, anio: y,
    diaActual, diasDelMes, hoyFecha: ymdKey(nowParts),
    exact: { ingresos: s.paid_cents, pendientes: s.pending_cents, ticket, proyeccion: projection },
    totalIngresos: Number(s.paid_cents) / 100, totalSesiones: s.sessions,
    ticketPromedio: Number(ticket) / 100, proyeccionFinDeMes: Number(projection) / 100,
    deltaIngresosVsMesPasadoPct: !input.rangeOverride && BigInt(s.previous_cents) > BigInt(0)
      ? Number(((BigInt(s.paid_cents) - BigInt(s.previous_cents)) * BigInt(10000)) / BigInt(s.previous_cents)) / 100 : null,
    ingresosPorDia, ingresosPorMes, esRangoLargo: isLongRange,
    porCobrar: Number(s.pending_cents) / 100, porCobrarCount: s.pending_count,
    serviciosBreakdown: s.services.map((r, i) => ({ id: r.id, nombre: r.nombre ?? "Servicio", count: r.count,
      monto: Number(r.cents) / 100, montoCents: r.cents, color: COLORES_SERVICIO[i % COLORES_SERVICIO.length] })),
    profesionalesBreakdown: input.profesionales?.length ? s.professionals.map((r) => ({
      id: r.id, nombre: names.get(r.id) ?? "Profesional", count: r.count, monto: Number(r.cents) / 100, montoCents: r.cents,
    })) : null,
    movements: movements.data, transacciones: movements.data.rows, cobradosNoListados: 0, datosParciales: false,
  });
}

// ─── Export CSV (server-side, sin cap) ─────────────────────────────────────

export interface FinanzasExportRow {
  /** ISO de cobro (pagado_ts) o de registro (created_at). */
  fecha: string;
  paciente: string;
  servicio: string;
  /** Pesos para coordenadas; montoCents conserva los centavos exactos. */
  monto: number;
  /** Exact authority; numeric monto is for chart coordinates only. */
  montoCents?: string;
  metodo: MetodoPagoUI;
  estado: "cobrado" | "pendiente";
}

/** All matching rows or an error: fixed range, database revision and explicit export limits. */
export async function getFinanzasExportRows(
  input: FetcherInput,
  filter: MovementFilter = { status: "todos", query: "" },
): Promise<Result<{ rows: FinanzasExportRow[]; label: string; truncado: boolean }>> {
  try {
    const bounds = financePeriodBounds(input);
    const rows = await collectConsistentMovements(async (cursor) => {
      const page = await readFinanceMovements(bounds, filter, cursor, true);
      if (!page.ok) throw new Error("finance_export_read_failed");
      return page.data;
    });
    return ok({ rows, label: input.rangeOverride?.label ?? `${nombreMes(bounds.m)} ${bounds.y}`, truncado: false });
  } catch {
    return err("db_error", "No se completó la exportación. Los datos pudieron cambiar o superar 10.000 filas / 10 MB; elegí un período menor o reintentá.");
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────


const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

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
