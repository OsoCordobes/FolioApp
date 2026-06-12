"use client";

/**
 * Folio · selector de profesional para /hoy y /calendario (modo clínica).
 *
 * Fila de chips "Todos | Dra. X | Dr. Y" navegable por SSR puro vía query
 * param `?prof=<memberId>` (mismo patrón que `?w=` / `?mes=`). El caller
 * decide la visibilidad (>1 colegiado + caps.actsAcrossProfessionals, ver
 * lib/agenda/profesional.ts) y construye los hrefs para preservar el resto
 * de los query params de su página.
 *
 * Estilos: clases nuevas `fi-prof-*` (tokens de folio.css) — no toca clases
 * existentes, las orgs Solo nunca montan este componente.
 */

import Link from "next/link";

import { nombreCortoProfesional, type ProfesionalLite } from "@/lib/agenda/profesional";

interface ProfFilterChipsProps {
  profesionales: ProfesionalLite[];
  /** member.id activo en el filtro; null = "Todos". */
  profActivo: string | null;
  /** Construye el href de cada chip (null = "Todos") preservando los params de la página. */
  hrefFor: (profId: string | null) => string;
}

export function ProfFilterChips({ profesionales, profActivo, hrefFor }: ProfFilterChipsProps) {
  return (
    <nav className="fi-prof-filter" aria-label="Filtrar agenda por profesional">
      <Link
        href={hrefFor(null)}
        className={"fi-prof-chip " + (profActivo == null ? "is-on" : "")}
        aria-current={profActivo == null ? "true" : undefined}
      >
        Todos
      </Link>
      {profesionales.map((p) => (
        <Link
          key={p.id}
          href={hrefFor(p.id)}
          className={"fi-prof-chip " + (profActivo === p.id ? "is-on" : "")}
          aria-current={profActivo === p.id ? "true" : undefined}
          title={p.displayName}
        >
          {nombreCortoProfesional(p.displayName)}
        </Link>
      ))}
    </nav>
  );
}
