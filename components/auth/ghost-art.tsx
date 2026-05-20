"use client";

/**
 * Folio · SideArt · ghost UI layers
 *
 * Componentes decorativos (no funcionales) que aparecen detrás del foreground
 * card de cada slide, dando depth visual sin competir con el contenido
 * principal. Equivalente al concept de "container transform" de Material 3:
 * la silueta del app real apareciendo de fondo para que el slide se sienta
 * "parte del producto", no una card aislada.
 *
 * Estilo (controlado por .au2-fg-ghost en folio.css):
 *   - position: absolute, inset negativo (overlap leve fuera del bounding)
 *   - z-index: -1 (atrás del foreground)
 *   - opacity 0.18 + blur 1.5px + saturate 0.6 (presente pero borroso)
 *   - pointer-events: none + user-select: none (decorativo puro)
 *
 * Usado en:
 *   - slide-ia.tsx: <GhostSidebar /> (la nav del app real, columna izq)
 *   - slide-reagenda.tsx: <GhostCalendar /> (vista semana fantasma)
 */

import type { CSSProperties } from "react";

const ghostStyle: CSSProperties = {
  position: "absolute",
  inset: "-8% -4% -4% -4%",
  zIndex: -1,
  opacity: 0.18,
  filter: "blur(1.5px) saturate(0.6)",
  pointerEvents: "none",
  userSelect: "none",
  overflow: "hidden",
};

/**
 * Silueta de un sidebar tipo Linear/Notion: avatar arriba, lista de items
 * agrupada, indicator del item activo. Usa accent_soft para que tinte con
 * el slide actual (--accent var).
 */
export function GhostSidebar() {
  return (
    <svg
      style={ghostStyle}
      className="au2-fg-ghost au2-fg-ghost-sidebar"
      viewBox="0 0 480 360"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {/* Sidebar column (left 80px) */}
      <rect x="0" y="0" width="80" height="360" fill="var(--surface-2, #f5f3ee)" />
      <rect x="80" y="0" width="1" height="360" fill="var(--line, #e8e2d2)" />
      {/* Avatar circle top */}
      <circle cx="40" cy="40" r="14" fill="var(--accent)" opacity="0.4" />
      {/* Nav items */}
      {[80, 120, 160, 200, 240].map((y, i) => (
        <g key={y}>
          <rect x="14" y={y - 6} width="52" height="12" rx="3"
            fill={i === 1 ? "var(--accent)" : "var(--surface-2, #f5f3ee)"}
            opacity={i === 1 ? "0.5" : "0.8"} />
        </g>
      ))}
      {/* Right area: cards skeleton */}
      <rect x="120" y="40" width="280" height="56" rx="8" fill="var(--surface, #fff)" stroke="var(--line, #e8e2d2)" />
      <rect x="120" y="116" width="280" height="56" rx="8" fill="var(--surface, #fff)" stroke="var(--line, #e8e2d2)" />
      <rect x="120" y="192" width="280" height="56" rx="8" fill="var(--surface, #fff)" stroke="var(--line, #e8e2d2)" />
    </svg>
  );
}

/**
 * Silueta de una vista calendario semanal: 7 columnas, algunos slots
 * highlighted con accent. Para slide-reagenda donde el wizard ocurre
 * "encima" de la vista calendario.
 */
export function GhostCalendar() {
  return (
    <svg
      style={ghostStyle}
      className="au2-fg-ghost au2-fg-ghost-calendar"
      viewBox="0 0 480 360"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {/* Header */}
      <rect x="0" y="0" width="480" height="40" fill="var(--surface, #fff)" />
      <line x1="0" y1="40" x2="480" y2="40" stroke="var(--line, #e8e2d2)" />
      {/* 7 columnas */}
      {Array.from({ length: 7 }).map((_, i) => {
        const x = (i * 480) / 7;
        return (
          <g key={i}>
            <line x1={x} y1="40" x2={x} y2="360" stroke="var(--line-soft, #f0ecde)" />
            <text x={x + 8} y="28" fontSize="10" fill="var(--ink-3)" fontFamily="Geist Mono">
              {["L", "M", "X", "J", "V", "S", "D"][i]}
            </text>
          </g>
        );
      })}
      {/* Algunos slots con accent (turnos fantasma) */}
      {[
        [0, 80, 26],
        [1, 120, 26],
        [2, 90, 18],
        [3, 140, 32],
        [4, 70, 22],
      ].map(([col, y, h], i) => {
        const xStart = ((col as number) * 480) / 7 + 4;
        const w = 480 / 7 - 8;
        return (
          <rect key={i} x={xStart} y={y as number} width={w} height={h as number} rx="3"
            fill={i === 1 ? "var(--accent)" : "var(--surface-2, #f5f3ee)"}
            opacity={i === 1 ? "0.7" : "0.85"} />
        );
      })}
    </svg>
  );
}
