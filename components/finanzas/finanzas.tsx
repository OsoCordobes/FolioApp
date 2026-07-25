"use client";

/**
 * Folio · /finanzas — Ingresos del período con KPIs, gráficos y transacciones.
 *
 * Port fiel de folio/finanzas.jsx + E1/E2 (finanzas completas):
 *  - KPI strip con "Por cobrar" (deuda del período) y labels honestos por
 *    período (la proyección de fin de mes solo aplica a "Este mes").
 *  - Chart diario (línea) para rangos cortos; barras mensuales para 6m/año.
 *    El eje diario va por FECHA REAL del período (no por día-del-mes): ver
 *    LineChart y lib/db/finanzas · buildIngresosPorDia.
 *  - Eje Y relativo al dato (niceCeil) — el piso hardcodeado de $150.000
 *    aplanaba consultorios chicos.
 *  - Tabla con chips Todos/Cobrados/Pendientes y acción inline "Cobrar"
 *    (server action marcarPagoCobradoAction + toast). Lista TODOS los pagos
 *    pendientes del período — es la única superficie de cobro del producto, y
 *    el KPI "Por cobrar" cuenta exactamente esas filas.
 *  - Export CSV server-side SIN cap: el botón es un <a> a /finanzas/export.
 *
 * Los agregados se calculan server-side (lib/db/finanzas.ts) con RLS por org
 * y scoping por profesional cuando el rol solo ve lo propio.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import * as I from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { niceCeil } from "@/lib/format/nice-ceil";
import type {
  FinanzasData,
  FinanzasDiaIngreso,
  FinanzasMesIngreso,
  FinanzasProfesionalBreakdown,
  FinanzasServicioBreakdown,
  FinanzasTransaccion,
  MetodoPagoUI,
} from "@/lib/db/finanzas";

import { marcarPagoCobradoAction } from "@/app/(app)/finanzas/actions";

const METODO_LBL: Record<MetodoPagoUI, { lbl: string; color: string }> = {
  mercadopago:   { lbl: "MercadoPago",   color: "var(--slate)" },
  transferencia: { lbl: "Transferencia", color: "var(--ink-2)" },
  efectivo:      { lbl: "Efectivo",      color: "var(--ink-2)" },
  tarjeta:       { lbl: "Tarjeta",       color: "var(--ink-2)" },
  obra_social:   { lbl: "Obra Social",   color: "var(--ink-2)" },
  otro:          { lbl: "Otro",          color: "var(--ink-3)" },
  pendiente:     { lbl: "Pendiente",     color: "var(--amber)" },
};

const MESES_ABREV_FN = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const fmtMoney = (n: number | null | undefined): string =>
  "$ " + (n ?? 0).toLocaleString("es-AR");

const fmtMonth = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return n.toString();
};

const fmtFechaHora = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getDate()} ${MESES_ABREV_FN[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ─── KPI strip ──────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: ReactNode;
  sub: string;
  tone?: "primary" | "warn";
  delta?: string;
}

function KpiCard({ label, value, sub, tone, delta }: KpiCardProps) {
  return (
    <div className={"fn-kpi " + (tone ? "is-" + tone : "")}>
      <span className="fi-eyebrow">{label}</span>
      <div className="fn-kpi-val">{value}</div>
      <div className="fn-kpi-foot">
        <span className="fn-kpi-sub">{sub}</span>
        {delta ? (
          <span className={"fn-kpi-delta " + (delta.startsWith("+") ? "is-pos" : "is-neg")}>
            {delta.startsWith("+") ? (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M7 17l10-10M17 17V7H7" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M17 7L7 17M7 7v10h10" />
              </svg>
            )}
            {delta}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function KpiStrip({
  totalIngresos,
  totalSesiones,
  ticketProm,
  proyeccion,
  porCobrar,
  porCobrarCount,
  diaActual,
  diasDelMes,
  deltaIngresosPct,
  periodo,
  periodoLabel,
}: {
  totalIngresos: number;
  totalSesiones: number;
  ticketProm: number;
  proyeccion: number;
  porCobrar: number;
  porCobrarCount: number;
  diaActual: number;
  diasDelMes: number;
  deltaIngresosPct: number | null;
  periodo: string;
  periodoLabel: string;
}) {
  const esMes = periodo === "mes";
  // Labels honestos por período: el delta "vs mes pasado" y la proyección de
  // fin de mes solo tienen sentido en la vista mensual (E2).
  const deltaLabel = !esMes || deltaIngresosPct == null
    ? undefined
    : `${deltaIngresosPct >= 0 ? "+" : ""}${deltaIngresosPct}%`;
  return (
    <div className="fn-kpis">
      <KpiCard
        label={esMes ? "Ingresos del mes" : "Ingresos del período"}
        value={
          <>
            <small>$</small>
            {fmtMonth(totalIngresos)}
          </>
        }
        sub={esMes ? `${diaActual} de ${diasDelMes} días` : periodoLabel.toLowerCase()}
        delta={deltaLabel}
        tone="primary"
      />
      <KpiCard
        label="Por cobrar"
        value={
          <>
            <small>$</small>
            {fmtMonth(porCobrar)}
          </>
        }
        sub={
          porCobrarCount === 0
            ? "sin deudas del período"
            : porCobrarCount === 1
              ? "1 pago pendiente"
              : `${porCobrarCount} pagos pendientes`
        }
        tone={porCobrar > 0 ? "warn" : undefined}
      />
      <KpiCard
        label="Sesiones"
        value={totalSesiones}
        sub={totalSesiones === 1 ? "1 atendido" : "atendidos"}
      />
      <KpiCard
        label="Ticket promedio"
        value={
          <>
            <small>$</small>
            {fmtMonth(ticketProm)}
          </>
        }
        sub="por sesión"
      />
      {esMes ? (
        <KpiCard
          label="Proyección fin de mes"
          value={
            <>
              <small>$</small>
              {fmtMonth(proyeccion)}
            </>
          }
          sub="al ritmo actual"
        />
      ) : null}
    </div>
  );
}

// ─── Line chart ─────────────────────────────────────────────────────────────

/**
 * Chart diario del período.
 *
 * Review /finanzas · H5+H8: antes recibía `[díaDelMes, monto]` sobre un eje
 * 1..diasDelMes del mes ancla y recortaba con `d <= diaActual`. En "Semana" a
 * caballo de dos meses los días del mes anterior (27..31) quedaban fuera del
 * filtro, y en "Año" corto todo pago con día-del-mes > hoy desaparecía de la
 * curva aunque estuviera sumado en el KPI y en el CSV — el gráfico contradecía
 * al número de arriba. Ahora el eje ES el período: un punto por fecha real
 * (ya bucketizada en la TZ de la org por lib/db/finanzas) y sin recorte
 * posterior, porque el fetcher ya corta el eje en HOY.
 */
function LineChart({ dias, hoyFecha }: { dias: FinanzasDiaIngreso[]; hoyFecha: string }) {
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 26;
  const W = 600 - PAD_L - PAD_R;
  const H = 180 - PAD_T - PAD_B;
  const n = dias.length;
  const maxObserved = Math.max(0, ...dias.map((d) => d.monto));
  // E2 · escala relativa al dato: el piso fijo de $150.000 aplanaba la curva
  // de consultorios con ticket bajo (facturar $40k/día se veía como $0).
  const maxY = niceCeil(maxObserved * 1.15, 10_000);

  if (n === 0) {
    return (
      <p className="muted" style={{ padding: "44px 16px", textAlign: "center" }}>
        Sin días para mostrar en este período todavía.
      </p>
    );
  }

  const points = dias.map((dia, i) => ({
    x: PAD_L + (n === 1 ? W / 2 : (i / (n - 1)) * W),
    y: PAD_T + H - (dia.monto / maxY) * H,
    i,
    fecha: dia.fecha,
    label: dia.label,
    m: dia.monto,
  }));
  const labPoints = points.filter((p) => p.m > 0);
  const path = labPoints.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const lastPoint = labPoints[labPoints.length - 1] ?? { x: PAD_L, y: PAD_T + H, i: 0, fecha: "", label: "", m: 0 };
  const firstPoint = labPoints[0] ?? lastPoint;
  const area = labPoints.length > 0
    ? path + ` L ${lastPoint.x} ${PAD_T + H} L ${firstPoint.x} ${PAD_T + H} Z`
    : "";
  const ticks = [0, Math.round(maxY / 3), Math.round((2 * maxY) / 3), maxY];

  return (
    <svg className="fn-chart" viewBox="0 0 600 180" preserveAspectRatio="none">
      <defs>
        <linearGradient id="fn-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((t) => {
        const y = PAD_T + H - (t / maxY) * H;
        return (
          <g key={t}>
            <line
              x1={PAD_L}
              y1={y}
              x2={PAD_L + W}
              y2={y}
              stroke="var(--line-soft)"
              strokeWidth="1"
              strokeDasharray={t === 0 ? "0" : "2 3"}
            />
            <text x={PAD_L - 8} y={y + 3} textAnchor="end" fill="var(--ink-3)" fontSize="10" fontFamily="Geist Mono" letterSpacing="0">
              {t === 0 ? "0" : fmtMonth(t)}
            </text>
          </g>
        );
      })}

      {labelIdxFor(n).map((i) => {
        const p = points[i];
        return (
          <text key={p.fecha} x={p.x} y={PAD_T + H + 16} textAnchor="middle" fill="var(--ink-3)" fontSize="10" fontFamily="Geist Mono">
            {p.label}
          </text>
        );
      })}

      <path d={area} fill="url(#fn-area)" />
      <path d={path} stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {labPoints.map((p) => {
        const isToday = p.fecha === hoyFecha;
        return (
          <g key={p.fecha}>
            <circle cx={p.x} cy={p.y} r={isToday ? 4.5 : 3} fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.8" />
            {isToday ? <circle cx={p.x} cy={p.y} r="2.5" fill="var(--accent)" /> : null}
          </g>
        );
      })}

      {labPoints.length > 0 ? (
        <>
          <line x1={lastPoint.x} y1={PAD_T} x2={lastPoint.x} y2={PAD_T + H} stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
          <text x={lastPoint.x} y={PAD_T - 2} textAnchor="middle" fill="var(--accent-2)" fontSize="10" fontFamily="Geist Mono" letterSpacing=".08em">
            {lastPoint.fecha === hoyFecha ? "HOY" : lastPoint.label}
          </text>
        </>
      ) : null}
    </svg>
  );
}

/** Índices del eje X que llevan label (hasta 5, repartidos y sin repetir). */
function labelIdxFor(n: number): number[] {
  if (n <= 1) return [0];
  const last = n - 1;
  const crudos = n <= 7
    ? [0, Math.round(last / 2), last]
    : [0, Math.round(last / 4), Math.round(last / 2), Math.round((3 * last) / 4), last];
  return Array.from(new Set(crudos));
}

// ─── Bar chart mensual (períodos 6m / año) ──────────────────────────────────

/**
 * E2 · barras mensuales para rangos largos. Reusa el patrón SVG del LineChart
 * (mismo viewBox, misma grilla de ticks, mismos tokens) — antes 6m/año
 * renderizaban ejes vacíos sin ningún mensaje.
 */
function BarChartMensual({ meses }: { meses: FinanzasMesIngreso[] }) {
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 26;
  const W = 600 - PAD_L - PAD_R;
  const H = 180 - PAD_T - PAD_B;

  const total = meses.reduce((s, m) => s + m.monto, 0);
  if (meses.length === 0 || total === 0) {
    return (
      <p className="muted" style={{ padding: "44px 16px", textAlign: "center" }}>
        Sin ingresos registrados en este período todavía. Cuando cierres turnos
        con cobro, acá vas a ver la evolución mes a mes.
      </p>
    );
  }

  const maxY = niceCeil(Math.max(...meses.map((m) => m.monto)) * 1.15, 10_000);
  const slotW = W / meses.length;
  const barW = Math.min(44, slotW * 0.58);
  const ticks = [0, Math.round(maxY / 3), Math.round((2 * maxY) / 3), maxY];

  return (
    <svg className="fn-chart" viewBox="0 0 600 180" preserveAspectRatio="none">
      {ticks.map((t) => {
        const y = PAD_T + H - (t / maxY) * H;
        return (
          <g key={t}>
            <line
              x1={PAD_L}
              y1={y}
              x2={PAD_L + W}
              y2={y}
              stroke="var(--line-soft)"
              strokeWidth="1"
              strokeDasharray={t === 0 ? "0" : "2 3"}
            />
            <text x={PAD_L - 8} y={y + 3} textAnchor="end" fill="var(--ink-3)" fontSize="10" fontFamily="Geist Mono" letterSpacing="0">
              {t === 0 ? "0" : fmtMonth(t)}
            </text>
          </g>
        );
      })}

      {meses.map((mes, i) => {
        const h = maxY > 0 ? (mes.monto / maxY) * H : 0;
        const x = PAD_L + i * slotW + (slotW - barW) / 2;
        const y = PAD_T + H - h;
        return (
          <g key={mes.ym}>
            <rect x={x} y={y} width={barW} height={h} rx="2" fill="var(--accent)" opacity="0.85">
              <title>{`${mes.label} · ${fmtMoney(mes.monto)}`}</title>
            </rect>
            <text x={x + barW / 2} y={PAD_T + H + 16} textAnchor="middle" fill="var(--ink-3)" fontSize="10" fontFamily="Geist Mono">
              {mes.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Donut ──────────────────────────────────────────────────────────────────

function Donut({ servicios }: { servicios: FinanzasServicioBreakdown[] }) {
  const total = servicios.reduce((s, x) => s + x.monto, 0);
  const cx = 90;
  const cy = 90;
  const r = 64;
  const stroke = 22;
  let angle = -Math.PI / 2;

  if (total === 0) {
    return (
      <div className="fn-donut-wrap">
        <p className="muted" style={{ padding: "32px 16px", textAlign: "center" }}>
          Sin ingresos en este período todavía.
        </p>
      </div>
    );
  }

  const arcs = servicios.map((s) => {
    const portion = s.monto / total;
    const angleEnd = angle + portion * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angleEnd);
    const y2 = cy + r * Math.sin(angleEnd);
    const largeArc = portion > 0.5 ? 1 : 0;
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
    angle = angleEnd;
    return { ...s, path, portion };
  });

  return (
    <div className="fn-donut-wrap">
      <svg className="fn-donut" viewBox="0 0 180 180">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line-soft)" strokeWidth={stroke} />
        {arcs.map((a) => (
          <path key={a.id} d={a.path} stroke={a.color} strokeWidth={stroke} fill="none" strokeLinecap="butt" />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="Geist Mono" fontSize="9" fill="var(--ink-3)" letterSpacing=".08em">
          TOTAL
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="Geist" fontWeight="600" fontSize="17" letterSpacing="-.015em" fill="var(--ink)">
          ${fmtMonth(total)}
        </text>
      </svg>
      <div className="fn-donut-legend">
        {arcs.map((a) => (
          <div key={a.id} className="fn-legend-row">
            <span className="fn-legend-swatch" style={{ background: a.color }} />
            <span className="fn-legend-name">{a.nombre}</span>
            <span className="fn-legend-monto fm-mono">{fmtMoney(a.monto)}</span>
            <span className="fn-legend-pct fm-mono">{Math.round(a.portion * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Desglose por profesional (E2 · solo canSeeFinanzasAll y >1 colegiado) ──

function ProfesionalesBreakdown({ profesionales }: { profesionales: FinanzasProfesionalBreakdown[] }) {
  if (profesionales.length === 0) return null;
  return (
    <div className="fn-prof-breakdown">
      <span className="fi-eyebrow">Por profesional</span>
      <div className="fn-prof-rows">
        {profesionales.map((p) => (
          <div key={p.id} className="fn-prof-row">
            <span className="fn-legend-name">{p.nombre}</span>
            <span className="fn-prof-count fm-mono">
              {p.count} {p.count === 1 ? "cobro" : "cobros"}
            </span>
            <span className="fn-legend-monto fm-mono">{fmtMoney(p.monto)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tabla ──────────────────────────────────────────────────────────────────

type EstadoFiltro = "todos" | "cobrados" | "pendientes";

const ESTADO_FILTROS: Array<[EstadoFiltro, string]> = [
  ["todos", "Todos"],
  ["cobrados", "Cobrados"],
  ["pendientes", "Pendientes"],
];

function TablaTransacciones({
  transacciones,
  mesLabel,
  periodo,
  canMarcarCobrado,
  cobradosNoListados,
}: {
  transacciones: FinanzasTransaccion[];
  mesLabel: string;
  periodo: string;
  canMarcarCobrado: boolean;
  cobradosNoListados: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>("todos");
  /** id del pago con "Cobrar" en vuelo (deshabilita el botón de ESA fila). */
  const [cobrandoId, setCobrandoId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    let rows = transacciones;
    if (estadoFiltro !== "todos") {
      const target = estadoFiltro === "cobrados" ? "cobrado" : "pendiente";
      rows = rows.filter((t) => t.estado === target);
    }
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((t) =>
      t.paciente.toLowerCase().includes(q) ||
      t.servicio.toLowerCase().includes(q) ||
      String(t.monto).includes(q),
    );
  }, [transacciones, search, estadoFiltro]);

  const pendientesCount = useMemo(
    () => transacciones.filter((t) => t.estado === "pendiente").length,
    [transacciones],
  );
  const cobradosCount = transacciones.length - pendientesCount;

  const marcarCobrado = (t: FinanzasTransaccion) => {
    if (cobrandoId) return;
    setCobrandoId(t.id);
    startTransition(async () => {
      const result = await marcarPagoCobradoAction(t.id);
      setCobrandoId(null);
      if (!result.ok) {
        toast.show({ titulo: `No se pudo registrar el cobro: ${result.error.message}`, tono: "error" });
        return;
      }
      toast.show({ titulo: `Pago cobrado · ${fmtMoney(t.monto)} · ${t.paciente}` });
      router.refresh();
    });
  };

  return (
    <div className="fn-table-wrap">
      <header className="fn-table-head">
        <span className="fi-eyebrow">Transacciones del período</span>
        <div className="fn-table-tools">
          <div className="fn-estado-chips" role="group" aria-label="Filtrar por estado">
            {ESTADO_FILTROS.map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                className={"fn-estado-chip-btn " + (estadoFiltro === id ? "is-active" : "")}
                aria-pressed={estadoFiltro === id}
                onClick={() => setEstadoFiltro(id)}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="fn-table-search">
            <I.Search size={12} />
            <input
              placeholder="Buscar paciente, monto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* E2 · export server-side SIN cap: baja TODO el período, no solo
              las ≤20 filas renderizadas. */}
          <a
            className="fi-btn fi-btn-secondary"
            href={`/finanzas/export?periodo=${periodo}`}
            title="Descargar CSV con todas las transacciones del período"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Exportar
          </a>
        </div>
      </header>
      {filtered.length === 0 ? (
        <p className="muted" style={{ padding: 24, textAlign: "center" }}>
          {transacciones.length === 0
            ? "Sin transacciones registradas todavía."
            : estadoFiltro === "pendientes" && !search.trim()
              ? "Sin pagos pendientes en el período. Todo cobrado."
              : "Sin resultados para ese filtro."}
        </p>
      ) : (
        <table className="fn-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Paciente</th>
              <th>Servicio</th>
              <th>Método</th>
              <th>Estado</th>
              <th className="ta-r">Monto</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const m = METODO_LBL[t.metodo];
              const isPendiente = t.estado === "pendiente";
              return (
                <tr key={t.id} className={isPendiente ? "is-pendiente" : ""}>
                  <td className="fm-mono">{fmtFechaHora(t.fecha)}</td>
                  <td>
                    <b>{t.paciente}</b>
                  </td>
                  <td className="muted">{t.servicio}</td>
                  <td>
                    <span className="fn-metodo" style={{ color: m.color }}>
                      <span className="fn-metodo-dot" style={{ background: m.color }} />
                      {m.lbl}
                    </span>
                  </td>
                  <td>
                    <span className={"fn-estado-chip " + (isPendiente ? "is-pendiente" : "is-cobrado")}>
                      {isPendiente ? "Pendiente" : "Cobrado"}
                    </span>
                    {isPendiente && canMarcarCobrado ? (
                      <button
                        type="button"
                        className="fi-btn fi-btn-secondary fn-cobrar-btn"
                        disabled={cobrandoId === t.id}
                        onClick={() => marcarCobrado(t)}
                        title={`Registrar el cobro de ${t.paciente}`}
                      >
                        {cobrandoId === t.id ? "Cobrando…" : "Cobrar"}
                      </button>
                    ) : null}
                  </td>
                  <td className="ta-r">
                    <span className={"fn-monto fm-mono " + (isPendiente ? "is-pendiente" : "")}>
                      {fmtMoney(t.monto)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {/* H1+H4 · el pie ya no puede prometer "las últimas N": la tabla lista
          TODOS los pendientes del período (cada uno con su botón Cobrar, que no
          existe en ninguna otra pantalla) + los cobros más recientes. Decimos
          exactamente cuántos cobros quedaron fuera y dónde están. */}
      <footer className="fn-table-foot">
        <span className="muted">
          {pendientesCount === 0
            ? "Sin pagos pendientes"
            : pendientesCount === 1
              ? "1 pago pendiente (todos listados)"
              : `${pendientesCount} pagos pendientes (todos listados)`}
          {" · "}
          {cobradosCount === 1 ? "1 cobro reciente" : `${cobradosCount} cobros recientes`}
          {cobradosNoListados > 0
            ? ` (hay ${cobradosNoListados} cobro${cobradosNoListados === 1 ? "" : "s"} más en el CSV)`
            : ""}
          {" · "}
          {mesLabel} · el export CSV incluye el período completo
        </span>
      </footer>
    </div>
  );
}

// ─── Page header ────────────────────────────────────────────────────────────

function PageHeader({ mesLabel, nowLabel, periodo }: { mesLabel: string; nowLabel: string; periodo: string }) {
  // Selector de período: navega a /finanzas?periodo=<id>. El Server Component
  // lee el query param y calcula el rango (lib/db/finanzas computeRangeOverride).
  const periods: [string, string][] = [
    ["hoy", "Hoy"],
    ["semana", "Semana"],
    ["mes", "Este mes"],
    ["6m", "6 meses"],
    ["anio", "Año"],
  ];
  return (
    <header className="fn-head">
      <div>
        <span className="fi-eyebrow">finanzas · {mesLabel}</span>
        <h1>Ingresos del período</h1>
        <p className="fn-head-sub">{nowLabel}</p>
      </div>
      <div className="fn-head-controls">
        <div className="fn-period">
          {periods.map(([id, lbl]) => {
            const active = id === periodo;
            return (
              <Link
                key={id}
                href={`/finanzas?periodo=${id}`}
                className={"fn-period-btn " + (active ? "is-active" : "")}
                aria-current={active ? "page" : undefined}
                title={lbl}
              >
                {lbl}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

interface FinanzasProps {
  data: FinanzasData;
  periodo?: string;
  /** capabilities.canRegistrarCobro — habilita "Cobrar" inline en la tabla. */
  canMarcarCobrado?: boolean;
}

export function Finanzas({ data, periodo = "mes", canMarcarCobrado = false }: FinanzasProps) {
  const esMes = periodo === "mes";
  const deltaLabel = data.deltaIngresosVsMesPasadoPct == null
    ? "vs mes pasado: sin datos"
    : `${data.deltaIngresosVsMesPasadoPct >= 0 ? "+" : ""}${data.deltaIngresosVsMesPasadoPct}% vs mes pasado`;

  return (
    <div className="fi-content fn-content">
      <PageHeader
        mesLabel={data.mesLabel}
        nowLabel={esMes ? `Jornada en curso · datos al día ${data.diaActual}` : `Datos del período · ${data.mesLabel.toLowerCase()}`}
        periodo={periodo}
      />
      {/* H2 · si la lectura tocó el tope de paginación, los números de abajo son
          PARCIALES y hay que decirlo: truncar en silencio es plata mal
          reportada. En la práctica no debería verse nunca (el tope son decenas
          de miles de pagos por período). */}
      {data.datosParciales ? (
        <p className="fn-aviso-parcial" role="status">
          <b>Datos parciales.</b> Este período tiene más pagos de los que podemos
          leer de una sola vez, así que los totales, el gráfico y el desglose de
          abajo se calcularon sobre una parte. Elegí un período más corto para
          ver los números completos.
        </p>
      ) : null}
      <KpiStrip
        totalIngresos={data.totalIngresos}
        totalSesiones={data.totalSesiones}
        ticketProm={data.ticketPromedio}
        proyeccion={data.proyeccionFinDeMes}
        porCobrar={data.porCobrar}
        porCobrarCount={data.porCobrarCount}
        diaActual={data.diaActual}
        diasDelMes={data.diasDelMes}
        deltaIngresosPct={data.deltaIngresosVsMesPasadoPct}
        periodo={periodo}
        periodoLabel={data.mesLabel}
      />

      <div className="fn-charts-grid">
        <section className="fn-chart-card">
          <header>
            <span className="fi-eyebrow">
              {data.esRangoLargo ? "Ingresos mensuales" : "Ingresos diarios"} · {data.mesLabel.toLowerCase()}
            </span>
            {/* El delta "vs mes pasado" solo es honesto en la vista mensual —
                con override de período viene null del fetcher (E2). */}
            {esMes ? <span className="fn-chart-sub fm-mono">{deltaLabel}</span> : null}
          </header>
          {data.esRangoLargo ? (
            <BarChartMensual meses={data.ingresosPorMes} />
          ) : (
            <LineChart dias={data.ingresosPorDia} hoyFecha={data.hoyFecha} />
          )}
        </section>
        <section className="fn-chart-card">
          <header>
            <span className="fi-eyebrow">Por servicio</span>
            <span className="fn-chart-sub muted">{data.totalSesiones} sesiones</span>
          </header>
          <Donut servicios={data.serviciosBreakdown} />
          {data.profesionalesBreakdown ? (
            <ProfesionalesBreakdown profesionales={data.profesionalesBreakdown} />
          ) : null}
        </section>
      </div>

      <TablaTransacciones
        transacciones={data.transacciones}
        mesLabel={data.mesLabel}
        periodo={periodo}
        canMarcarCobrado={canMarcarCobrado}
        cobradosNoListados={data.cobradosNoListados}
      />
    </div>
  );
}
