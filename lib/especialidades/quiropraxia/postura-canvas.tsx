"use client";

/**
 * Folio · especialidades · quiropraxia · análisis postural (Workstream 6).
 *
 * Torso masculino de espaldas (hombros + contorno, stroke con tokens — nada
 * anatómicamente pesado) + una capa de dibujo a mano alzada. Los eventos de
 * puntero (onPointerDown/Move/Up) acumulan un trazo [{x,y},…] en coords del
 * viewBox; al soltar se hace push a postura.strokes. Los trazos confirmados se
 * renderizan como <polyline>. Botones "Deshacer" (pop del último) y "Limpiar".
 * Una nota breve (textarea) → postura.nota.
 *
 * readOnly oculta los controles y deshabilita el dibujo (snapshot / sin turno).
 * Controlado: value entra del borrador v2, onChange emite el postura nuevo.
 */

import { useRef, useState } from "react";

type Punto = { x: number; y: number };
type PosturaValue = { strokes: Punto[][]; nota?: string } | undefined;

interface PosturaCanvasProps {
  value: PosturaValue;
  onChange: (next: { strokes: Punto[][]; nota?: string }) => void;
  readOnly?: boolean;
}

const VIEW_W = 280;
const VIEW_H = 230;
const MAX_STROKES = 200;

function pointsToStr(pts: Punto[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function PosturaCanvas({ value, onChange, readOnly }: PosturaCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drawing, setDrawing] = useState<Punto[] | null>(null);

  const strokes = value?.strokes ?? [];
  const nota = value?.nota ?? "";

  const toViewBox = (e: React.PointerEvent<SVGSVGElement>): Punto | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const p = toViewBox(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing([p]);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly || drawing == null) return;
    const p = toViewBox(e);
    if (!p) return;
    setDrawing((prev) => (prev ? [...prev, p] : [p]));
  };

  const commit = () => {
    if (drawing && drawing.length >= 2 && strokes.length < MAX_STROKES) {
      onChange({ strokes: [...strokes, drawing], nota: value?.nota });
    }
    setDrawing(null);
  };

  const undo = () => {
    if (readOnly || strokes.length === 0) return;
    onChange({ strokes: strokes.slice(0, -1), nota: value?.nota });
  };

  const clear = () => {
    if (readOnly || strokes.length === 0) return;
    onChange({ strokes: [], nota: value?.nota });
  };

  const setNota = (next: string) => {
    if (readOnly) return;
    onChange({ strokes, nota: next.slice(0, 1000) });
  };

  return (
    <div className="pc-quiro-postura">
      <div className="pc-quiro-postura-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="pc-quiro-postura-svg"
          role="img"
          aria-label="Análisis postural (vista posterior)"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={commit}
          onPointerLeave={commit}
          style={{ touchAction: "none", cursor: readOnly ? "default" : "crosshair" }}
        >
          {/* Figura de espaldas recortada justo debajo de los hombros (cabeza +
              cuello + trapecios + deltoides), siguiendo la lámina de referencia
              quiropráctica. Solo contorno con tokens; caída de hombros natural
              para trazar nivel de hombros, inclinación cefálica y rotación.
              cx=140. */}
          <g fill="none" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
            {/* contorno: cabeza → cuello → trapecio → deltoides → recorte dorsal */}
            <path
              d="M 140 20
                 C 161 20, 176 35, 176 56
                 C 176 78, 166 92, 152 100
                 C 151 105, 151 109, 151 113
                 C 172 120, 212 132, 240 150
                 C 248 156, 252 165, 250 178
                 C 249 188, 246 194, 240 199
                 C 210 205, 178 207, 140 207
                 C 102 207, 70 205, 40 199
                 C 34 194, 31 188, 30 178
                 C 28 165, 32 156, 40 150
                 C 68 132, 108 120, 129 113
                 C 129 109, 129 105, 128 100
                 C 114 92, 104 78, 104 56
                 C 104 35, 119 20, 140 20
                 Z"
            />
            {/* nuca / nacimiento del pelo */}
            <path stroke="var(--line-soft)" strokeWidth="1.1" d="M 118 88 C 128 96, 152 96, 162 88" />
            {/* C7 + línea media de referencia (plomada) */}
            <line x1="140" y1="106" x2="140" y2="201" stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="4 4" />
            {/* escápulas sutiles (vista posterior) */}
            <path stroke="var(--line-soft)" strokeWidth="1.1" d="M 110 152 C 99 161, 100 180, 115 189" />
            <path stroke="var(--line-soft)" strokeWidth="1.1" d="M 170 152 C 181 161, 180 180, 165 189" />
          </g>

          {/* Trazos confirmados. */}
          {strokes.map((s, i) => (
            <polyline
              key={i}
              points={pointsToStr(s)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Trazo en curso. */}
          {drawing && drawing.length >= 1 ? (
            <polyline
              points={pointsToStr(drawing)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.7"
            />
          ) : null}
        </svg>

        {!readOnly ? (
          <div className="pc-quiro-postura-tools">
            <button
              type="button"
              className="pc-quiro-pill"
              onClick={undo}
              disabled={strokes.length === 0}
            >
              Deshacer
            </button>
            <button
              type="button"
              className="pc-quiro-pill"
              onClick={clear}
              disabled={strokes.length === 0}
            >
              Limpiar
            </button>
          </div>
        ) : null}
      </div>

      <label className="fi-wi-field">
        <span>Nota postural</span>
        <textarea
          className="pc-soap-textarea"
          rows={2}
          maxLength={1000}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          readOnly={readOnly}
          placeholder="Ej. hombro derecho elevado, hiperlordosis lumbar…"
        />
      </label>
    </div>
  );
}
