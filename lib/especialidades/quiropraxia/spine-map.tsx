"use client";

/**
 * Folio · especialidades · quiropraxia · mapa vertebral v2 (rework anatómico).
 *
 * La columna vive SIEMPRE en una franja lateral (el tool la pone en la columna
 * izquierda de un grid; ver tool.tsx + .pc-quiro-grid). La ilustración es
 * anatómicamente fiel a la hoja de trabajo: occipucio → cervicales → dorsales
 * (apófisis espinosas largas solapadas) → lumbares → sacro (triángulo con cresta
 * y forámenes) → cóccix, ensanchándose de arriba hacia abajo. NO son celdas
 * rectangulares.
 *
 * Vista posterior (default, la de la planilla) o lateral (toggle). Click sobre
 * una vértebra abre, DEBAJO de la ilustración, un panel con dos textareas:
 * "Técnica de ajuste" y "Listado" (reemplazan la clasificación de 5 estados de
 * v1). Una vértebra con contenido se pinta con el color de acento.
 *
 * Controlado: todo deriva de `data` (toolData v2) y se emite con `onChange`.
 * readOnly deshabilita edición (snapshot / sin turno).
 */

import { useEffect, useRef, useState } from "react";

import * as I from "@/components/icons";
import {
  POSTERIOR_ILIACOS,
  POSTERIOR_SACRO_Y,
  POSTERIOR_VERTEBRAS,
  POSTERIOR_VIEWBOX_W,
  SPINE_VERTEBRAS,
  type PosteriorIliaco,
  type PosteriorVertebra,
  type RegionVert,
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

const POSTERIOR_VIEWBOX_H =
  POSTERIOR_VERTEBRAS[POSTERIOR_VERTEBRAS.length - 1].y + 60;

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

  useEffect(() => {
    if (selected == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  // El panel vive DEBAJO de la ilustración dentro de la columna sticky
  // scrolleable (.pc-quiro-col-spine): al tocar una vértebra alta, sin este
  // scroll el panel quedaba fuera de vista y parecía que el click no hizo nada.
  useEffect(() => {
    if (selected == null) return;
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const setVista = (next: VistaQuiro) => {
    if (readOnly) return;
    onChange({ ...data, vista: next });
  };

  const updateNota = (
    id: string,
    patch: Partial<Pick<VertNota, "tecnicaAjuste" | "listado">>,
  ) => {
    if (readOnly) return;
    const vertebras = [...(data.vertebras ?? [])];
    const idx = vertebras.findIndex((v) => v.id === id);
    const merged: VertNota = { id, ...(idx >= 0 ? vertebras[idx] : {}), ...patch };
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
  // El seleccionado puede ser una vértebra o un ilíaco (feedback jul-2026):
  // el panel titula "Vértebra C4" o "Ilíaco izquierdo" según corresponda.
  const selectedIliaco = selected
    ? POSTERIOR_ILIACOS.find((i) => i.id === selected)
    : undefined;
  const selectedLabel = selected
    ? POSTERIOR_VERTEBRAS.find((v) => v.id === selected)?.label ?? selected
    : "";
  const selectedTitulo = selectedIliaco
    ? selectedIliaco.nombre
    : `Vértebra ${selectedLabel}`;

  return (
    <section className="pc-quiro-spine">
      <header className="pc-quiro-spine-head">
        <span className="fi-eyebrow">Mapa vertebral</span>
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

      <div className="pc-quiro-spine-illu">
        {vista === "posterior" ? (
          <PosteriorSvg data={data} selected={selected} onPick={setSelected} />
        ) : (
          <LateralSvg data={data} selected={selected} onPick={setSelected} />
        )}
      </div>

      {selected ? (
        <div className="pc-quiro-vert-panel" ref={panelRef}>
          <div className="pc-quiro-vert-panel-head">
            <b>{selectedTitulo}</b>
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
              rows={2}
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
              rows={2}
              maxLength={500}
              value={selectedNota?.listado ?? ""}
              onChange={(e) => updateNota(selected, { listado: e.target.value })}
              readOnly={readOnly}
              placeholder={selectedIliaco ? "Ej. PI, AS, In, Ex…" : "Ej. PLI, PRS, ASRP…"}
            />
          </label>
        </div>
      ) : (
        <p className="pc-quiro-muted pc-quiro-spine-hint">
          Tocá una vértebra o un ilíaco para cargar su técnica de ajuste y listado.
        </p>
      )}
    </section>
  );
}

// ─── Vista posterior · ilustración anatómica ─────────────────────────────────

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
      viewBox={`0 0 ${POSTERIOR_VIEWBOX_W} ${POSTERIOR_VIEWBOX_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Columna vertebral — vista posterior"
    >
      {/* Línea media (ligamento supraespinoso): ata la cadena de apófisis
          espinosas para que se lea como UNA columna continua. */}
      {(() => {
        const cerv = POSTERIOR_VERTEBRAS.find((v) => v.region === "cervical");
        const sac = POSTERIOR_VERTEBRAS.find((v) => v.region === "sacro");
        if (!cerv || !sac) return null;
        return (
          <line
            x1={POSTERIOR_VIEWBOX_W / 2}
            y1={cerv.y}
            x2={POSTERIOR_VIEWBOX_W / 2}
            y2={sac.y}
            stroke="var(--line-soft)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        );
      })()}
      {/* Ilíacos (capa VISUAL): se pintan ANTES de las vértebras para que el
          sacro, el cóccix y sus etiquetas del margen queden por encima de las
          alas. El click lo captura la capa de hit de abajo (IliacoHit), que va
          DESPUÉS de las vértebras — sin ella, los rects de hit a ancho completo
          de cada fila vertebral se tragarían el click sobre el ala. */}
      {POSTERIOR_ILIACOS.map((il) => (
        <IliacoVisual
          key={il.id}
          iliaco={il}
          filled={tieneContenido(notaDe(data, il.id))}
          selected={selected === il.id}
        />
      ))}
      {POSTERIOR_VERTEBRAS.map((v) => {
        const filled = tieneContenido(notaDe(data, v.id));
        const isSelected = selected === v.id;
        return (
          <g
            key={v.id}
            data-vert={v.id}
            transform={`translate(${v.x} ${v.y})`}
            onClick={() => onPick(v.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(v.id);
              }
            }}
            tabIndex={0}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label={`Vértebra ${v.label}`}
          >
            {/* Hit-area generosa para click fácil. */}
            <rect
              x={-POSTERIOR_VIEWBOX_W / 2}
              y={-v.h * 0.9}
              width={POSTERIOR_VIEWBOX_W}
              height={v.h * 1.8}
              fill="transparent"
            />
            <VertGlyph region={v.region} w={v.w} h={v.h} filled={filled} selected={isSelected} />
            <text
              x={-POSTERIOR_VIEWBOX_W / 2 + 4}
              y={3.5}
              textAnchor="start"
              fontSize="9"
              fontWeight={isSelected ? 700 : 500}
              fill={isSelected ? "var(--ink)" : "var(--ink-3)"}
              style={{ pointerEvents: "none" }}
            >
              {v.label}
            </text>
          </g>
        );
      })}
      {/* Ilíacos (capa de HIT): transparente, al final del SVG para ganarle el
          hit-test a los rects a ancho completo de las filas vertebrales. Lleva
          el foco/teclado y el aria-label. */}
      {POSTERIOR_ILIACOS.map((il) => (
        <IliacoHit key={il.id} iliaco={il} onPick={onPick} />
      ))}
    </svg>
  );
}

// ─── Ilíacos · vista posterior (feedback Lorenzo jul-2026) ───────────────────
//
// Ala ilíaca vista de atrás: cresta que sube y se abre por ENCIMA del borde
// superior del sacro, borde lateral descendente y lóbulo inferior (isquion)
// que se recoge hacia medial. El path se dibuja para el lado DERECHO (+x) y se
// espeja con scale(-1,1) para el izquierdo. Cerca de la altura de la etiqueta
// "Sacro" del margen (y ≈ 0) el ala se mantiene angosta a propósito para no
// pisar el texto del gutter izquierdo.
const ILIACO_PATH = `
  M 15 -12
  C 18 -23, 28 -31, 42 -33
  C 55 -35, 65 -29, 67 -18
  C 68 -10, 62 -4, 52 0
  C 45 3, 40 8, 37 15
  C 34 24, 30 32, 24 36
  C 18 40, 13 36, 13 28
  C 13 16, 14 2, 15 -12
  Z`;

function IliacoVisual({
  iliaco,
  filled,
  selected,
}: {
  iliaco: PosteriorIliaco;
  filled: boolean;
  selected: boolean;
}) {
  const fill = filled ? "var(--accent)" : "var(--surface)";
  const stroke = selected ? "var(--ink)" : filled ? "var(--accent)" : "var(--ink-4)";
  const detail = filled ? "rgba(255,255,255,.5)" : "var(--line)";
  return (
    <g transform={`translate(${POSTERIOR_VIEWBOX_W / 2} ${POSTERIOR_SACRO_Y})`}>
      <g transform={`scale(${iliaco.side} 1)`}>
        <path
          d={ILIACO_PATH}
          fill={fill}
          stroke={stroke}
          strokeWidth={selected ? 1.6 : 1}
          strokeLinejoin="round"
          style={{ transition: "fill 200ms var(--ease-in), stroke 120ms var(--ease-in)" }}
        />
        {/* Línea interna de la cresta ilíaca + fosita del EIPS. */}
        <path
          d="M 20 -14 C 26 -22, 36 -27, 47 -28"
          fill="none"
          stroke={detail}
          strokeWidth={1.2}
          strokeLinecap="round"
        />
        <circle cx={22} cy={-4} r={1.7} fill={detail} stroke="none" />
      </g>
      {/* Etiqueta fuera del grupo espejado (un scale(-1,1) invertiría el texto). */}
      <text
        x={iliaco.side * 40}
        y={-9}
        textAnchor="middle"
        fontSize="8"
        fontWeight={selected ? 700 : 500}
        fill={selected ? "var(--ink)" : "var(--ink-3)"}
        style={{ pointerEvents: "none" }}
      >
        {iliaco.label}
      </text>
    </g>
  );
}

function IliacoHit({
  iliaco,
  onPick,
}: {
  iliaco: PosteriorIliaco;
  onPick: (id: string) => void;
}) {
  return (
    <g
      data-vert={iliaco.id}
      transform={`translate(${POSTERIOR_VIEWBOX_W / 2} ${POSTERIOR_SACRO_Y}) scale(${iliaco.side} 1)`}
      onClick={() => onPick(iliaco.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(iliaco.id);
        }
      }}
      tabIndex={0}
      style={{ cursor: "pointer" }}
      role="button"
      aria-label={iliaco.nombre}
    >
      <path
        d={ILIACO_PATH}
        fill="transparent"
        stroke="transparent"
        strokeWidth={8}
      />
    </g>
  );
}

/**
 * Glifo anatómico de una vértebra en vista posterior, centrado en el origen.
 * Cada región dibuja su morfología característica (apófisis espinosa + apófisis
 * transversas + láminas; sacro triangular; cóccix; occipucio en domo).
 */
function VertGlyph({
  region,
  w,
  h,
  filled,
  selected,
}: {
  region: RegionVert;
  w: number;
  h: number;
  filled: boolean;
  selected: boolean;
}) {
  const fill = filled ? "var(--accent)" : "var(--surface)";
  const stroke = selected ? "var(--ink)" : filled ? "var(--accent)" : "var(--ink-4)";
  const sw = selected ? 1.6 : 1;
  const detail = filled ? "rgba(255,255,255,.5)" : "var(--line)";
  const common = {
    fill,
    stroke,
    strokeWidth: sw,
    strokeLinejoin: "round" as const,
    style: { transition: "fill 200ms var(--ease-in), stroke 120ms var(--ease-in)" },
  };

  if (region === "occipucio") {
    // Base del cráneo: domo ancho y chato con el agujero occipital insinuado.
    return (
      <g>
        <path d={`M ${-w / 2} 4 Q 0 ${-h * 1.4} ${w / 2} 4 Q 0 ${h * 0.5} ${-w / 2} 4 Z`} {...common} />
        <ellipse cx={0} cy={-1} rx={5} ry={3.4} fill={detail} stroke="none" />
      </g>
    );
  }

  if (region === "sacro") {
    // Triángulo invertido (ancho arriba) con cresta sacra media + 3 pares de
    // forámenes — la silueta inconfundible del sacro visto de atrás.
    const top = -h / 2;
    const bot = h / 2;
    return (
      <g>
        <path
          d={`M ${-w / 2} ${top} L ${w / 2} ${top} L ${w * 0.16} ${bot} L ${-w * 0.16} ${bot} Z`}
          {...common}
        />
        <line x1={0} y1={top + 3} x2={0} y2={bot - 3} stroke={detail} strokeWidth={1.4} />
        {[0.16, 0.42, 0.68].map((t, i) => {
          const y = top + (bot - top) * t + 4;
          const x = w * 0.27 * (1 - t * 0.5);
          return (
            <g key={i}>
              <circle cx={-x} cy={y} r={1.7} fill={detail} stroke="none" />
              <circle cx={x} cy={y} r={1.7} fill={detail} stroke="none" />
            </g>
          );
        })}
      </g>
    );
  }

  if (region === "coccix") {
    // Cóccix: 3 segmentos chicos que se afinan.
    return (
      <g>
        {[0, 1, 2].map((i) => {
          const yy = -h / 2 + i * (h / 3) + h / 6;
          const ww = w * (1 - i * 0.28);
          return (
            <ellipse key={i} cx={0} cy={yy} rx={ww / 2} ry={h / 7} {...common} />
          );
        })}
      </g>
    );
  }

  // Vértebra "típica" (cervical / dorsal / lumbar): apófisis transversas (alas
  // tapered hacia afuera) + cuerpo/láminas + apófisis espinosa central. La
  // dorsal lleva la espinosa larga hacia abajo (se solapa, tipo teja); la
  // lumbar, alas anchas y chatas; la cervical, todo chico.
  const reach = w / 2;
  const tpRy = region === "lumbar" ? 5.6 : region === "dorsal" ? 4 : 3;
  const bodyRx = region === "lumbar" ? 8 : region === "dorsal" ? 5.5 : 4;
  const bodyRy = region === "lumbar" ? 6 : region === "dorsal" ? 4.6 : 3.6;
  const spinLen = region === "dorsal" ? h * 1.55 : region === "lumbar" ? h * 0.8 : h * 0.72;
  const spinW = region === "lumbar" ? 7 : region === "dorsal" ? 5 : 4;
  const wing = (dir: 1 | -1) =>
    `M ${dir * bodyRx} 0
     Q ${dir * reach} ${-tpRy} ${dir * reach} 0
     Q ${dir * reach} ${tpRy} ${dir * bodyRx} 0 Z`;

  return (
    <g>
      {/* Apófisis transversas (alas afiladas hacia afuera). */}
      <path d={wing(-1)} {...common} />
      <path d={wing(1)} {...common} />
      {/* Cuerpo / láminas central. */}
      <ellipse cx={0} cy={0} rx={bodyRx} ry={bodyRy} {...common} />
      {/* Apófisis espinosa: gota central hacia abajo (dorsal se solapa). */}
      <path
        d={`M ${-spinW / 2} 0
            Q ${-spinW / 2} ${spinLen * 0.55} 0 ${spinLen}
            Q ${spinW / 2} ${spinLen * 0.55} ${spinW / 2} 0 Z`}
        {...common}
      />
    </g>
  );
}

// ─── Vista lateral · perfil con curvas anatómicas ────────────────────────────

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
      aria-label="Columna vertebral — vista lateral"
    >
      <defs>
        <linearGradient id="pc-quiro-spine-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--line-soft)" stopOpacity="0" />
          <stop offset="20%" stopColor="var(--line-soft)" stopOpacity="0.55" />
          <stop offset="80%" stopColor="var(--line-soft)" stopOpacity="0.55" />
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
        const filled = tieneContenido(notaDe(data, v.id));
        const isSelected = selected === v.id;
        const { w, h } = v;
        // Cuerpo vertebral en perfil (riñón) + apófisis espinosa hacia atrás.
        const body = `
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
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(v.id);
              }
            }}
            tabIndex={0}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label={`Vértebra ${v.id}`}
          >
            <rect x={-w * 0.6} y={-h * 0.7} width={w * 1.5} height={h * 1.4} fill="transparent" />
            <path
              d={body}
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

export type { PosteriorVertebra };
