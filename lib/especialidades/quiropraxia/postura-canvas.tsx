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
const VIEW_H = 320;
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
          {/* Figura masculina de espaldas (solo contorno, sin relleno) —
              referencia para trazar caída de hombros, escoliosis, etc.
              cx=140. Cabeza + cuello + trapecio/hombros + torso con cintura y
              cadera + brazos colgando + escápulas sutiles + línea media. */}
          <g fill="none" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
            {/* cabeza */}
            <ellipse cx="140" cy="38" rx="21" ry="25" />
            {/* cuello */}
            <path d="M 130 60 C 130 66, 130 68, 128 72 M 150 60 C 150 66, 150 68, 152 72" />
            {/* tronco: trapecio → hombros (deltoides) → dorsal → cintura → cadera */}
            <path
              d="M 128 72
                 C 119 76, 101 82, 89 100
                 C 83 110, 81 117, 83 129
                 C 91 162, 98 184, 102 206
                 C 104 227, 99 247, 103 259
                 C 114 272, 166 272, 177 259
                 C 181 247, 176 227, 178 206
                 C 182 184, 189 162, 197 129
                 C 199 117, 197 110, 191 100
                 C 179 82, 161 76, 152 72"
            />
            {/* brazo izquierdo colgando (deltoides → muñeca → cara interna) */}
            <path d="M 85 124 C 74 148, 69 180, 73 208 C 75 219, 85 219, 87 208 C 91 184, 96 158, 97 135" />
            {/* brazo derecho */}
            <path d="M 195 124 C 206 148, 211 180, 207 208 C 205 219, 195 219, 193 208 C 189 184, 184 158, 183 135" />
            {/* escápulas (sutiles, vista posterior) */}
            <path stroke="var(--line-soft)" strokeWidth="1.1" d="M 124 116 C 113 122, 112 140, 126 150" />
            <path stroke="var(--line-soft)" strokeWidth="1.1" d="M 156 116 C 167 122, 168 140, 154 150" />
            {/* línea media de referencia (columna) */}
            <line x1="140" y1="70" x2="140" y2="262" stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="4 4" />
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
