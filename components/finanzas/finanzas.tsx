"use client";

/**
 * Folio · /finanzas — Ingresos del mes con KPIs, gráficos y transacciones.
 *
 * Port fiel de folio/finanzas.jsx (432 líneas). KPI strip + LineChart SVG
 * (ingresos diarios) + Donut SVG (servicios) + tabla densa de transacciones.
 *
 * En F4 los agregados (totalIngresos, ticket prom, proyección) se calculan
 * server-side vía Server Component que consulta `Pago` con RLS por org.
 */

import { useState, useMemo, type ReactNode } from "react";

import * as I from "@/components/icons";
import {
  INGRESOS_DIA,
  METODO_LBL,
  SERVICIOS_BREAKDOWN,
  TRANSACCIONES,
  fmtMoney,
  fmtMonth,
  fmtFechaHora,
} from "@/lib/finanzas-mock";

// ─── KPI strip ──────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: ReactNode;
  sub: string;
  tone?: "primary";
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
}: {
  totalIngresos: number;
  totalSesiones: number;
  ticketProm: number;
  proyeccion: number;
}) {
  return (
    <div className="fn-kpis">
      <KpiCard
        label="Ingresos del mes"
        value={
          <>
            <small>$</small>
            {fmtMonth(totalIngresos)}
          </>
        }
        sub="13 de 31 días"
        delta="+18%"
        tone="primary"
      />
      <KpiCard
        label="Sesiones"
        value={totalSesiones}
        sub={totalSesiones === 1 ? "1 atendido" : "atendidos"}
        delta="+6"
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
        delta="-3%"
      />
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
    </div>
  );
}

// ─── Line chart ─────────────────────────────────────────────────────────────

function LineChart() {
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 26;
  const W = 600 - PAD_L - PAD_R;
  const H = 180 - PAD_T - PAD_B;
  const days = 13;
  const maxY = 150000;

  const points = INGRESOS_DIA.map(([d, m]) => ({
    x: PAD_L + ((d - 1) / (days - 1)) * W,
    y: PAD_T + H - (m / maxY) * H,
    d,
    m,
  }));
  const labPoints = points.filter((p) => p.m > 0);
  const path = labPoints.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const lastPoint = labPoints[labPoints.length - 1];
  const firstPoint = labPoints[0];
  const area = path + ` L ${lastPoint.x} ${PAD_T + H} L ${firstPoint.x} ${PAD_T + H} Z`;
  const ticks = [0, 50000, 100000, 150000];

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

      {[1, 5, 9, 13].map((d) => {
        const x = PAD_L + ((d - 1) / (days - 1)) * W;
        return (
          <text key={d} x={x} y={PAD_T + H + 16} textAnchor="middle" fill="var(--ink-3)" fontSize="10" fontFamily="Geist Mono">
            {d} may
          </text>
        );
      })}

      <path d={area} fill="url(#fn-area)" />
      <path d={path} stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {labPoints.map((p) => {
        const isToday = p.d === 13;
        return (
          <g key={p.d}>
            <circle cx={p.x} cy={p.y} r={isToday ? 4.5 : 3} fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.8" />
            {isToday ? <circle cx={p.x} cy={p.y} r="2.5" fill="var(--accent)" /> : null}
          </g>
        );
      })}

      <line x1={lastPoint.x} y1={PAD_T} x2={lastPoint.x} y2={PAD_T + H} stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
      <text x={lastPoint.x} y={PAD_T - 2} textAnchor="middle" fill="var(--accent-2)" fontSize="10" fontFamily="Geist Mono" letterSpacing=".08em">
        HOY
      </text>
    </svg>
  );
}

// ─── Donut ──────────────────────────────────────────────────────────────────

function Donut() {
  const total = SERVICIOS_BREAKDOWN.reduce((s, x) => s + x.monto, 0);
  const cx = 90;
  const cy = 90;
  const r = 64;
  const stroke = 22;
  let angle = -Math.PI / 2;

  const arcs = SERVICIOS_BREAKDOWN.map((s) => {
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

// ─── Tabla ──────────────────────────────────────────────────────────────────

function TablaTransacciones() {
  return (
    <div className="fn-table-wrap">
      <header className="fn-table-head">
        <span className="fi-eyebrow">Transacciones recientes</span>
        <div className="fn-table-tools">
          <div className="fn-table-search">
            <I.Search size={12} />
            <input placeholder="Buscar paciente, monto…" />
          </div>
          <button type="button" className="fi-btn fi-btn-secondary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Exportar
          </button>
        </div>
      </header>
      <table className="fn-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Paciente</th>
            <th>Servicio</th>
            <th>Método</th>
            <th className="ta-r">Monto</th>
          </tr>
        </thead>
        <tbody>
          {TRANSACCIONES.map((t) => {
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
      <footer className="fn-table-foot">
        <span className="muted">Mostrando 11 de 38 · mayo 2026</span>
        <button type="button" className="pc-link">
          Ver todas →
        </button>
      </footer>
    </div>
  );
}

// ─── Page header ────────────────────────────────────────────────────────────

function PageHeader({ periodo, setPeriodo }: { periodo: string; setPeriodo: (v: string) => void }) {
  const periods: [string, string][] = [
    ["hoy", "Hoy"],
    ["semana", "Semana"],
    ["mes", "Este mes"],
    ["6m", "6 meses"],
    ["12m", "Año"],
  ];
  return (
    <header className="fn-head">
      <div>
        <span className="fi-eyebrow">finanzas · mayo 2026</span>
        <h1>Ingresos del mes</h1>
        <p className="fn-head-sub">Jornada en curso · datos hasta las 11:38 de hoy</p>
      </div>
      <div className="fn-head-controls">
        <div className="fn-period">
          {periods.map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              className={"fn-period-btn " + (periodo === id ? "is-active" : "")}
              onClick={() => setPeriodo(id)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export function Finanzas() {
  const [periodo, setPeriodo] = useState("mes");

  const totalIngresos = useMemo(() => INGRESOS_DIA.reduce((s, [, m]) => s + m, 0), []);
  const totalSesiones = useMemo(() => SERVICIOS_BREAKDOWN.reduce((s, x) => s + x.count, 0), []);
  const ticketProm = Math.round(totalIngresos / totalSesiones);
  const proyeccion = Math.round(totalIngresos * (31 / 13));

  return (
    <div className="fi-content fn-content">
      <PageHeader periodo={periodo} setPeriodo={setPeriodo} />
      <KpiStrip
        totalIngresos={totalIngresos}
        totalSesiones={totalSesiones}
        ticketProm={ticketProm}
        proyeccion={proyeccion}
      />

      <div className="fn-charts-grid">
        <section className="fn-chart-card">
          <header>
            <span className="fi-eyebrow">Ingresos diarios · este mes</span>
            <span className="fn-chart-sub fm-mono">+18% vs abril</span>
          </header>
          <LineChart />
        </section>
        <section className="fn-chart-card">
          <header>
            <span className="fi-eyebrow">Por servicio</span>
            <span className="fn-chart-sub muted">26 sesiones</span>
          </header>
          <Donut />
        </section>
      </div>

      <TablaTransacciones />
    </div>
  );
}
