"use client";

/**
 * Folio · especialidades · placeholder honesto del slot clínico (Fase B).
 *
 * Cardiología y psicología todavía no tienen herramienta propia (llegan en
 * Fase D del plan). Mientras tanto el slot muestra un estado vacío honesto —
 * nada de datos falsos ni controles que no persisten. La nota SOAP (columna
 * derecha del tab) sigue disponible para registrar la evolución.
 *
 * Reusa clases existentes de folio.css (pc-card / fi-eyebrow / pc-card-text)
 * — sin CSS nuevo.
 */

import type { SpecialtyToolProps } from "@/lib/especialidades/types";

export function PlaceholderTool({ nombre }: { nombre: string }) {
  return (
    <section className="pc-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Herramienta clínica</span>
      </header>
      <p className="pc-card-text">
        El módulo clínico de {nombre} llega en la Fase D.
      </p>
      <p className="pc-card-text muted">
        Mientras tanto podés registrar la evolución del paciente en la nota
        SOAP de cada sesión.
      </p>
    </section>
  );
}

/** Fábrica de Tools placeholder con la firma del slot. */
export function makePlaceholderTool(nombre: string) {
  function SpecialtyPlaceholderTool(_props: SpecialtyToolProps) {
    return <PlaceholderTool nombre={nombre} />;
  }
  SpecialtyPlaceholderTool.displayName = `PlaceholderTool(${nombre})`;
  return SpecialtyPlaceholderTool;
}
