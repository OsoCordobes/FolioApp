"use client";

/**
 * Folio · especialidades · quiropraxia · mapa vertebral v2 (Workstream 6).
 *
 * Reescritura para la ficha v2: dos vistas (posterior — hoja de trabajo
 * clásica, columna centrada — y lateral — la curva legacy SPINE_VERTEBRAS) con
 * un toggle. Click sobre una vértebra abre un PANEL LATERAL fijo con dos
 * textareas: "Técnica de ajuste" y "Listado", que escriben en
 * data.vertebras[id]. Una vértebra con CUALQUIER contenido muestra un marcador
 * único color acento (se retiró la clasificación de 5 estados de v1).
 *
 * Controlado: deriva todo de `data` (toolData v2) y emite cada cambio con
 * `onChange(next)`. readOnly deshabilita la edición (snapshot / sin turno).
 *
 * El panel cierra con Escape y con click afuera. Se prefiere un panel lateral
 * fijo al lado del SVG (no un popover anclado a la vértebra): más fácil de
 * posicionar para ambas vistas.
 */

import { useEffect, useRef, useState } from "react";

import * as I from "@/components/icons";
import {
  POSTERIOR_VERTEBRAS,
  SPINE_VERTEBRAS,
} from "@/lib/especialidades/quiropraxia/spine-config";
import type {
  QuiropraxiaToolDataV2,
  VistaQuiro,
} from "@/lib/especialidades/quiropraxia/schema";

interface SpineMapProps {
  data: QuiropraxiaToolDataV2;
  onChange: (next: QuiropraxiaToolDataV2) => void;
  readOnly?: boolean;
}

type VertNota = NonNullable<QuiropraxiaToolDataV2["vertebras"]>[number];

function notaDe(data: QuiropraxiaToolDataV2, id: string): VertNota | undefined {
  return (data.vertebras ?? []).find((v) => v.id === id);
}

function tieneContenido(n: VertNota | undefined): boolean {
  if (!n) return false;
  return (
    (n.tecnicaAjuste != null && n.tecnicaAjuste.trim() !== "") ||
    (n.listado != null && n.listado.trim() !== "")
  );
}

export function SpineMap({ data, onChange, readOnly }: SpineMapProps) {
  const vista: VistaQuiro = data.vista ?? "posterior";
  const [selected, setSelected] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape + click afuera cierran el panel de la vértebra.
  useEffect(() => {
    if (selected == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(t)) {
        // No cerrar al clickear una vértebra del SVG (eso lo maneja su handler).
        const svgVert = (e.target as HTMLElement)?.closest?.("[data-vert]");
        if (!svgVert) setSelected(null);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [selected]);

  const setVista = (next: VistaQuiro) => {
    if (readOnly) return;
    setSelected(null);
    onChange({ ...data, vista: next });
  };

  const updateNota = (id: string, patch: Partial<Pick<VertNota, "tecnicaAjuste" | "listado">>) => {
    if (readOnly) return;
    const vertebras = [...(data.vertebras ?? [])];
    const idx = vertebras.findIndex((v) => v.id === id);
    const merged: VertNota = { id, ...(idx >= 0 ? vertebras[idx] : {}), ...patch };
    // Si quedó sin contenido, sacarla del array (no acumular vértebras vacías).
    if (!tieneContenido(merged)) {
      if (idx >= 0) vertebras.splice(idx, 1);
    } else if (idx >= 0) {
      vertebras[idx] = merged;
    } else {
      vertebras.push(merged);
    }
    onChange({ ...data, vertebras });
  };

  const selectedNota = selected ? notaDe(data, selected) : undefined;

  return (
    <div className="pc-quiro-spine">
      <header className="pc-quiro-spine-head">
        <div>
          <span className="fi-eyebrow">Mapa vertebral</span>
          <p className="pc-quiro-muted">
            Click sobre una vértebra para cargar técnica de ajuste y listado.
          </p>
        </div>
        <div className="pc-quiro-vista-toggle" role="group" aria-label="Cambiar vista">
          {(["posterior", "lateral"] as VistaQuiro[]).map((v) => (
            <button
              key={v}
              type="button"
              className={"pc-quiro-pill " + (vista === v ? "is-active" : "")}
              onClick={() => setVista(v)}
              disabled={readOnly}
              aria-pressed={vista === v}
            >
              {v === "posterior" ? "Posterior" : "Lateral"}
            </button>
          ))}
        </div>
      </header>

      <div className="pc-quiro-spine-body">
        <div className="pc-quiro-spine-svg-wrap">
          {vista === "posterior" ? (
            <PosteriorSvg data={data} selected={selected} onPick={setSelected} />
          ) : (
            <LateralSvg data={data} selected={selected} onPick={setSelected} />
          )}
        </div>

        {selected ? (
          <aside className="pc-quiro-vert-panel" ref={panelRef}>
            <div className="pc-quiro-vert-panel-head">
              <b>{labelDe(selected, vista)}</b>
              <button
                type="button"
                className="pc-quiro-icon-btn"
                onClick={() => setSelected(null)}
                aria-label="Cerrar"
              >
                <I.X size={14} />
              </button>
            </div>
            <label className="fi-wi-field">
              <span>Técnica de ajuste</span>
              <textarea
                className="pc-soap-textarea"
                rows={3}
                maxLength={500}
                value={selectedNota?.tecnicaAjuste ?? ""}
                onChange={(e) => updateNota(selected, { tecnicaAjuste: e.target.value })}
                readOnly={readOnly}
                placeholder="Ej. diversificada, drop, thompson…"
              />
            </label>
            <label className="fi-wi-field">
              <span>Listado</span>
              <textarea
                className="pc-soap-textarea"
                rows={3}
                maxLength={500}
                value={selectedNota?.listado ?? ""}
                onChange={(e) => updateNota(selected, { listado: e.target.value })}
                readOnly={readOnly}
                placeholder="Ej. PLI, PRS, ASRP…"
              />
            </label>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// ─── Etiqueta humana de una vértebra según la vista ──────────────────────────

function labelDe(id: string, vista: VistaQuiro): string {
  if (vista === "posterior") {
    return POSTERIOR_VERTEBRAS.find((v) => v.id === id)?.label ?? id;
  }
  return id;
}

// ─── Vista posterior: columna centrada (hoja de trabajo) ─────────────────────

function PosteriorSvg({
  data,
  selected,
  onPick,
}: {
  data: QuiropraxiaToolDataV2;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <svg
      className="pc-quiro-svg"
      viewBox="0 0 220 620"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Mapa vertebral posterior"
    >
      {/* Línea media de la columna. */}
      <line
        x1="110"
        y1="30"
        x2="110"
        y2="610"
        stroke="var(--line-soft)"
        strokeWidth="2"
      />
      {POSTERIOR_VERTEBRAS.map((v) => {
        const nota = notaDe(data, v.id);
        const filled = tieneContenido(nota);
        const isSelected = selected === v.id;
        return (
          <g
            key={v.id}
            data-vert={v.id}
            transform={`translate(${v.x} ${v.y})`}
            onClick={() => onPick(v.id)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={-v.w / 2}
              y={-v.h / 2}
              width={v.w}
              height={v.h}
              rx="3"
              fill={filled ? "var(--accent)" : "var(--surface)"}
              stroke={isSelected ? "var(--ink)" : filled ? "var(--accent)" : "var(--ink-4)"}
              strokeWidth={isSelected ? 1.8 : 1}
              style={{ transition: "fill 200ms var(--ease-in)" }}
            />
            <text
              x={-v.w / 2 - 6}
              y={4}
              textAnchor="end"
              fontSize="9"
              fill="var(--ink-3)"
            >
              {v.label}
            </text>
            {filled ? (
              <circle cx={0} cy={0} r="2.4" fill="var(--surface)" />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Vista lateral: la curva legacy SPINE_VERTEBRAS ──────────────────────────

function LateralSvg({
  data,
  selected,
  onPick,
}: {
  data: QuiropraxiaToolDataV2;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <svg
      className="pc-quiro-svg"
      viewBox="0 0 220 620"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Mapa vertebral lateral"
    >
      <defs>
        <linearGradient id="pc-quiro-spine-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--line-soft)" stopOpacity="0" />
          <stop offset="20%" stopColor="var(--line-soft)" stopOpacity="0.6" />
          <stop offset="80%" stopColor="var(--line-soft)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--line-soft)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path
        d="M 122 40 C 138 100, 134 130, 122 170 C 110 200, 86 290, 88 330 C 92 380, 130 470, 134 500 C 144 540, 146 580, 132 610"
        fill="none"
        stroke="url(#pc-quiro-spine-fade)"
        strokeWidth="22"
        strokeLinecap="round"
      />

      {SPINE_VERTEBRAS.map((v) => {
        const nota = notaDe(data, v.id);
        const filled = tieneContenido(nota);
        const isSelected = selected === v.id;
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
        return (
          <g
            key={v.id}
            data-vert={v.id}
            transform={`translate(${v.x} ${v.y}) rotate(${v.tilt})`}
            onClick={() => onPick(v.id)}
            style={{ cursor: "pointer" }}
          >
            <path
              d={path}
              fill={filled ? "var(--accent)" : "var(--surface)"}
              stroke={isSelected ? "var(--ink)" : filled ? "var(--accent)" : "var(--ink-4)"}
              strokeWidth={isSelected ? 1.6 : 0.9}
              strokeLinejoin="round"
              style={{ transition: "fill 200ms var(--ease-in)" }}
            />
          </g>
        );
      })}
    </svg>
  );
}
