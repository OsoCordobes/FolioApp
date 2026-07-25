"use client";

/**
 * Folio · biblioteca de instrumentos · EscalaSegmentada (D3).
 *
 * Fila segmentada de botones para escalas numéricas cortas (EVA/VAS 0–10 y
 * afines): un valor = un click, visible de un vistazo — reemplaza el dropdown
 * de 11 opciones (dos clicks + scroll) para el dato que se toca en CADA sesión.
 *
 * Accesible y controlado:
 *   - `role="group"` con aria-label; cada valor es un <button aria-pressed>.
 *   - click en el valor activo lo DESELECCIONA (vuelve a null — espejo de la
 *     opción "—" del select que reemplaza).
 *   - `readOnly` deshabilita sin cambiar el layout.
 *   - `anclas` opcional: rótulos es-AR bajo los extremos ("Sin dolor" /
 *     "Peor dolor imaginable").
 *
 * Estilos: `.fi-escala-seg` en folio.css (tokens brass/cream, aria-pressed
 * como estado visual). Sin PHI: solo el valor numérico elegido.
 */

export interface EscalaSegmentadaProps {
  /** Extremo inferior de la escala (incluido). */
  min: number;
  /** Extremo superior de la escala (incluido). */
  max: number;
  /** Valor seleccionado (null = sin registrar). */
  value: number | null;
  /** Notifica el nuevo valor; null cuando se deselecciona el activo. */
  onChange(next: number | null): void;
  /** Etiqueta accesible del grupo. */
  label: string;
  readOnly?: boolean;
  /** Rótulos bajo los extremos de la escala (opcional). */
  anclas?: { min: string; max: string };
}

export function EscalaSegmentada({
  min,
  max,
  value,
  onChange,
  label,
  readOnly,
  anclas,
}: EscalaSegmentadaProps) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  const valores = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="fi-escala-seg" role="group" aria-label={label}>
        {valores.map((n) => {
          const activo = value === n;
          return (
            <button
              key={n}
              type="button"
              className="fi-escala-seg-btn"
              aria-pressed={activo}
              disabled={readOnly}
              onClick={() => {
                if (readOnly) return;
                onChange(activo ? null : n);
              }}
              title={activo ? `Quitar ${n}` : String(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
      {anclas ? (
        <div className="fi-escala-seg-anclas" aria-hidden="true">
          <span>{anclas.min}</span>
          <span>{anclas.max}</span>
        </div>
      ) : null}
    </div>
  );
}
