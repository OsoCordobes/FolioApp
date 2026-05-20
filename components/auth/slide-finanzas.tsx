"use client";

/**
 * Folio · Auth · Slide 3 (Finanzas · "Tu mes en una mirada")
 *
 * Port fiel de SlideFinanzas en folio/auth.jsx (líneas 399-583).
 *
 * Beats:
 *   T400/550/700  KPIs entran staggered con count-up
 *   T1500         Chart card aparece
 *   T1800         Línea brass dibuja
 *   T2700         Punto HOY pop + halo + vertical HOY line
 *   T3100         Tooltip "14 may · $160k" con leader line
 *   T3900         Deltas verde aparecen bajo cada KPI
 *   T4800         Badge "Mejor mes del año" bounce
 *   T5500–8500    HOLD
 */

import { type ReactNode } from "react";

import { MDiv } from "@/components/motion/m";
import { useCountUp } from "@/components/auth/use-count-up";
import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

interface Kpi {
  label: string;
  val: ReactNode;
  sub: string;
  delta: string;
  tone: "primary" | null;
}

const PAD_L = 30;
const PAD_R = 12;
const PAD_T = 8;
const PAD_B = 22;
const W = 360;
const H = 110;
const CHART_W = W - PAD_L - PAD_R;
const CHART_H = H - PAD_T - PAD_B;
const DAYS = 14;
const MAX_Y = 180000;
const INGRESOS: [number, number][] = [
  [1, 35000], [2, 57000],
  [5, 81000], [6, 96000], [7, 74000], [8, 92000],
  [11, 134000], [12, 122000], [13, 142000], [14, 160000],
];

const fmtMoney = (n: number): string => {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
};

// Timings idénticos al pre-refactor — 9 beats encadenados:
//   400/550/700 → KPI 1/2/3 stagger (count-up triggers)
//   1500 → chart+dots+hoy-line entran (phase 1)
//   1800 → línea brass dibuja (phase 2)
//   2700 → halo + vertical HOY line (phase 3)
//   3100 → tooltip "14 may · $160k" (phase 4)
//   3900 → deltas verde aparecen (phase 5)
//   4800 → badge "Mejor mes del año" bounce (phase 6)
const PHASES_FINANZAS = [400, 550, 700, 1500, 1800, 2700, 3100, 3900, 4800] as const;

export function SlideFinanzas({ active }: Props) {
  const step = usePhaseSequence(PHASES_FINANZAS, active);
  // Los primeros 3 steps son kpis stagger; los restantes son phases tradicionales.
  const kpi: [boolean, boolean, boolean] = [step >= 1, step >= 2, step >= 3];
  const phase = Math.max(0, step - 3); // step 4 → phase 1, …, step 9 → phase 6

  const recaudado = useCountUp(1200, 700, kpi[0]);
  const sesiones = useCountUp(26, 600, kpi[1]);
  const ticket = useCountUp(46, 600, kpi[2]);

  const kpis: Kpi[] = [
    {
      label: "Recaudado",
      val: <><small>$</small>{(recaudado / 1000).toFixed(2)}<small>M</small></>,
      sub: "14 días",
      delta: "+18%",
      tone: "primary",
    },
    { label: "Sesiones", val: Math.round(sesiones), sub: "atendidas", delta: "+18%", tone: null },
    {
      label: "Ticket prom.",
      val: <><small>$</small>{Math.round(ticket)}<small>k</small></>,
      sub: "por sesión",
      delta: "+5%",
      tone: null,
    },
  ];

  const points = INGRESOS.map(([d, m]) => ({
    x: PAD_L + ((d - 1) / (DAYS - 1)) * CHART_W,
    y: PAD_T + CHART_H - (m / MAX_Y) * CHART_H,
    d,
    m,
  }));
  const path = points.map((p, i) => (i === 0 ? "M " + p.x + " " + p.y : "L " + p.x + " " + p.y)).join(" ");
  const area = path + " L " + points[points.length - 1].x + " " + (PAD_T + CHART_H) + " L " + points[0].x + " " + (PAD_T + CHART_H) + " Z";
  const lastPt = points[points.length - 1];
  const ticks = [0, 50000, 100000, 150000];
  const hoyOrigin = lastPt.x + "px " + lastPt.y + "px";
  const tipRightOffset = 12;

  return (
    <>
      <article
        className={
          "au2-fg au2-fin3 phase-" + phase +
          (kpi[0] ? " kpi-1" : "") +
          (kpi[1] ? " kpi-2" : "") +
          (kpi[2] ? " kpi-3" : "")
        }
      >
        <header className="au2-fin3-head">
          <span className="au2-fin3-eyebrow">finanzas · mayo 2026</span>
          <span className="au2-fin3-sub">14 de 31 días · cierre del día</span>
        </header>

        <div className="au2-fin3-kpis">
          {kpis.map((k, i) => (
            <div
              key={i}
              className={
                "au2-fin3-kpi au2-fin3-kpi-" + (i + 1) +
                (k.tone === "primary" ? " is-primary" : "")
              }
            >
              <span className="au2-fin3-kpi-lbl">{k.label}</span>
              {/* C13: shared element con el "$221k" del Calendario. layoutId
                  matchea entre slides; FM anima la transición física en el
                  cross-fade. layout="position" para evitar jumps por width
                  distinto entre las 2 cajas (el font-size cambia). */}
              {k.tone === "primary" ? (
                <MDiv layoutId="hero-money" layout="position" className="au2-fin3-kpi-val">
                  {k.val}
                </MDiv>
              ) : (
                <div className="au2-fin3-kpi-val">{k.val}</div>
              )}
              <div className="au2-fin3-kpi-foot">
                <span className="au2-fin3-kpi-sub">{k.sub}</span>
                <span className="au2-fin3-kpi-delta is-pos">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M7 17l10-10M17 17V7H7" />
                  </svg>
                  {k.delta}
                </span>
              </div>
            </div>
          ))}
        </div>

        <section className="au2-fin3-chartcard">
          <header className="au2-fin3-chartcard-head">
            <span className="au2-fin3-chartcard-eyebrow">Ingresos diarios · este mes</span>
            <span className="au2-fin3-chartcard-sub">+18% vs abril</span>
          </header>
          <div className="au2-fin3-chart-wrap">
            <svg className="au2-fin3-chart" viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none">
              <defs>
                <linearGradient id="au2-fin3-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {ticks.map((t, i) => {
                const y = PAD_T + CHART_H - (t / MAX_Y) * CHART_H;
                return (
                  <g key={i}>
                    <line
                      x1={PAD_L}
                      y1={y}
                      x2={W - PAD_R}
                      y2={y}
                      stroke="var(--line-soft)"
                      strokeWidth="1"
                      strokeDasharray={t === 0 ? "0" : "2 3"}
                    />
                    <text
                      x={PAD_L - 6}
                      y={y + 3}
                      textAnchor="end"
                      fill="var(--ink-3)"
                      fontSize="8"
                      fontFamily="Geist Mono"
                    >
                      {t === 0 ? "0" : fmtMoney(t)}
                    </text>
                  </g>
                );
              })}
              {[1, 5, 9, 13].map((d) => {
                const x = PAD_L + ((d - 1) / (DAYS - 1)) * CHART_W;
                return (
                  <text
                    key={d}
                    x={x}
                    y={PAD_T + CHART_H + 14}
                    textAnchor="middle"
                    fill="var(--ink-3)"
                    fontSize="8"
                    fontFamily="Geist Mono"
                  >
                    {d} may
                  </text>
                );
              })}
              <path className="au2-fin3-area" d={area} fill="url(#au2-fin3-area)" />
              <path
                className="au2-fin3-line"
                d={path}
                pathLength="100"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.slice(0, -1).map((p, i) => (
                <circle
                  key={i}
                  className="au2-fin3-dot-small"
                  cx={p.x}
                  cy={p.y}
                  r="2.5"
                  fill="var(--surface)"
                  stroke="var(--accent)"
                  strokeWidth="1.6"
                />
              ))}
              {phase >= 3 ? (
                <line
                  className="au2-fin3-hoy-line"
                  x1={lastPt.x}
                  y1={PAD_T}
                  x2={lastPt.x}
                  y2={PAD_T + CHART_H}
                  stroke="var(--accent)"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  opacity="0.45"
                />
              ) : null}
              <circle
                className="au2-fin3-dot-hoy"
                cx={lastPt.x}
                cy={lastPt.y}
                r="4"
                fill="var(--surface)"
                stroke="var(--accent)"
                strokeWidth="2"
                style={{ transformOrigin: hoyOrigin }}
              />
              <circle
                className="au2-fin3-dot-hoy-inner"
                cx={lastPt.x}
                cy={lastPt.y}
                r="2"
                fill="var(--accent)"
                style={{ transformOrigin: hoyOrigin }}
              />
              {phase >= 3 ? (
                <circle
                  className="au2-fin3-halo"
                  cx={lastPt.x}
                  cy={lastPt.y}
                  r="4"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  style={{ transformOrigin: hoyOrigin }}
                />
              ) : null}
              <text
                className="au2-fin3-hoy-label"
                x={lastPt.x}
                y={PAD_T - 1}
                textAnchor="middle"
                fill="var(--accent-2)"
                fontSize="7.5"
                fontFamily="Geist Mono"
                letterSpacing="0.1em"
              >
                HOY
              </text>
            </svg>
          </div>
        </section>
      </article>

      <div
        className={"au2-fin3-tip" + (phase >= 4 ? " is-on" : "")}
        style={{ right: tipRightOffset + "px" }}
        aria-hidden={phase < 4}
      >
        <div className="au2-fin3-tip-card">
          <b>14 may · $160k</b>
          <span className="au2-fin3-tip-meta">tu mejor día</span>
        </div>
        <span className="au2-fin3-tip-arrow" aria-hidden="true" />
      </div>

      <div className={"au2-fin3-badge" + (phase >= 6 ? " is-on" : "")} aria-hidden={phase < 6}>
        <span className="au2-fin3-badge-glyph">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3 7h7l-5.5 4.5L18 22l-6-4-6 4 1.5-8.5L2 9h7z" />
          </svg>
        </span>
        <span>
          <b>Mejor mes del año</b> · $1.2M recaudado
        </span>
      </div>
    </>
  );
}
