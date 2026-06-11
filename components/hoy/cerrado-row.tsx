"use client";

/**
 * Folio · Dashboard · fila compacta de un turno cerrado.
 *
 * Port de `CerradoRow` en folio/dashboard.jsx (líneas 224-253).
 */

import * as I from "@/components/icons";
import { fmtMoney } from "@/lib/dashboard-helpers";
import type { Paciente, Turno } from "@/lib/types";

interface CerradoRowProps {
  turno: Turno;
  paciente: Paciente;
  onOpenFicha: (id: string) => void;
}

export function CerradoRow({ turno, paciente, onOpenFicha }: CerradoRowProps) {
  const hasImportante = (paciente.notasImportantes ?? "").trim().length > 0;
  return (
    <div className="fi-cerrado-row" onClick={() => onOpenFicha(turno.id)}>
      <div className="fi-t-time">
        <b>{turno.hora}</b>
      </div>
      <span className="fi-t-dot-wrap">
        <span className="fi-t-dot" style={{ background: "var(--green)" }} aria-hidden />
        {/* A11y: el estado se comunicaba solo con el dot verde (WCAG 1.4.1).
            .sr-only es position:absolute — cero impacto visual. */}
        <span className="sr-only">Turno cerrado</span>
      </span>
      <div className="fi-t-who">
        <div className="fi-t-name-row">
          <b className="fi-t-name">{paciente.nombre}</b>
          {hasImportante ? (
            <span className="fi-t-flag fi-t-flag--warn" title={paciente.notasImportantes}>
              <I.Alert size={11} />
            </span>
          ) : null}
        </div>
        <div className="fi-t-meta">
          <span>{turno.servicio}</span>
          {turno.postVisita?.guardada ? (
            <span className="fi-t-pv fi-t-pv--ok">
              <I.Check size={10} /> post-visita
            </span>
          ) : (
            <span className="fi-t-pv fi-t-pv--mute">sin post-visita</span>
          )}
        </div>
      </div>
      <div className="fi-cerrado-amount">
        <span className="fi-mono">{fmtMoney(turno.precio)}</span>
      </div>
      <div className="fi-cerrado-cta">
        <span className="fi-btn fi-btn-ghost">
          Ver ficha <I.ArrowRight size={11} />
        </span>
      </div>
    </div>
  );
}
