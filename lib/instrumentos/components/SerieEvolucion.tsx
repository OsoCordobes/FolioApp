"use client";

/**
 * Folio · biblioteca de instrumentos · SerieEvolucion (C3).
 *
 * Sparkline longitudinal GENÉRICO — unifica los dos sparklines duplicados casi
 * verbatim (PsicoSparkline de psico, CardioSparkline de cardio) en UN componente
 * parametrizado por métricas. Mismo markup y tokens que los originales:
 *   - `<svg viewBox 0 0 320 110>` responsive, `role="img"` con aria-label es-AR;
 *   - línea base (--line-soft), una polilínea + círculos por métrica (color =
 *     var() de folio.css), último punto un poco más grande;
 *   - leyenda con `.pc-spine-legend` / `.pc-legend-item` / `.pc-legend-swatch`
 *     + rango de fechas en `.fm-mono muted`.
 *
 * La geometría/escala salen de planilla-core (escalaSerie / puntosMetrica /
 * valoresDeSerie), puras y testeadas. `pisoCero`: true para puntajes de escalas
 * (arrancan en 0), false para vitales (TA/FC no arrancan en 0). Empty-state con
 * copy configurable. Sin PHI: solo puntajes agregados + fechas.
 */

import type { CSSProperties } from "react";

import {
  escalaSerie,
  puntosMetrica,
  valoresDeSerie,
  type MetricaSerie,
  type PuntoSerie,
} from "./planilla-core";

const W = 320;
const H = 110;
const PX = 8;
const PY = 12;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Fecha corta es-AR "9 jun 26" a partir de un ISO YYYY-MM-DD. */
function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

export interface SerieEvolucionProps {
  /** Puntos de la serie, ASC por fecha (el más viejo primero). */
  serie: PuntoSerie[];
  /** Métricas a graficar (clave/label/color). Cada una es una línea. */
  metricas: MetricaSerie[];
  /**
   * true → ancla el eje Y en 0 (puntajes de escalas). false → min/max reales
   * con margen (vitales). Default true.
   */
  pisoCero?: boolean;
  /** Etiqueta accesible del gráfico (aria-label). Default genérica. */
  ariaLabel?: string;
  /** Copy del empty-state cuando no hay ningún dato numérico. */
  vacio?: string;
  /** Estilo del contenedor externo (para encajar en distintos layouts). */
  style?: CSSProperties;
}

/**
 * Sparkline longitudinal genérico. Descarta métricas sin ningún dato; muestra
 * el empty-state si no hay ningún valor numérico en toda la serie. Un solo punto
 * se dibuja centrado; ≥2 puntos trazan la polilínea.
 */
export function SerieEvolucion({
  serie,
  metricas,
  pisoCero = true,
  ariaLabel,
  vacio = "Sin datos en el historial todavía. La curva aparece al guardar registros.",
  style,
}: SerieEvolucionProps) {
  const valores = valoresDeSerie(serie, metricas);

  if (serie.length === 0 || valores.length === 0) {
    return (
      <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
        {vacio}
      </p>
    );
  }

  const { min, max } = escalaSerie(valores, { pisoCero });
  const x = (i: number) =>
    serie.length === 1 ? W / 2 : PX + (i * (W - 2 * PX)) / (serie.length - 1);
  const y = (v: number) =>
    max === min ? H / 2 : H - PY - ((v - min) * (H - 2 * PY)) / (max - min);

  // Solo las métricas que tienen al menos un punto con dato.
  const activas = metricas
    .map((m) => ({ ...m, puntos: puntosMetrica(serie, m.key) }))
    .filter((m) => m.puntos.length > 0);

  const label =
    ariaLabel ??
    `Evolución de ${activas.map((m) => m.label).join(", ")} en ${serie.length} ${serie.length === 1 ? "registro" : "registros"}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
        style={{ width: "100%", display: "block" }}
      >
        <line
          x1={PX} y1={H - PY} x2={W - PX} y2={H - PY}
          stroke="var(--line-soft)" strokeWidth="1"
        />
        {activas.map((m) => (
          <g key={m.key}>
            {m.puntos.length > 1 ? (
              <polyline
                points={m.puntos.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                fill="none"
                stroke={m.color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {m.puntos.map((p, idx) => (
              <circle
                key={p.i}
                cx={x(p.i)}
                cy={y(p.v)}
                r={idx === m.puntos.length - 1 ? 3 : 2}
                fill={m.color}
              />
            ))}
          </g>
        ))}
      </svg>
      <div className="pc-spine-legend" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", gap: 12 }}>
          {activas.map((m) => (
            <span key={m.key} className="pc-legend-item">
              <span className="pc-legend-swatch" style={{ background: m.color }} />
              <span>{m.label}</span>
            </span>
          ))}
        </span>
        <span className="fm-mono muted" style={{ fontSize: 10 }}>
          {fmtFecha(serie[0].fecha)}
          {serie.length > 1 ? ` → ${fmtFecha(serie[serie.length - 1].fecha)}` : ""}
        </span>
      </div>
    </div>
  );
}
