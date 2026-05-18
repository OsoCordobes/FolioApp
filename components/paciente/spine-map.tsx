"use client";

/**
 * Folio · Paciente · mapa vertebral (SVG, vista lateral anatómica).
 *
 * Port de `SpineMap` en folio/paciente.jsx (líneas 92-281). 24 vértebras
 * en lordosis cervical + cifosis dorsal + lordosis lumbar. Click marca
 * estado (normal/leve/moderado/severo/ajustada), hover muestra tooltip.
 */

import { useState } from "react";

import {
  ESTADO_VERT,
  PLAN,
  SPINE_VERTEBRAS,
  fmtFecha,
  type EstadoVertebra,
} from "@/lib/paciente-detalle-mock";

interface SpineMapProps {
  states: Record<string, EstadoVertebra>;
  setStates: (
    updater: (prev: Record<string, EstadoVertebra>) => Record<string, EstadoVertebra>,
  ) => void;
}

export function SpineMap({ states, setStates }: SpineMapProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const setVert = (id: string, estado: EstadoVertebra) => {
    setStates((prev) => {
      const next = { ...prev };
      if (estado === "normal") delete next[id];
      else next[id] = estado;
      return next;
    });
    setSelected(null);
  };

  const currentEstado = (id: string): EstadoVertebra => states[id] ?? "normal";
  const hoverData = hover ? SPINE_VERTEBRAS.find((v) => v.id === hover) ?? null : null;

  return (
    <div className="pc-spine-wrap">
      <header className="pc-spine-head">
        <div>
          <span className="fi-eyebrow">Mapa vertebral · vista lateral</span>
          <p>Click sobre una vértebra para marcar estado. Hover para detalle.</p>
        </div>
        <div className="pc-spine-legend">
          {(["normal", "leve", "moderado", "severo", "ajustada"] as EstadoVertebra[]).map((k) => (
            <span key={k} className="pc-legend-item">
              <span className="pc-legend-swatch" style={{ background: ESTADO_VERT[k].color }} />
              <span>{ESTADO_VERT[k].lbl}</span>
            </span>
          ))}
        </div>
      </header>

      <div className="pc-spine-body">
        <div className="pc-spine-region-labels">
          <span style={{ top: 90 }}>Cervical</span>
          <span style={{ top: 300 }}>Dorsal</span>
          <span style={{ top: 540 }}>Lumbar</span>
        </div>

        <svg
          className="pc-spine-svg"
          viewBox="0 0 220 620"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Mapa vertebral lateral"
        >
          <defs>
            <linearGradient id="pc-spine-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--line-soft)" stopOpacity="0" />
              <stop offset="20%" stopColor="var(--line-soft)" stopOpacity="0.6" />
              <stop offset="80%" stopColor="var(--line-soft)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--line-soft)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path
            d="M 122 40 C 138 100, 134 130, 122 170 C 110 200, 86 290, 88 330 C 92 380, 130 470, 134 500 C 144 540, 146 580, 132 610"
            fill="none"
            stroke="url(#pc-spine-fade)"
            strokeWidth="22"
            strokeLinecap="round"
          />

          <ellipse
            cx="120"
            cy="30"
            rx="34"
            ry="28"
            fill="none"
            stroke="var(--line-soft)"
            strokeWidth="1.5"
            strokeDasharray="2 3"
            opacity="0.6"
          />

          <path
            d="M 120 610 L 132 614 L 140 622 L 124 626 L 112 622 Z"
            fill="var(--line-soft)"
            opacity="0.5"
          />

          {SPINE_VERTEBRAS.map((v) => {
            const est = currentEstado(v.id);
            const cfg = ESTADO_VERT[est];
            const isHover = hover === v.id;
            const isSelected = selected === v.id;
            const filled = est !== "normal";
            const { w, h } = v;

            const path = `
              M ${-w * 0.5} 0
              Q ${-w * 0.32} ${-h * 0.28} ${-w * 0.08} ${-h * 0.42}
              L ${w * 0.32} ${-h * 0.5}
              Q ${w * 0.52} ${-h * 0.5} ${w * 0.52} ${-h * 0.3}
              L ${w * 0.52} ${h * 0.3}
              Q ${w * 0.52} ${h * 0.5} ${w * 0.32} ${h * 0.5}
              L ${-w * 0.08} ${h * 0.42}
              Q ${-w * 0.32} ${h * 0.28} ${-w * 0.5} 0
              Z`;

            const fill = filled ? cfg.color : "var(--surface)";
            const stroke = isSelected ? "var(--ink)" : filled ? cfg.ring : "var(--ink-4)";
            const sw = isSelected ? 1.6 : 0.9;

            return (
              <g
                key={v.id}
                transform={`translate(${v.x} ${v.y}) rotate(${v.tilt})`}
                onClick={() => setSelected(isSelected ? null : v.id)}
                onMouseEnter={() => setHover(v.id)}
                onMouseLeave={() => setHover((h2) => (h2 === v.id ? null : h2))}
                style={{ cursor: "default" }}
              >
                <ellipse
                  cx={w * 0.18}
                  cy={h * 0.55}
                  rx={w * 0.32}
                  ry={h * 0.08}
                  fill="rgba(27,24,18,.06)"
                />

                <path
                  d={path}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={sw}
                  strokeLinejoin="round"
                  style={{ transition: "fill 240ms var(--ease-in), stroke 120ms var(--ease-in)" }}
                />

                <circle
                  cx={-w * 0.02}
                  cy={0}
                  r={Math.min(w * 0.07, h * 0.22, 2.2)}
                  fill={filled ? "rgba(0,0,0,.22)" : "var(--line)"}
                />

                {filled ? (
                  <path
                    d={`M ${w * 0.05} ${-h * 0.36} Q ${w * 0.3} ${-h * 0.5} ${w * 0.45} ${-h * 0.3}`}
                    fill="none"
                    stroke="rgba(255,255,255,.32)"
                    strokeWidth="0.9"
                    strokeLinecap="round"
                  />
                ) : null}

                {isHover || isSelected ? (
                  <path
                    d={path}
                    fill="none"
                    stroke={cfg.ring}
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity="0.55"
                    transform="scale(1.18)"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {hoverData && !selected
          ? (() => {
              const est = currentEstado(hoverData.id);
              const cfg = ESTADO_VERT[est];
              const ultimo = PLAN.ultimoAjuste[hoverData.id];
              return (
                <div
                  className="pc-spine-tip"
                  style={{ left: hoverData.x + 30, top: hoverData.y - 24 }}
                >
                  <b>{hoverData.id}</b>
                  <span style={{ color: cfg.color }}>{cfg.lbl}</span>
                  {ultimo ? (
                    <span className="muted">último ajuste {fmtFecha(ultimo)}</span>
                  ) : null}
                </div>
              );
            })()
          : null}

        {selected
          ? (() => {
              const v = SPINE_VERTEBRAS.find((x) => x.id === selected);
              if (!v) return null;
              return (
                <div
                  className="pc-spine-popover"
                  style={{ left: v.x + 30, top: Math.min(v.y - 40, 480) }}
                >
                  <div className="pc-spine-popover-head">
                    <b>{selected}</b>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="pc-spine-popover-close"
                      aria-label="Cerrar"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="pc-spine-popover-opts">
                    {(Object.entries(ESTADO_VERT) as [EstadoVertebra, (typeof ESTADO_VERT)[EstadoVertebra]][]).map(([k, c]) => (
                      <button
                        key={k}
                        type="button"
                        className={"pc-spine-opt " + (currentEstado(selected) === k ? "is-active" : "")}
                        onClick={() => setVert(selected, k)}
                      >
                        <span className="pc-spine-opt-dot" style={{ background: c.color }} />
                        <span>{c.lbl}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()
          : null}
      </div>
    </div>
  );
}
