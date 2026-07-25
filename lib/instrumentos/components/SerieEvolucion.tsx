"use client";

/**
 * Folio · biblioteca de instrumentos · SerieEvolucion (C3 · curvas que hablan D3).
 *
 * Sparkline longitudinal GENÉRICO — unifica los sparklines duplicados de las
 * tools (psico, cardio, kinesio, nutrición) en UN componente parametrizado por
 * métricas. Mismo markup y tokens que los originales:
 *   - `<svg viewBox 0 0 320 110>` responsive, `role="img"` con aria-label es-AR;
 *   - línea base (--line-soft), una polilínea + círculos por métrica (color =
 *     var() de folio.css), último punto un poco más grande;
 *   - leyenda con `.pc-spine-legend` / `.pc-legend-item` / `.pc-legend-swatch`
 *     + rango de fechas en `.fm-mono muted`.
 *
 * Curvas que HABLAN (D3):
 *   - `<title>` nativo por punto ("PHQ-9 12 · 9 jun 26") — tooltip sin JS;
 *   - labels min/max del eje Y (fm-mono 9px) junto a la línea base --line-soft
 *     (solo con escala compartida — en modo normalizado no hay eje único);
 *   - el último valor de cada métrica anotado junto al punto final, en el color
 *     de la métrica, con anti-colisión vertical (distribuirEtiquetas).
 *   - modo `normalizado`: métricas de escalas dispares (EVA 0–10 vs ODI 0–100)
 *     se dibujan cada una contra su propio rango (dominio del instrumento o
 *     min/max observado — escalasPorMetrica); el tooltip y la anotación siempre
 *     muestran el VALOR REAL.
 *
 * La geometría/escala salen de planilla-core (escalaSerie / escalasPorMetrica /
 * puntosMetrica / valoresDeSerie / distribuirEtiquetas), puras y testeadas.
 * `pisoCero`: true para puntajes de escalas (arrancan en 0), false para vitales
 * (TA/FC no arrancan en 0). Empty-state con copy configurable. Sin PHI: solo
 * puntajes agregados + fechas.
 */

import type { CSSProperties } from "react";

import {
  distribuirEtiquetas,
  escalaSerie,
  escalasPorMetrica,
  puntosMetrica,
  valoresDeSerie,
  type MetricaSerie,
  type PuntoSerie,
} from "./planilla-core";

const W = 320;
const H = 110;
const PY = 12;
/** Gutter derecho: la anotación del último valor de cada métrica. */
const PXR = 34;
/** Gutter izquierdo con labels de eje Y (escala compartida) / sin labels. */
const PXL_CON_EJE = 26;
const PXL_SIN_EJE = 8;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Fecha corta es-AR "9 jun 26" a partir de un ISO YYYY-MM-DD. */
function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

/** Número compacto para labels/anotaciones: entero tal cual, decimal a 1 lugar. */
function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export interface SerieEvolucionProps {
  /** Puntos de la serie, ASC por fecha (el más viejo primero). */
  serie: PuntoSerie[];
  /** Métricas a graficar (clave/label/color, y dominio para el modo normalizado). */
  metricas: MetricaSerie[];
  /**
   * true → ancla el eje Y en 0 (puntajes de escalas). false → min/max reales
   * con margen (vitales). Default true. Ignorado en modo `normalizado`.
   */
  pisoCero?: boolean;
  /**
   * true → cada métrica se escala a su PROPIO rango (dominio declarado o min/max
   * observado) en vez de compartir el eje Y. Para métricas de escalas dispares
   * (EVA 0–10 aplastada contra ODI 0–100). El tooltip y la anotación del último
   * valor siempre muestran el valor real. Default false.
   */
  normalizado?: boolean;
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
  normalizado = false,
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

  // Escalas: una compartida (con labels de eje) o una por métrica (normalizado).
  const escalaGlobal = escalaSerie(valores, { pisoCero });
  const escalas = normalizado ? escalasPorMetrica(serie, metricas) : null;
  const escalaDe = (key: string) => escalas?.[key] ?? escalaGlobal;

  const pxl = normalizado ? PXL_SIN_EJE : PXL_CON_EJE;
  const x = (i: number) =>
    serie.length === 1 ? (pxl + (W - PXR)) / 2 : pxl + (i * (W - pxl - PXR)) / (serie.length - 1);
  const y = (v: number, esc: { min: number; max: number }) =>
    esc.max === esc.min ? H / 2 : H - PY - ((v - esc.min) * (H - 2 * PY)) / (esc.max - esc.min);

  // Solo las métricas que tienen al menos un punto con dato.
  const activas = metricas
    .map((m) => ({ ...m, puntos: puntosMetrica(serie, m.key) }))
    .filter((m) => m.puntos.length > 0);

  // Anotación del último valor de cada métrica, con anti-colisión vertical.
  const anotaciones = activas.map((m) => {
    const ultimo = m.puntos[m.puntos.length - 1];
    return {
      key: m.key,
      color: m.color,
      texto: fmtNum(ultimo.v),
      x: x(ultimo.i) + 5,
      y: y(ultimo.v, escalaDe(m.key)),
    };
  });
  const ysEtiquetas = distribuirEtiquetas(
    anotaciones.map((a) => a.y),
    10,
    PY - 2,
    H - 4,
  );

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
          x1={pxl} y1={H - PY} x2={W - PXR} y2={H - PY}
          stroke="var(--line-soft)" strokeWidth="1"
        />
        {/* Labels min/max del eje Y — solo con escala compartida. */}
        {!normalizado ? (
          <g aria-hidden="true">
            <text
              x={pxl - 5} y={PY + 3} textAnchor="end"
              className="fm-mono" fontSize="9" fill="var(--ink-3)"
            >
              {fmtNum(escalaGlobal.max)}
            </text>
            <text
              x={pxl - 5} y={H - PY + 3} textAnchor="end"
              className="fm-mono" fontSize="9" fill="var(--ink-3)"
            >
              {fmtNum(escalaGlobal.min)}
            </text>
          </g>
        ) : null}
        {activas.map((m) => {
          const esc = escalaDe(m.key);
          return (
            <g key={m.key}>
              {m.puntos.length > 1 ? (
                <polyline
                  points={m.puntos.map((p) => `${x(p.i)},${y(p.v, esc)}`).join(" ")}
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
                  cy={y(p.v, esc)}
                  r={idx === m.puntos.length - 1 ? 3 : 2}
                  fill={m.color}
                >
                  {/* Tooltip nativo del browser — cero JS, valor REAL. */}
                  <title>{`${m.label} ${fmtNum(p.v)} · ${fmtFecha(serie[p.i].fecha)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {/* Último valor de cada métrica, junto al punto final. */}
        <g aria-hidden="true">
          {anotaciones.map((a, i) => (
            <text
              key={a.key}
              x={a.x}
              y={ysEtiquetas[i] + 3}
              className="fm-mono"
              fontSize="9"
              fill={a.color}
            >
              {a.texto}
            </text>
          ))}
        </g>
      </svg>
      <div className="pc-spine-legend" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
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
      {normalizado ? (
        <span className="muted" style={{ fontSize: 10, lineHeight: 1.4 }}>
          Escala propia por métrica — cada punto muestra su valor real.
        </span>
      ) : null}
    </div>
  );
}
