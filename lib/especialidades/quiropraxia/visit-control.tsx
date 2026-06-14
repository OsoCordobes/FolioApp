"use client";

/**
 * Folio · especialidades · quiropraxia · control de visitas (Workstream 6).
 *
 * Grilla de fechas clickeable sobre el historial de sesiones quiro del paciente
 * (historial ya filtrado a quiropraxia por el slot). Click en una fecha → la
 * Tool entra en modo snapshot (lectura de esa sesión). Un control "Volver a la
 * visita actual" limpia la selección. Estilo de pie de hoja de trabajo.
 */

import type { ToolHistorialEntry } from "@/lib/especialidades/types";

interface VisitControlProps {
  historial: ToolHistorialEntry[];
  /** Índice de la visita seleccionada (snapshot) o null = visita actual. */
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

export function VisitControl({ historial, selectedIndex, onSelect }: VisitControlProps) {
  if (historial.length === 0) {
    return (
      <div className="pc-quiro-visits">
        <span className="fi-eyebrow">Control de visitas</span>
        <p className="pc-quiro-muted">Sin visitas previas registradas.</p>
      </div>
    );
  }

  return (
    <div className="pc-quiro-visits">
      <header className="pc-quiro-visits-head">
        <span className="fi-eyebrow">Control de visitas</span>
        {selectedIndex != null ? (
          <button
            type="button"
            className="pc-quiro-pill"
            onClick={() => onSelect(null)}
          >
            Volver a la visita actual
          </button>
        ) : null}
      </header>
      <div className="pc-quiro-visits-grid" role="group" aria-label="Visitas previas">
        {historial.map((entry, i) => (
          <button
            key={`${entry.fecha}-${i}`}
            type="button"
            className={"pc-quiro-visit-cell " + (selectedIndex === i ? "is-active" : "")}
            onClick={() => onSelect(i)}
            aria-pressed={selectedIndex === i}
            title={`Ver visita del ${fmtFecha(entry.fecha)}`}
          >
            {fmtFecha(entry.fecha)}
          </button>
        ))}
      </div>
    </div>
  );
}
