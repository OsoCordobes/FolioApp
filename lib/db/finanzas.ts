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
  totalIngresos: number;     // pesos enteros
  totalSesiones: number;
  ticketPromedio: number;
  proyeccionFinDeMes: number;
  deltaIngresosVsMesPasadoPct: number | null;
  ingresosPorDia: Array<[number, number]>; // [day, monto]
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
  let pagosQuery = supabase
    .from("pago")
    .select(PAGOS_SELECT)
    .eq("turno.organization_id", input.organizationId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: false });
  if (scopeMemberId) pagosQuery = pagosQuery.eq("turno.profesional_id", scopeMemberId);

  const { data: pagosRaw, error: pagosErr } = await pagosQuery;

  if (pagosErr) return err("db_error", "Error leyendo pagos del mes.", pagosErr.message);

  // 2. Total mes pasado (solo pagado) para delta KPI. Mismo scoping explícito
  // por org (y por profesional, si aplica) que la query principal.
  let prevPagosQuery = supabase
    .from("pago")
    .select("monto_cents, turno:turno_id!inner(organization_id, profesional_id)")
    .eq("turno.organization_id", input.organizationId)
    .eq("estado", "PAGADO")
    .gte("created_at", prevStartUtc)
    .lt("created_at", prevEndUtc);
  if (scopeMemberId) prevPagosQuery = prevPagosQuery.eq("turno.profesional_id", scopeMemberId);

  const { data: prevPagosAgg } = await prevPagosQuery;

  const prevTotalCents = ((prevPagosAgg ?? []) as Array<{ monto_cents: number }>).reduce(
    (s, r) => s + (r.monto_cents ?? 0), 0,
  );

  // 3. Turnos CERRADOS del mes (para count sesiones, RLS-scoped).
  let turnosQuery = supabase
    .from("turno")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("estado", "CERRADO")
    .gte("inicio", startUtc)
    .lt("inicio", endUtc);
  if (scopeMemberId) turnosQuery = turnosQuery.eq("profesional_id", scopeMemberId);

  const { data: turnosCerrados } = await turnosQuery;

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

  // E2 · serie mensual para rangos largos: prellenamos TODOS los meses del
  // rango en 0 para que los meses sin ingresos aparezcan como barras vacías
  // (y no desaparezcan del eje).
  const mesesRango: Array<{ y: number; m: number }> = [];
  if (isLongRange) {
    const startParts = formatDateInTz(new Date(startUtc), tz);
    const endParts = formatDateInTz(new Date(new Date(endUtc).getTime() - 1), tz);
    let cy = startParts.year;
    let cm = startParts.month;
    while ((cy < endParts.year || (cy === endParts.year && cm <= endParts.month)) && mesesRango.length < 24) {
      mesesRango.push({ y: cy, m: cm });
      cm += 1;
      if (cm > 12) { cm = 1; cy += 1; }
    }
  }
  const ingresosPorMesMap = new Map<string, number>();
  for (const mes of mesesRango) ingresosPorMesMap.set(ymKey(mes.y, mes.m), 0);

  const serviciosMap = new Map<string, { nombre: string; count: number; monto: number }>();
  const profesionalesMap = new Map<string, { count: number; monto: number }>();
  let totalIngresosCents = 0;
  let porCobrarCents = 0;
  let porCobrarCount = 0;

  const transacciones: FinanzasTransaccion[] = [];

  // Bounds en ms para el guard de bucketización (fechaBucketPago).
  const startUtcMs = new Date(startUtc).getTime();
  const endUtcMs = new Date(endUtc).getTime();

  for (const pago of pagos) {
    const monto = pago.monto_cents ?? 0;
    if (pago.estado === "PAGADO") {
      totalIngresosCents += monto;
      // PR #118 · guard de rango: pagado_ts fuera del período → created_at.
      const fechaCobro = fechaBucketPago(pago.pagado_ts, pago.created_at, startUtcMs, endUtcMs);
      if (buildDailyChart) {
        const day = dayInTz(fechaCobro, tz);
        ingresosPorDiaMap.set(day, (ingresosPorDiaMap.get(day) ?? 0) + monto);
      }
      if (isLongRange) {
        const parts = formatDateInTz(new Date(fechaCobro), tz);
        const key = ymKey(parts.year, parts.month);
        if (ingresosPorMesMap.has(key)) {
          ingresosPorMesMap.set(key, (ingresosPorMesMap.get(key) ?? 0) + monto);
        } else {
          // PR #118 · nunca descartar en silencio (antes el has() tragaba el
          // monto y el total no cuadraba con las barras): fallback al mes de
          // created_at, que por el filtro de la query SIEMPRE cae en rango.
          const fbParts = formatDateInTz(new Date(pago.created_at), tz);
          const fbKey = ymKey(fbParts.year, fbParts.month);
          if (ingresosPorMesMap.has(fbKey)) {
            ingresosPorMesMap.set(fbKey, (ingresosPorMesMap.get(fbKey) ?? 0) + monto);
          }
        }
      }
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
        // E1 · el método ahora es un dato real (elegido en el cierre), así que
        // se muestra SIEMPRE; el estado viaja aparte (columna Estado + chips).
        metodo: METODO_DB_TO_UI[pago.metodo],
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

  // Serie mensual (6m/año): label con año abreviado solo si el rango cruza años.
  const cruzaAnios =
    mesesRango.length > 0 && mesesRango[0].y !== mesesRango[mesesRango.length - 1].y;
  const ingresosPorMes: FinanzasMesIngreso[] = mesesRango.map(({ y: yy, m: mm }) => ({
    ym: ymKey(yy, mm),
    label: MESES_ABREV[mm - 1] + (cruzaAnios ? ` ${String(yy).slice(-2)}` : ""),
    monto: Math.round((ingresosPorMesMap.get(ymKey(yy, mm)) ?? 0) / 100),
  }));

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
 */
export async function getFinanzasExportRows(
  input: FetcherInput,
): Promise<Result<{ rows: FinanzasExportRow[]; label: string }>> {
  const tz = input.timezone || "America/Argentina/Cordoba";
  const supabase = await createSupabaseServerClient();

  const nowParts = formatDateInTz(new Date(), tz);
  const monthAnchor = input.monthAnchor ?? `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-01`;
  const [y, m] = monthAnchor.split("-").map(Number);

  const override = input.rangeOverride;
  const startUtc = override ? override.startUtc : wallClockInTzToUtc(y, m, 1, 0, 0, 0, tz).toISOString();
  const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const endUtc = override ? override.endUtc : wallClockInTzToUtc(nextMonth.y, nextMonth.m, 1, 0, 0, 0, tz).toISOString();

  let pagosQuery = supabase
    .from("pago")
    .select(PAGOS_SELECT)
    .eq("turno.organization_id", input.organizationId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: false });
  if (input.profesionalMemberId) {
    pagosQuery = pagosQuery.eq("turno.profesional_id", input.profesionalMemberId);
  }

  const { data: pagosRaw, error: pagosErr } = await pagosQuery;
  if (pagosErr) return err("db_error", "Error leyendo pagos del período.", pagosErr.message);

  const pagos = (pagosRaw ?? []) as unknown as PagoTurnoRow[];
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

  return ok({ rows, label: override ? override.label : `${nombreMes(m)} ${y}` });
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
