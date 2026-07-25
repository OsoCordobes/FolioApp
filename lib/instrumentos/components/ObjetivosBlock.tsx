"use client";

/**
 * Folio · biblioteca de instrumentos · ObjetivosBlock (D3).
 *
 * Panel GENÉRICO de objetivos del tratamiento — extrae el bloque que psicología
 * (Objetivos terapéuticos), kinesiología (Objetivos funcionales) y nutrición
 * (Objetivos nutricionales) triplicaban casi verbatim (~130 líneas c/u):
 *   - alta de objetivo (input + Enter/botón Agregar, estado inicial en curso);
 *   - edición de estado por objetivo (select compacto) + Quitar;
 *   - "Retomar de la última sesión" cuando el borrador está vacío y el
 *     historial tiene objetivos (continuidad entre sesiones);
 *   - snapshot read-only de la última sesión registrada (chips por estado).
 *
 * Parametrizado por especialidad (título, placeholder, estados y labels);
 * controlado por el consumidor: cada edición notifica `onChange(next)` con el
 * array completo (el tool lo mete en su draft y lo valida su schema zod al
 * guardar). Cero cambio visual respecto de las tres copias. PHI: nunca loguea
 * el texto de los objetivos.
 *
 * Estilos: clases existentes de folio.css (pc-card / fi-eyebrow / fi-wi-field /
 * fi-pill / pc-link / fi-select) + tokens en estilos inline puntuales.
 */

import { useState, type CSSProperties } from "react";

import * as I from "@/components/icons";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

/** Chips por estado — mismos tokens que usaban las tres copias. */
const CHIP_ESTADO: Record<string, CSSProperties> = {
  en_curso: { color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" },
  logrado: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  pausado: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
};

function chipEstado(estado: string): CSSProperties {
  return CHIP_ESTADO[estado] ?? CHIP_ESTADO.en_curso;
}

/** Un objetivo del tratamiento (shape compartido por las tres especialidades). */
export interface ObjetivoGenerico<E extends string = string> {
  texto: string;
  estado: E;
}

export interface ObjetivosBlockProps<E extends string> {
  /** Título del panel ("Objetivos terapéuticos" / "funcionales" / "nutricionales"). */
  titulo: string;
  /** Placeholder es-AR del input de alta. */
  placeholder: string;
  /** Estados posibles (orden = orden del select). */
  estados: readonly E[];
  /** Labels es-AR por estado. */
  estadoLabels: Record<E, string>;
  /** Estado inicial de un objetivo nuevo (típicamente "en_curso"). */
  estadoInicial: E;
  /** Objetivos del borrador de ESTA sesión. */
  objetivos: ReadonlyArray<ObjetivoGenerico<E>>;
  /** Últimos objetivos registrados en el historial (o null si no hay). */
  ultimos: { fecha: string; objetivos: ReadonlyArray<ObjetivoGenerico<E>> } | null;
  /** Notifica el array completo tras cada edición (alta/estado/quitar/retomar). */
  onChange(next: Array<ObjetivoGenerico<E>>): void;
  readOnly?: boolean;
}

export function ObjetivosBlock<E extends string>({
  titulo,
  placeholder,
  estados,
  estadoLabels,
  estadoInicial,
  objetivos,
  ultimos,
  onChange,
  readOnly,
}: ObjetivosBlockProps<E>) {
  const [nuevoObjetivo, setNuevoObjetivo] = useState("");
  const textoNuevo = nuevoObjetivo.trim();

  const agregar = () => {
    if (textoNuevo === "" || readOnly) return;
    onChange([...objetivos, { texto: textoNuevo.slice(0, 500), estado: estadoInicial }]);
    setNuevoObjetivo("");
  };

  const setEstado = (i: number, estado: E) => {
    if (readOnly) return;
    onChange(objetivos.map((o, idx) => (idx === i ? { ...o, estado } : o)));
  };

  const quitar = (i: number) => {
    if (readOnly) return;
    onChange(objetivos.filter((_, idx) => idx !== i));
  };

  const retomar = () => {
    if (!ultimos || readOnly) return;
    onChange([...ultimos.objetivos]);
  };

  return (
    <section className="pc-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">{titulo}</span>
      </header>

      {objetivos.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
            En esta sesión
          </span>
          {objetivos.map((o, i) => (
            <div
              key={`${o.texto}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 0",
                borderBottom: "1px solid var(--line-soft)",
              }}
            >
              <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, color: "var(--ink)" }}>
                {o.texto}
              </span>
              <select
                className="fi-select"
                style={{ width: "auto", padding: "4px 6px", fontSize: 12 }}
                value={o.estado}
                onChange={(e) => setEstado(i, e.target.value as E)}
                disabled={readOnly}
                aria-label={`Estado del objetivo: ${o.texto}`}
              >
                {estados.map((estado) => (
                  <option key={estado} value={estado}>
                    {estadoLabels[estado]}
                  </option>
                ))}
              </select>
              {!readOnly ? (
                <button
                  type="button"
                  className="pc-link"
                  onClick={() => quitar(i)}
                  aria-label={`Quitar objetivo: ${o.texto}`}
                >
                  Quitar
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!readOnly ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {objetivos.length === 0 && ultimos ? (
            <button
              type="button"
              className="fi-btn fi-btn-secondary"
              onClick={retomar}
              style={{ alignSelf: "flex-start" }}
              title={`Copia los ${ultimos.objetivos.length} objetivos de la sesión del ${fmtFecha(ultimos.fecha)} para actualizar su estado`}
            >
              <I.History size={12} /> Retomar de la última sesión ({ultimos.objetivos.length})
            </button>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label className="fi-wi-field" style={{ flex: 1 }}>
              <span>Nuevo objetivo</span>
              <input
                type="text"
                value={nuevoObjetivo}
                maxLength={500}
                onChange={(e) => setNuevoObjetivo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agregar();
                  }
                }}
                placeholder={placeholder}
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="fi-btn fi-btn-secondary"
              onClick={agregar}
              disabled={textoNuevo === ""}
              title={
                textoNuevo !== ""
                  ? "Suma el objetivo al borrador de esta sesión (estado: en curso)"
                  : "Escribí el objetivo para agregarlo"
              }
            >
              <I.Plus size={12} /> Agregar
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
          Última sesión registrada
        </span>
        {!ultimos ? (
          <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
            Sin objetivos registrados todavía. Los guardados en sesiones
            anteriores aparecen acá.
          </p>
        ) : (
          <>
            {ultimos.objetivos.map((o, i) => (
              <div
                key={`${ultimos.fecha}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 0",
                  borderBottom: "1px solid var(--line-soft)",
                }}
              >
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-2)" }}>
                  {o.texto}
                </span>
                <span className="fi-pill" style={chipEstado(o.estado)}>
                  {estadoLabels[o.estado]}
                </span>
              </div>
            ))}
            <span className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
              Registrados en la sesión del {fmtFecha(ultimos.fecha)}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
